import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendSteeringPlanNote, PLAN_NOTES_HEADING } from "../src/steering/guidance-plan-notes";
import type { SteeringGuidance } from "../src/steering/types";

function fakeGuidance(overrides: Partial<SteeringGuidance> = {}): SteeringGuidance {
  return {
    id: "g-1",
    instructionId: "inst-1",
    workflowId: "wf-1",
    appendedAt: "2026-05-19T12:00:00.000Z",
    scope: { kind: "workflow" },
    text: "Be careful with mocks.",
    source: "tool",
    status: "active",
    ...overrides,
  };
}

describe("appendSteeringPlanNote", () => {
  let repoRoot: string;
  let planFolder: string;
  beforeEach(async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "plan-notes-"));
    planFolder = path.join(repoRoot, "ai_plan", "demo-plan");
    await mkdir(planFolder, { recursive: true });
  });
  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("creates ## Steering Notes section + bullet in milestone-plan.md", async () => {
    const result = await appendSteeringPlanNote({
      planFolderPath: planFolder, repoRoot, guidance: fakeGuidance(),
    });
    expect(result.wrote.milestonePlan).toBe(true);
    expect(result.wrote.finalTranscript).toBe(true);
    const body = await readFile(path.join(planFolder, "milestone-plan.md"), "utf8");
    expect(body).toContain(PLAN_NOTES_HEADING);
    expect(body).toContain("- 2026-05-19T12:00:00.000Z: Be careful with mocks. (scope: workflow, source: tool:inst-1)");
  });

  it("is idempotent: a second call with same instructionId does not duplicate the bullet", async () => {
    await appendSteeringPlanNote({ planFolderPath: planFolder, repoRoot, guidance: fakeGuidance() });
    const second = await appendSteeringPlanNote({ planFolderPath: planFolder, repoRoot, guidance: fakeGuidance() });
    expect(second.wrote.milestonePlan).toBe(false);
    expect(second.wrote.finalTranscript).toBe(false);
    const body = await readFile(path.join(planFolder, "milestone-plan.md"), "utf8");
    const occurrences = body.match(/source: tool:inst-1/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  it("rejects paths outside the repo root via assertPathInsideRoot", async () => {
    await expect(appendSteeringPlanNote({
      planFolderPath: "/tmp/some-other-place",
      repoRoot,
      guidance: fakeGuidance(),
    })).rejects.toThrow();
  });

  it("appends scope target to bullet when scope is milestone/story/role", async () => {
    await appendSteeringPlanNote({
      planFolderPath: planFolder, repoRoot,
      guidance: fakeGuidance({ scope: { kind: "milestone", target: "M2" }, instructionId: "inst-m2" }),
    });
    const body = await readFile(path.join(planFolder, "milestone-plan.md"), "utf8");
    expect(body).toContain("(scope: milestone:M2, source: tool:inst-m2)");
  });

  it("appends to existing ## Steering Notes section when present", async () => {
    const filePath = path.join(planFolder, "milestone-plan.md");
    await writeFile(filePath, `# Plan\n\n## Steering Notes\n- 2026-05-18T00:00:00.000Z: Prior note. (scope: workflow, source: slash:older)\n`, "utf8");
    await appendSteeringPlanNote({ planFolderPath: planFolder, repoRoot, guidance: fakeGuidance() });
    const body = await readFile(filePath, "utf8");
    const headingOccurrences = body.match(new RegExp(PLAN_NOTES_HEADING, "g"))?.length ?? 0;
    expect(headingOccurrences).toBe(1);
    expect(body).toContain("source: slash:older");
    expect(body).toContain("source: tool:inst-1");
  });
});
