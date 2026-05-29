/**
 * Tests for consistent prompt capping across all sf-team tools.
 * Prevents E2BIG crashes when prompts passed via `-p` exceed macOS ARG_MAX (~1MB).
 *
 * Layer 1: Per-element caps with transcript hints (truncateWithTranscriptHint)
 * Layer 2: Spawn-level safety net (SPAWN_TASK_CAP_BYTES guard in buildPiArgv)
 */
import { describe, expect, it } from "vitest";

import {
  DEV_DIFF_CAP_BYTES,
  DEV_PLAN_CAP_BYTES,
  RESTART_TASK_CAP_BYTES,
} from "../src/tools/impl-summary";
import {
  PLAN_PAYLOAD_CAP_BYTES,
  SPAWN_TASK_CAP_BYTES,
  truncateWithTranscriptHint,
} from "../src/tools/shared";

// ── Layer 1: Constants ──────────────────────────────────────────────────────

describe("Prompt capping constants", () => {
  it("DEV_DIFF_CAP_BYTES should be 256KB", () => {
    expect(DEV_DIFF_CAP_BYTES).toBe(256 * 1024);
  });

  it("DEV_PLAN_CAP_BYTES should be 128KB", () => {
    expect(DEV_PLAN_CAP_BYTES).toBe(128 * 1024);
  });

  it("RESTART_TASK_CAP_BYTES should be 128KB", () => {
    expect(RESTART_TASK_CAP_BYTES).toBe(128 * 1024);
  });

  it("SPAWN_TASK_CAP_BYTES should be 768KB", () => {
    expect(SPAWN_TASK_CAP_BYTES).toBe(768 * 1024);
  });
});

// ── Layer 1: truncateWithTranscriptHint ──────────────────────────────────────

describe("truncateWithTranscriptHint", () => {
  it("passes through text under the cap unchanged", () => {
    const short = "Hello, world!";
    const result = truncateWithTranscriptHint(short, 1024, "test-hint");
    expect(result).toBe(short);
  });

  it("truncates text at the byte cap and appends transcript hint", () => {
    const big = "A".repeat(200_000);
    const cap = 100_000;
    const result = truncateWithTranscriptHint(big, cap, "transcript-pattern-*.md");

    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(big.length);
    expect(result).toContain("truncated at");
    expect(result).toContain("transcript-pattern-*.md");
    expect(result).toContain("read/grep/find/ls");
  });

  it("truncates to well under the original size plus the hint marker", () => {
    const big = "X".repeat(300_000);
    const cap = 100_000;
    const result = truncateWithTranscriptHint(big, cap, "hint");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(110_000);
  });
});

// ── Layer 1: Compose function caps ──────────────────────────────────────────

/**
 * Helper: create a string of exactly `targetBytes` bytes (ASCII-safe).
 */
function bytesOf(targetBytes: number): string {
  return "A".repeat(targetBytes);
}

/**
 * Helper: standard findings object for revise functions.
 */
const FINDINGS = {
  findings: { P0: ["fix this"], P1: [], P2: [], P3: [] },
};

// --- composeMilestoneRevise (implement.ts) ---

import { composeMilestoneRevise } from "../src/tools/implement";

describe("composeMilestoneRevise caps prior diff", () => {
  it("truncates diff when it exceeds DEV_DIFF_CAP_BYTES", () => {
    const hugeDiff = bytesOf(DEV_DIFF_CAP_BYTES + 100_000);
    const result = composeMilestoneRevise("M1", hugeDiff, FINDINGS);
    expect(result).toContain("truncated at");
    expect(result).toContain("read/grep/find/ls");
    expect(Buffer.byteLength(result, "utf8")).toBeLessThan(hugeDiff.length);
  });

  it("leaves diff intact when under the cap", () => {
    const smallDiff = bytesOf(1024);
    const result = composeMilestoneRevise("M1", smallDiff, FINDINGS);
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallDiff);
  });
});

// --- composeDevRevise (run-task-workflow.ts) ---

import { composeDevRevise } from "../src/tools/run-task-workflow";

describe("composeDevRevise caps prior diff", () => {
  it("truncates diff when it exceeds DEV_DIFF_CAP_BYTES", () => {
    const hugeDiff = bytesOf(DEV_DIFF_CAP_BYTES + 100_000);
    const result = composeDevRevise(hugeDiff, FINDINGS);
    expect(result).toContain("truncated at");
    expect(result).toContain("read/grep/find/ls");
  });

  it("leaves diff intact when under the cap", () => {
    const smallDiff = bytesOf(1024);
    const result = composeDevRevise(smallDiff, FINDINGS);
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallDiff);
  });
});

// --- composeDeveloperBrief (run-task-workflow.ts) ---

import { composeDeveloperBrief } from "../src/tools/run-task-workflow";

describe("composeDeveloperBrief caps plan text", () => {
  it("truncates plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = bytesOf(DEV_PLAN_CAP_BYTES + 50_000);
    const result = composeDeveloperBrief(hugePlan);
    expect(result).toContain("truncated at");
    expect(result).toContain("read/grep/find/ls");
  });

  it("leaves plan intact when under the cap", () => {
    const smallPlan = "# Plan\n\nDo the thing.";
    const result = composeDeveloperBrief(smallPlan);
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallPlan);
  });
});

// --- composeMilestoneBrief (implement.ts) ---

import { composeMilestoneBrief } from "../src/tools/implement";

describe("composeMilestoneBrief caps milestone section", () => {
  it("truncates milestone plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = `## M1 Test\n\n${bytesOf(DEV_PLAN_CAP_BYTES + 50_000)}`;
    const result = composeMilestoneBrief(
      { id: "M1", title: "Test", stories: [] } as any,
      hugePlan,
    );
    expect(result).toContain("truncated at");
    expect(result).toContain("read/grep/find/ls");
  });

  it("leaves milestone plan intact when under the cap", () => {
    const smallPlan = "## M1 Test\n\nSmall milestone.";
    const result = composeMilestoneBrief(
      { id: "M1", title: "Test", stories: [] } as any,
      smallPlan,
    );
    expect(result).not.toContain("truncated at");
  });
});

// --- composeStoryBrief (implement.ts) ---

import { composeStoryBrief } from "../src/tools/implement";

describe("composeStoryBrief caps milestone section", () => {
  it("truncates milestone plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = `## M1 Test\n\n${bytesOf(DEV_PLAN_CAP_BYTES + 50_000)}`;
    const result = composeStoryBrief(
      { id: "M1", title: "Test", stories: [] } as any,
      { id: "S-101", description: "Story" } as any,
      ["file.ts"],
      hugePlan,
    );
    expect(result).toContain("truncated at");
  });

  it("leaves milestone plan intact when under the cap", () => {
    const smallPlan = "## M1 Test\n\nSmall.";
    const result = composeStoryBrief(
      { id: "M1", title: "Test", stories: [] } as any,
      { id: "S-101", description: "Story" } as any,
      ["file.ts"],
      smallPlan,
    );
    expect(result).not.toContain("truncated at");
  });
});

// --- composeStoryEmptyDiffReprompt (implement.ts) ---

import { composeStoryEmptyDiffReprompt } from "../src/tools/implement";

describe("composeStoryEmptyDiffReprompt caps milestone section", () => {
  it("truncates milestone plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = `## M1 Test\n\n${bytesOf(DEV_PLAN_CAP_BYTES + 50_000)}`;
    const result = composeStoryEmptyDiffReprompt(
      { id: "M1", title: "Test", stories: [] } as any,
      { id: "S-101", description: "Story" } as any,
      ["file.ts"],
      hugePlan,
      "/cwd",
      1,
    );
    expect(result).toContain("truncated at");
  });

  it("leaves milestone plan intact when under the cap", () => {
    const smallPlan = "## M1 Test\n\nSmall.";
    const result = composeStoryEmptyDiffReprompt(
      { id: "M1", title: "Test", stories: [] } as any,
      { id: "S-101", description: "Story" } as any,
      ["file.ts"],
      smallPlan,
      "/cwd",
      1,
    );
    expect(result).not.toContain("truncated at");
  });
});

// --- composePlanRevise (run-task-workflow.ts) ---

import { composePlanRevise } from "../src/tools/run-task-workflow";

describe("composePlanRevise caps plan text", () => {
  it("truncates prev plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = bytesOf(DEV_PLAN_CAP_BYTES + 50_000);
    const result = composePlanRevise(hugePlan, FINDINGS);
    expect(result).toContain("truncated at");
  });

  it("truncates parentMilestonePlan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const smallPlan = "# Plan";
    const hugeParent = bytesOf(DEV_PLAN_CAP_BYTES + 50_000);
    const result = composePlanRevise(smallPlan, FINDINGS, {
      slug: "test",
      parentMilestonePlan: hugeParent,
    });
    expect(result).toContain("truncated at");
  });

  it("leaves plans intact when under the cap", () => {
    const smallPlan = "# Plan\n\nSmall.";
    const result = composePlanRevise(smallPlan, FINDINGS);
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallPlan);
  });
});

// --- composeReviseBrief (plan.ts) ---

import { composeReviseBrief } from "../src/tools/plan";

describe("composeReviseBrief caps prior plan", () => {
  it("truncates prior plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = bytesOf(DEV_PLAN_CAP_BYTES + 50_000);
    const result = composeReviseBrief(hugePlan, FINDINGS);
    expect(result).toContain("truncated at");
  });

  it("leaves prior plan intact when under the cap", () => {
    const smallPlan = "# Plan\n\nSmall.";
    const result = composeReviseBrief(smallPlan, FINDINGS);
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallPlan);
  });
});

// --- composePlanPatchRevisePrompt (plan-revision.ts) ---

import { composePlanPatchRevisePrompt } from "../src/tools/plan-revision";

describe("composePlanPatchRevisePrompt caps prior plan", () => {
  it("truncates prior plan when it exceeds DEV_PLAN_CAP_BYTES", () => {
    const hugePlan = bytesOf(DEV_PLAN_CAP_BYTES + 50_000);
    const result = composePlanPatchRevisePrompt({
      label: "test",
      priorPlan: hugePlan,
      findings: FINDINGS,
    });
    expect(result).toContain("truncated at");
  });

  it("leaves prior plan intact when under the cap", () => {
    const smallPlan = "# Plan\n\nSmall.";
    const result = composePlanPatchRevisePrompt({
      label: "test",
      priorPlan: smallPlan,
      findings: FINDINGS,
    });
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallPlan);
  });
});

// --- composeRestartPrompt (agent-control.ts) ---

import { composeRestartPrompt } from "../src/steering/agent-control";

describe("composeRestartPrompt caps original task", () => {
  it("truncates originalTask when it exceeds RESTART_TASK_CAP_BYTES", () => {
    const hugeTask = bytesOf(RESTART_TASK_CAP_BYTES + 50_000);
    const result = composeRestartPrompt({
      originalTaskSummary: "short summary",
      originalTask: hugeTask,
      steeringInstruction: "continue",
      priorPartialStatus: "was running",
    });
    expect(result).toContain("truncated at");
  });

  it("leaves originalTask intact when under the cap", () => {
    const smallTask = "Do the thing.";
    const result = composeRestartPrompt({
      originalTaskSummary: "summary",
      originalTask: smallTask,
      steeringInstruction: "continue",
      priorPartialStatus: "was running",
    });
    expect(result).not.toContain("truncated at");
    expect(result).toContain(smallTask);
  });

  it("handles missing originalTask gracefully", () => {
    const result = composeRestartPrompt({
      originalTaskSummary: "summary",
      steeringInstruction: "continue",
      priorPartialStatus: "was running",
    });
    expect(result).not.toContain("truncated at");
  });
});

// ── Layer 2: Spawn-level guard ──────────────────────────────────────────────

import { buildPiArgv } from "../src/runtime/argv";

describe("buildPiArgv spawn-level E2BIG guard", () => {
  it("throws descriptive error when task exceeds SPAWN_TASK_CAP_BYTES", () => {
    const hugeTask = bytesOf(SPAWN_TASK_CAP_BYTES + 100_000);
    expect(() =>
      buildPiArgv({ role: "developer", model: "test-model" } as any, hugeTask),
    ).toThrow(/exceeds SPAWN_TASK_CAP_BYTES/);
  });

  it("does not throw for tasks under the cap", () => {
    const smallTask = "Do the thing.";
    const argv = buildPiArgv(
      { role: "developer", model: "test-model" } as any,
      smallTask,
    );
    expect(argv).toContain("-p");
    expect(argv).toContain(smallTask);
  });
});
