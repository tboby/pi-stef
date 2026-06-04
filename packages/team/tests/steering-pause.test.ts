import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSteeringDrain, createSteeringOrchestratorContext, PausedSteeringError } from "../src/steering/drain";
import { createSteeringStore } from "../src/steering/store";
import { enforcePauseAtSafeBoundary } from "../src/steering/pause-enforcement";

describe("M4 latched pauseState", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkdtemp(path.join(tmpdir(), "pause-")); });
  afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

  it("setPauseState persists to state.json and readPauseState round-trips", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    expect(await store.readPauseState()).toBeNull();
    await store.setPauseState({
      kind: "failure",
      instructionIds: ["inst-1"],
      rationale: "bad",
      latchedAt: "2026-05-19T00:00:00.000Z",
    });
    expect(await store.readPauseState()).toMatchObject({
      kind: "failure",
      instructionIds: ["inst-1"],
      rationale: "bad",
    });
    // Persisted state.json contains pauseState
    const raw = await readFile(path.join(rootDir, "state.json"), "utf8");
    expect(raw).toContain("pauseState");
    expect(raw).toContain("inst-1");
  });

  it("clearPause sets the latch back to null", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    await store.setPauseState({
      kind: "failure",
      instructionIds: ["x"],
      rationale: "x",
      latchedAt: "now",
    });
    await store.setPauseState(null);
    expect(await store.readPauseState()).toBeNull();
  });

  it("drain failure path latches kind='failure' on pauseState", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const inst = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "fail me", priority: "normal",
    });
    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "task",
      store,
      decide: async () => { throw new Error("decider exploded"); },
    });
    await drain("workflow-start");
    const pause = await store.readPauseState();
    expect(pause).toMatchObject({
      kind: "failure",
      instructionIds: [inst.id],
    });
  });

  it("multiple failures extend instructionIds on the same latch (do not overwrite)", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const i1 = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "x", priority: "normal",
    });
    const i2 = await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "y", priority: "normal",
    });
    let n = 0;
    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "task",
      store,
      decideBatch: async () => { n += 1; throw new Error(`boom ${n}`); },
    });
    await drain("workflow-start");
    const pause = await store.readPauseState();
    expect(pause?.instructionIds.sort()).toEqual([i1.id, i2.id].sort());
    expect(pause?.kind).toBe("failure");
  });

  it("drain fails closed if setPauseState throws (latch must not be swallowed)", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    await store.appendInstruction({
      workflowId: "wf-1", source: "tool", text: "fail me", priority: "normal",
    });
    let setCalls = 0;
    const wrapped = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "setPauseState") {
          return async (_state: unknown) => {
            setCalls += 1;
            throw new Error("simulated state.json write failure");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const drain = createSteeringDrain({
      workflowId: "wf-1",
      workflowKind: "task",
      store: wrapped,
      decide: async () => { throw new Error("decider exploded"); },
    });
    // The persistence failure must propagate — silently swallowing it
    // would lose the latch and let the workflow keep marching past the
    // failed instruction.
    await expect(drain("workflow-start")).rejects.toThrow(/simulated state.json/);
    expect(setCalls).toBe(1);
  });

  it("orchestrator context exposes readPauseState / setPauseState / clearPause", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    expect(await ctx.readPauseState()).toBeNull();
    await ctx.setPauseState({
      kind: "failure", instructionIds: ["x"], rationale: "x", latchedAt: "now",
    });
    expect(await ctx.readPauseState()).not.toBeNull();
    await ctx.clearPause();
    expect(await ctx.readPauseState()).toBeNull();
  });
});

describe("enforcePauseAtSafeBoundary", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkdtemp(path.join(tmpdir(), "pause-enforce-")); });
  afterEach(async () => { await rm(rootDir, { recursive: true, force: true }); });

  it("no-op when pauseState is null", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    await expect(enforcePauseAtSafeBoundary(ctx)).resolves.toBeUndefined();
  });

  it("throws PausedSteeringError(headless) when no UI is available", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    await ctx.setPauseState({
      kind: "failure", instructionIds: ["x"], rationale: "boom", latchedAt: "now",
    });
    try {
      await enforcePauseAtSafeBoundary(ctx);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PausedSteeringError);
      expect((err as PausedSteeringError).pauseState).toMatchObject({
        kind: "failure", instructionIds: ["x"],
      });
    }
  });

  it("clears the latch when UI.confirm accepts", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    await ctx.setPauseState({
      kind: "failure", instructionIds: ["x"], rationale: "boom", latchedAt: "now",
    });
    const ui = {
      confirm: async () => true,
      // Minimal stub of ExtensionUIContext members the helper does not touch.
    } as never;
    await enforcePauseAtSafeBoundary(ctx, { ui });
    expect(await ctx.readPauseState()).toBeNull();
  });

  it("converts ui.confirm exception into PausedSteeringError (preserves guidance + latch)", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    await ctx.setPauseState({
      kind: "failure", instructionIds: ["x"], rationale: "boom", latchedAt: "now",
    });
    const ui = {
      confirm: async () => { throw new Error("user pressed escape"); },
    } as never;
    try {
      await enforcePauseAtSafeBoundary(ctx, { ui });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PausedSteeringError);
      expect((err as PausedSteeringError).pauseState.instructionIds).toEqual(["x"]);
    }
    // Latch still in place (orchestrator/run.ts third branch preserves it).
    expect(await ctx.readPauseState()).not.toBeNull();
  });

  it("throws PausedSteeringError when UI.confirm rejects", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const ctx = createSteeringOrchestratorContext({
      workflowId: "wf-1", workflowKind: "task", store,
    });
    await ctx.setPauseState({
      kind: "confirmation", instructionIds: ["y"], rationale: "destructive", latchedAt: "now",
    });
    const ui = { confirm: async () => false } as never;
    await expect(enforcePauseAtSafeBoundary(ctx, { ui })).rejects.toBeInstanceOf(PausedSteeringError);
    // Latch preserved since operator declined.
    expect(await ctx.readPauseState()).not.toBeNull();
  });
});

describe("dead state: superseded removed", () => {
  it("@ts-expect-error proves 'superseded' is no longer assignable", () => {
    // The status field accepts only the canonical states; assigning
    // 'superseded' should fail to compile. The @ts-expect-error verifies
    // the compiler still reports a violation if anyone re-introduces it.
    type Status = import("../src/steering/types").SteeringInstructionStatus;
    // @ts-expect-error -- "superseded" is removed from SteeringInstructionStatus
    const _bad: Status = "superseded";
    void _bad;
  });
});
