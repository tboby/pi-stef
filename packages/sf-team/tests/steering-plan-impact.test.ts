import { describe, expect, it } from "vitest";

import { validateExecutionStrategy } from "../src/plan/execution-strategy";
import { parseTrackerText } from "../src/plan/tracker";
import { analyzePlanImpact } from "../src/steering/plan-impact";
import type { SteeringDecision } from "../src/steering/types";

function tracker() {
  return parseTrackerText(`### M1: Foundation

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-101 | first | completed | abc111 |
| S-102 | second | completed | abc222 |

**Approval Status:** approved (abc222)

### M2: Followup

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-201 | followup | completed | def111 |

**Approval Status:** approved (def111)
`);
}

function strategy() {
  return validateExecutionStrategy({
    version: 1,
    maxParallelMilestones: 1,
    maxParallelStoriesPerMilestone: 1,
    milestoneWaves: [
      { id: "W1", milestones: ["M1"], maxParallel: 1 },
      { id: "W2", milestones: ["M2"], dependsOn: ["W1"], maxParallel: 1 },
    ],
    stories: {
      M1: {
        maxParallelStories: 1,
        storyWaves: [
          { id: "M1-W1", stories: ["S-101"], maxParallel: 1 },
          { id: "M1-W2", stories: ["S-102"], dependsOn: ["M1-W1"], maxParallel: 1 },
        ],
      },
      M2: {
        maxParallelStories: 1,
        storyWaves: [{ id: "M2-W1", stories: ["S-201"], maxParallel: 1 }],
      },
    },
  }, tracker());
}

function decision(patch: Partial<SteeringDecision>): SteeringDecision {
  return {
    id: "decision-1",
    instructionId: "instruction-1",
    decidedAt: "2026-05-17T00:00:00.000Z",
    kind: "backtrack-completed-work",
    summary: "Replay affected work",
    rationale: "User changed requirements",
    planPatchRequired: false,
    targetAgents: [],
    abortAgents: [],
    discardAgentChanges: [],
    affectedMilestones: [],
    affectedStories: [],
    affectedFiles: [],
    risks: [],
    activeAgentsVersion: 0,
    referencedAgentStates: {},
    referencedPlanHashes: {},
    requiresConfirmation: true,
    ...patch,
  };
}

describe("steering plan impact", () => {
  it("replays a completed story and dependent later stories in the same milestone", () => {
    const impact = analyzePlanImpact({
      tracker: tracker(),
      executionStrategy: strategy(),
      decision: decision({ affectedStories: ["S-101"] }),
    });

    expect(impact.replayStories).toEqual(["S-101", "S-102", "S-201"]);
    expect(impact.earliestReplayPoint).toMatchObject({ milestoneId: "M1", storyId: "S-101" });
    expect(impact.requiresCompletedWorkConfirmation).toBe(true);
  });

  it("replays a completed milestone and dependent later milestones", () => {
    const impact = analyzePlanImpact({
      tracker: tracker(),
      executionStrategy: strategy(),
      decision: decision({ affectedMilestones: ["M1"] }),
    });

    expect(impact.replayMilestones).toEqual(["M1", "M2"]);
    expect(impact.replayStories).toEqual(["S-101", "S-102", "S-201"]);
  });

  it("marks plan-structure changes for execution-strategy regeneration", () => {
    const impact = analyzePlanImpact({
      tracker: tracker(),
      executionStrategy: strategy(),
      decision: decision({ kind: "amend-plan", planPatchRequired: true, affectedStories: ["S-102"] }),
    });

    expect(impact.planStructureChanged).toBe(true);
    expect(impact.replayStories).toEqual(["S-102", "S-201"]);
  });
});
