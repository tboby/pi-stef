import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSteeringStore } from "../src/steering/store";
import { reconcileSteeringResume } from "../src/steering/resume";

describe("resume reconciliation for guidance rows", () => {
  let rootDir: string;
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "resume-guidance-"));
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("activates pending-activation row when instruction is applied", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const instruction = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "x", priority: "normal",
    });
    await store.appendAppliedInstruction({
      instructionId: instruction.id, decisionId: "dec-1", appliedAt: new Date().toISOString(),
    });
    await store.updateInstructionStatus(instruction.id, "applied");
    const row = await store.appendGuidance({
      instructionId: instruction.id, workflowId: "wf-1", scope: { kind: "workflow" },
      text: "guidance", source: "tool",
    });
    // simulate crash after step 2 — instruction is applied, guidance still pending
    expect((await store.listGuidance())[0].status).toBe("pending-activation");

    await reconcileSteeringResume(store);
    expect((await store.listGuidance()).find((r) => r.id === row.id)?.status).toBe("active");
  });

  it("expires pending-activation row with reason activation-aborted when instruction is failed", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const instruction = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "x", priority: "normal",
    });
    await store.updateInstructionStatus(instruction.id, "failed");
    const row = await store.appendGuidance({
      instructionId: instruction.id, workflowId: "wf-1", scope: { kind: "workflow" },
      text: "x", source: "tool",
    });

    await reconcileSteeringResume(store);
    const reconciled = (await store.listGuidance()).find((r) => r.id === row.id);
    expect(reconciled).toMatchObject({ status: "expired", expireReason: "activation-aborted" });
  });

  it("expires pending-activation row with reason stale-on-resume when instruction is still analyzing", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const instruction = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "x", priority: "normal",
    });
    // analyzing → reconciler will requeue, so we check guidance ends as stale-on-resume
    await store.updateInstructionStatus(instruction.id, "analyzing");
    const row = await store.appendGuidance({
      instructionId: instruction.id, workflowId: "wf-1", scope: { kind: "workflow" },
      text: "x", source: "tool",
    });

    await reconcileSteeringResume(store);
    const reconciled = (await store.listGuidance()).find((r) => r.id === row.id);
    expect(reconciled).toMatchObject({ status: "expired", expireReason: "stale-on-resume" });
  });
});
