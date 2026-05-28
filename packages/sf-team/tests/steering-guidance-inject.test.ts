import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACTIVE_STEERING_GUIDANCE_HEADING,
  loadActiveSteeringGuidance,
  prependSteeringGuidanceSection,
} from "../src/steering/guidance-inject";
import { createSteeringStore } from "../src/steering/store";

describe("loadActiveSteeringGuidance", () => {
  let rootDir: string;
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "guidance-inject-"));
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  async function seed(scope: { kind: "workflow" | "milestone" | "story" | "role"; target?: string }, opts: {
    workflowId?: string;
    instructionId: string;
    text: string;
  }) {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const row = await store.appendGuidance({
      instructionId: opts.instructionId,
      workflowId: opts.workflowId ?? "wf-1",
      scope,
      text: opts.text,
      source: "tool",
    });
    await store.activateGuidance(row.id);
    await store.updateInstructionStatus(opts.instructionId, "applied");
    return { store, row };
  }

  it("returns nothing when no guidance is active", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const result = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    });
    expect(result.lines).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("includes workflow-scoped guidance for any agent in the workflow", async () => {
    const { store } = await seed({ kind: "workflow" }, { instructionId: "inst-1", text: "Workflow-wide rule." });
    const result = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer", milestoneId: "M1", storyId: "S-101",
    });
    expect(result.lines).toEqual(["- [steering tool:inst-1] Workflow-wide rule."]);
  });

  it("filters milestone-scoped guidance to its milestone target", async () => {
    const { store } = await seed({ kind: "milestone", target: "M2" }, { instructionId: "inst-1", text: "M2 only" });
    const matching = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer", milestoneId: "M2",
    });
    expect(matching.lines).toHaveLength(1);
    const otherMilestone = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer", milestoneId: "M3",
    });
    expect(otherMilestone.lines).toHaveLength(0);
  });

  it("filters role-scoped guidance to its role target", async () => {
    const { store } = await seed({ kind: "role", target: "reviewer" }, { instructionId: "inst-1", text: "Reviewer rule." });
    const reviewer = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "reviewer",
    });
    expect(reviewer.lines).toHaveLength(1);
    const developer = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    });
    expect(developer.lines).toHaveLength(0);
  });

  it("filters story-scoped guidance to its story target", async () => {
    const { store } = await seed({ kind: "story", target: "S-101" }, { instructionId: "inst-1", text: "Story rule." });
    const matching = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer", storyId: "S-101",
    });
    expect(matching.lines).toHaveLength(1);
    const noStory = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    });
    expect(noStory.lines).toHaveLength(0);
  });

  it("drops oldest entries first when total injected text exceeds maxChars", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const big = "x".repeat(1500);
    const messages = [`A:${big}`, `B:${big}`, `C:${big}`];
    let idx = 0;
    let messages2: string[] = [];
    for (const text of messages) {
      idx += 1;
      const row = await store.appendGuidance({
        instructionId: `inst-${idx}`, workflowId: "wf-1", scope: { kind: "workflow" }, text, source: "tool",
      });
      await store.activateGuidance(row.id);
      await store.updateInstructionStatus(`inst-${idx}`, "applied");
      messages2.push(text);
      await new Promise((r) => setTimeout(r, 5)); // ensure appendedAt timestamps differ
    }
    const result = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    }, { maxChars: 3500 });
    // Newest entries kept; oldest (inst-1) dropped first.
    expect(result.truncated).toBe(true);
    expect(result.lines.some((l) => l.includes("inst-1"))).toBe(false);
    expect(result.lines.some((l) => l.includes("inst-2"))).toBe(true);
    expect(result.lines.some((l) => l.includes("inst-3"))).toBe(true);
  });

  it("prepends the section with the canonical heading", async () => {
    const prompt = prependSteeringGuidanceSection("Original prompt body.", [
      "- [steering tool:inst-1] Be careful.",
    ]);
    expect(prompt.startsWith(ACTIVE_STEERING_GUIDANCE_HEADING)).toBe(true);
    expect(prompt).toContain("Original prompt body.");
  });

  it("returns prompt unchanged when no lines to inject", async () => {
    expect(prependSteeringGuidanceSection("foo", [])).toBe("foo");
  });

  it("multi-line guidance text gets the provenance prefix on EVERY continuation line", async () => {
    const { store } = await seed({ kind: "workflow" }, {
      instructionId: "inst-multi",
      text: "Line one of the guidance.\nLine two should also carry provenance.\nLine three too.",
    });
    const result = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    });
    expect(result.lines).toHaveLength(1);
    const rendered = result.lines[0];
    for (const line of rendered.split("\n")) {
      expect(line).toContain("[steering tool:inst-multi]");
    }
  });
});
