import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSteeringStore } from "../src/steering/store";
import { reapplySteeringPlanNotes } from "../src/steering/guidance-plan-notes-reapply";

describe("reapplySteeringPlanNotes", () => {
  let repoRoot: string;
  let planFolder: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "plan-notes-reapply-"));
    planFolder = path.join(repoRoot, "ai_plan", "demo-plan");
    await mkdir(planFolder, { recursive: true });
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("reapplies plan notes that were overwritten by writePlanFolder", async () => {
    const store = createSteeringStore({ rootDir: planFolder, expectedRoot: planFolder });
    const row = await store.appendGuidance({
      instructionId: "inst-1", workflowId: "wf-1",
      scope: { kind: "workflow" }, text: "Mock the backend.", source: "tool",
    });
    await store.activateGuidance(row.id);
    await store.updateInstructionStatus(row.instructionId, "applied");

    // Simulate the planner running writePlanFolder wholesale (which would
    // clobber any notes the drain wrote).
    await writeFile(path.join(planFolder, "milestone-plan.md"), "# fresh plan\n", "utf8");
    await writeFile(path.join(planFolder, "final-transcript.md"), "# fresh transcript\n", "utf8");

    const result = await reapplySteeringPlanNotes({
      store,
      planFolder,
      repoRoot,
    });
    expect(result.failures).toEqual([]);
    expect(result.reapplied).toEqual(["inst-1"]);

    const milestone = await readFile(path.join(planFolder, "milestone-plan.md"), "utf8");
    expect(milestone).toContain("## Steering Notes");
    expect(milestone).toContain("source: tool:inst-1");
  });

  it("is idempotent: rerunning does not duplicate bullets", async () => {
    const store = createSteeringStore({ rootDir: planFolder, expectedRoot: planFolder });
    const row = await store.appendGuidance({
      instructionId: "inst-1", workflowId: "wf-1", scope: { kind: "workflow" }, text: "x", source: "tool",
    });
    await store.activateGuidance(row.id);
    await store.updateInstructionStatus(row.instructionId, "applied");

    await reapplySteeringPlanNotes({ store, planFolder, repoRoot });
    await reapplySteeringPlanNotes({ store, planFolder, repoRoot });

    const body = await readFile(path.join(planFolder, "milestone-plan.md"), "utf8");
    const occurrences = body.match(/source: tool:inst-1/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });
});
