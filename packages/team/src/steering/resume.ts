import type { SteeringStore } from "./store";

export interface SteeringResumeOptions {
  isProcessAlive?: (pid: number) => boolean;
}

export async function reconcileSteeringResume(store: SteeringStore, options: SteeringResumeOptions = {}): Promise<void> {
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const records = await store.readActiveAgents();
  const reconciled = records.map((record) => {
    if ((record.state === "running" || record.state === "starting") && (!record.pid || !isProcessAlive(record.pid))) {
      return {
        ...record,
        state: "failed" as const,
        lastEventAt: "resume-no-live-process",
      };
    }
    return record;
  });
  if (JSON.stringify(records) !== JSON.stringify(reconciled)) {
    await store.writeActiveAgents(reconciled);
  }

  const appliedInstructionIds = new Set((await store.listAppliedInstructions()).map((entry) => entry.instructionId));
  const instructions = await store.listInstructions();
  const instructionStatusById = new Map(instructions.map((i) => [i.id, i.status] as const));
  for (const instruction of instructions) {
    let nextStatus: typeof instruction.status | undefined;
    if (appliedInstructionIds.has(instruction.id) && instruction.status !== "applied") {
      nextStatus = "applied";
    } else if (instruction.status === "analyzing") {
      nextStatus = "queued";
    } else if (instruction.status === "partially-applied") {
      nextStatus = "queued";
    }

    if (nextStatus && nextStatus !== instruction.status) {
      await store.updateInstructionStatus(instruction.id, nextStatus);
      instructionStatusById.set(instruction.id, nextStatus);
    }
  }

  // M2 resume reconciliation for guidance rows:
  //   - pending-activation + instruction.applied → activate the row (crash
  //     happened between step 2 and step 3 of the drain ordering).
  //   - pending-activation + instruction.{failed|rejected} → expire
  //     "activation-aborted".
  //   - pending-activation + any other status → expire "stale-on-resume"
  //     (the drain was mid-flow when the process died; the instruction
  //     will reprocess fresh).
  const pending = await store.listPendingActivationGuidance();
  for (const row of pending) {
    const status = instructionStatusById.get(row.instructionId);
    if (status === "applied") {
      await store.activateGuidance(row.id);
      continue;
    }
    if (status === "failed" || status === "rejected") {
      await store.expireGuidance(row.id, "activation-aborted");
      continue;
    }
    await store.expireGuidance(row.id, "stale-on-resume");
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}
