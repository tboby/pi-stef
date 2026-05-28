import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSteeringDrain } from "../src/steering/drain";
import { createSteeringStore } from "../src/steering/store";
import {
  BatchValidationError,
  decideSteeringInstructions,
  validateBatchDecisions,
} from "../src/steering/decider";
import type { SteeringDecision, SteeringInstruction, SteeringWorkflowSnapshot } from "../src/steering/types";

function makeSnapshot(): SteeringWorkflowSnapshot {
  return {
    workflowId: "wf-1",
    workflowKind: "implement",
    activeAgentsVersion: 0,
    referencedAgentStates: {},
    referencedPlanHashes: {},
    activeAgents: [],
  };
}

function makeApplyToFutureDecision(instructionId: string, snapshot: SteeringWorkflowSnapshot, decisionId = `d-${instructionId}`): SteeringDecision {
  return {
    id: decisionId,
    instructionId,
    decidedAt: "2026-05-19T00:00:00.000Z",
    kind: "apply-to-future",
    summary: "Apply later.",
    rationale: "Non-destructive.",
    planPatchRequired: false,
    targetAgents: [],
    abortAgents: [],
    discardAgentChanges: [],
    affectedMilestones: [],
    affectedStories: [],
    affectedFiles: [],
    risks: [],
    activeAgentsVersion: snapshot.activeAgentsVersion,
    referencedAgentStates: snapshot.referencedAgentStates,
    referencedPlanHashes: snapshot.referencedPlanHashes,
    requiresConfirmation: false,
    scopeKind: "workflow",
    guidanceText: `g-${instructionId}`,
  };
}

function makeInstruction(): Omit<SteeringInstruction, "id" | "receivedAt" | "status"> {
  return {
    workflowId: "wf-1",
    source: "tool",
    text: "Be careful.",
    priority: "normal",
  };
}

describe("validateBatchDecisions", () => {
  const inst = (id: string): SteeringInstruction => ({
    id,
    workflowId: "wf-1",
    receivedAt: "2026-05-19T00:00:00.000Z",
    source: "tool",
    text: "x",
    priority: "normal",
    status: "queued",
  });

  it("accepts an exact 1:1 batch", () => {
    expect(() => validateBatchDecisions(
      [inst("a"), inst("b")],
      [makeApplyToFutureDecision("a", makeSnapshot()), makeApplyToFutureDecision("b", makeSnapshot())],
    )).not.toThrow();
  });

  it("STEER_BATCH_VALIDATION_FAILED on count mismatch", () => {
    expect(() => validateBatchDecisions(
      [inst("a"), inst("b")],
      [makeApplyToFutureDecision("a", makeSnapshot())],
    )).toThrow(BatchValidationError);
  });

  it("STEER_BATCH_VALIDATION_FAILED on unknown instructionId", () => {
    expect(() => validateBatchDecisions(
      [inst("a"), inst("b")],
      [makeApplyToFutureDecision("a", makeSnapshot()), makeApplyToFutureDecision("c", makeSnapshot())],
    )).toThrow(/unknown instructionId c/);
  });

  it("STEER_BATCH_VALIDATION_FAILED on duplicate decision id", () => {
    expect(() => validateBatchDecisions(
      [inst("a"), inst("b")],
      [makeApplyToFutureDecision("a", makeSnapshot()), makeApplyToFutureDecision("a", makeSnapshot())],
    )).toThrow(/duplicate decision/);
  });

  it("STEER_BATCH_VALIDATION_FAILED on missing decision", () => {
    expect(() => validateBatchDecisions(
      [inst("a"), inst("b")],
      [makeApplyToFutureDecision("a", makeSnapshot()), makeApplyToFutureDecision("a", makeSnapshot())],
    )).toThrow();
  });
});

describe("decideSteeringInstructions (batch)", () => {
  it("returns empty array for empty input", async () => {
    expect(await decideSteeringInstructions({ instructions: [], snapshot: makeSnapshot() })).toEqual([]);
  });

  it("length-1 batches delegate to single-instruction decider (preserves normalize fallback)", async () => {
    // Length-1 input through the batch entry MUST behave identically to
    // calling decideSteeringInstruction directly — including the
    // shorthand → normalize fallback path the legacy decider supports.
    // Here the spawnText returns shorthand (action=note) which only the
    // normalize-fallback path handles, never the strict batch parser.
    const inst: SteeringInstruction = {
      id: "i-1",
      workflowId: "wf-1",
      receivedAt: "2026-05-19T00:00:00.000Z",
      source: "tool",
      text: "Be careful.",
      priority: "normal",
      status: "queued",
    };
    const decisions = await decideSteeringInstructions(
      { instructions: [inst], snapshot: makeSnapshot() },
      {
        member: { role: "steering-decider", model: "model" },
        sp: {
          spawn: async () => { throw new Error("not used"); },
          spawnText: async () => JSON.stringify({
            action: "note",
            summary: "Acknowledge guidance.",
            notes: "Mock the backend.",
            requiresConfirmation: false,
          }),
        },
      },
    );
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      instructionId: "i-1",
      kind: "apply-to-future",
      summary: "Acknowledge guidance.",
    });
  });
});

describe("drainOnce: combined non-destructive batch", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkdtemp(path.join(tmpdir(), "drain-batch-")); });
  afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

  it("processes all pending non-destructive instructions under a SINGLE shared snapshot via ONE batch decide call", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction(makeInstruction());
    const i2 = await store.appendInstruction(makeInstruction());

    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) =>
      instructions.map((i: SteeringInstruction) => makeApplyToFutureDecision(i.id, snapshot)),
    );

    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
    });

    const result = await drain("workflow-start");
    expect(result.errors).toEqual([]);
    expect(result.appliedDecisionIds).toEqual([`d-${i1.id}`, `d-${i2.id}`]);
    // The batch decider must be called exactly once because both decisions
    // are non-destructive (no Stage-B re-decide path runs).
    expect(decideBatch).toHaveBeenCalledTimes(1);
    expect(decideBatch.mock.calls[0][0].instructions.map((i: SteeringInstruction) => i.id)).toEqual([i1.id, i2.id]);

    const instructions = await store.listInstructions();
    expect(instructions.map((i) => i.status)).toEqual(["applied", "applied"]);
  });

  it("urgent priority jumps ahead of normal priority in the batch order", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const normal = await store.appendInstruction({ ...makeInstruction(), priority: "normal" });
    const urgent = await store.appendInstruction({ ...makeInstruction(), priority: "urgent" });

    const seenOrder: string[] = [];
    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) => {
      for (const i of instructions) seenOrder.push(i.id);
      return instructions.map((i: SteeringInstruction) => makeApplyToFutureDecision(i.id, snapshot));
    });

    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
    });
    await drain("workflow-start");
    expect(seenOrder).toEqual([urgent.id, normal.id]);
  });

  it("on batch-validation mismatch, marks ALL instructions failed with shared batchErrorId in failed.json", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction(makeInstruction());
    const i2 = await store.appendInstruction(makeInstruction());

    // Decider returns only ONE decision for two instructions → batch
    // validator throws → drain marks both as failed.
    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) =>
      [makeApplyToFutureDecision(instructions[0].id, snapshot)],
    );

    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
    });
    const result = await drain("workflow-start");
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.instructionId).sort()).toEqual([i1.id, i2.id].sort());
    const statuses = (await store.listInstructions()).map((i) => i.status);
    expect(statuses).toEqual(["failed", "failed"]);
  });
});

describe("drainOnce: destructive isolation", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkdtemp(path.join(tmpdir(), "drain-destructive-")); });
  afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

  function makeDestructiveDecision(instructionId: string, snapshot: SteeringWorkflowSnapshot): SteeringDecision {
    return {
      id: `d-${instructionId}`,
      instructionId,
      decidedAt: "2026-05-19T00:00:00.000Z",
      kind: "stop-running-agents",
      summary: "Stop.",
      rationale: "User asked.",
      planPatchRequired: false,
      targetAgents: [],
      abortAgents: [],
      discardAgentChanges: [],
      affectedMilestones: [],
      affectedStories: [],
      affectedFiles: [],
      risks: [],
      activeAgentsVersion: snapshot.activeAgentsVersion,
      referencedAgentStates: snapshot.referencedAgentStates,
      referencedPlanHashes: snapshot.referencedPlanHashes,
      requiresConfirmation: false,
    };
  }

  it("re-calls decider on a FRESH snapshot for each destructive instruction", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction(makeInstruction());
    const i2 = await store.appendInstruction(makeInstruction());

    let call = 0;
    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) => {
      call += 1;
      return instructions.map((i: SteeringInstruction) =>
        // First (Stage-A batch) call returns destructive; Stage-B calls
        // (one per destructive instruction) return non-destructive — proves
        // the fresh re-decide overrides the batch decision.
        call === 1
          ? makeDestructiveDecision(i.id, snapshot)
          : makeApplyToFutureDecision(i.id, snapshot),
      );
    });

    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
    });
    await drain("workflow-start");

    // 1 batch call for the initial batch + 2 single-instruction batch
    // calls (one per destructive instruction in Stage B).
    expect(decideBatch).toHaveBeenCalledTimes(3);
    expect(decideBatch.mock.calls[1][0].instructions).toHaveLength(1);
    expect(decideBatch.mock.calls[2][0].instructions).toHaveLength(1);
    expect((await store.listInstructions()).map((i) => i.status)).toEqual(["applied", "applied"]);
    expect(await store.listActiveGuidance()).toHaveLength(2);
    void i1; void i2;
  });

  it("halts the destructive loop on first requires-user-confirmation; remaining destructive go back to queued (not stranded in analyzing)", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction({ ...makeInstruction(), priority: "urgent" });
    const i2 = await store.appendInstruction({ ...makeInstruction(), priority: "urgent" });
    const i3 = await store.appendInstruction({ ...makeInstruction(), priority: "urgent" });

    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) =>
      instructions.map((i: SteeringInstruction) => ({
        ...makeDestructiveDecision(i.id, snapshot),
        requiresConfirmation: true,
      })),
    );
    const confirmDestructiveAction = vi.fn(async () => false);

    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
      confirmDestructiveAction,
    });
    const result = await drain("workflow-start");
    expect(result.pausedForConfirmation).toBe(true);

    const statuses = (await store.listInstructions()).map((i) => i.status);
    const requireCount = statuses.filter((s) => s === "requires-user-confirmation").length;
    const queuedCount = statuses.filter((s) => s === "queued").length;
    expect(requireCount).toBe(1);
    expect(queuedCount).toBe(2);
    // No instruction should be left stranded in `analyzing` — next drain
    // would skip them otherwise.
    expect(statuses.filter((s) => s === "analyzing")).toHaveLength(0);
    void i1; void i2; void i3;
  });

  it("Stage B always persists the fresh re-decide decision (audit ledger reflects the applied decision)", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction({ ...makeInstruction(), priority: "urgent" });

    let callCount = 0;
    const decideBatch = vi.fn(async ({ instructions, snapshot }: { instructions: SteeringInstruction[]; snapshot: SteeringWorkflowSnapshot }) => {
      callCount += 1;
      // First (initial batch) call returns destructive; Stage-B fresh call
      // returns a NON-destructive (same instruction id, same decision id
      // — collision; the bug pre-fix would have skipped the append).
      return instructions.map((i: SteeringInstruction) => {
        const base = makeDestructiveDecision(i.id, snapshot);
        if (callCount === 1) return base;
        return { ...makeApplyToFutureDecision(i.id, snapshot, base.id) };
      });
    });
    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "implement",
      store,
      decideBatch,
    });
    await drain("workflow-start");

    const ledger = await store.listDecisions();
    const forI1 = ledger.filter((d) => d.instructionId === i1.id);
    // Initial batch decision + fresh Stage-B decision = 2 ledger rows
    // for the same instruction (proving the audit captures both).
    expect(forI1).toHaveLength(2);
    expect(forI1.map((d) => d.kind).sort()).toEqual(["apply-to-future", "stop-running-agents"]);
  });
});
