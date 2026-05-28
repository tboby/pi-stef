import { describe, expect, it } from "vitest";

import { validateExecutionStrategy, type ExecutionStrategy } from "../src/plan/execution-strategy";
import { parseTrackerText } from "../src/plan/tracker";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { planExecutionWaves } from "../src/tools/execution-scheduler";

const tracker = parseTrackerText(`### M1: One

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-101 | one a | pending | |
| S-102 | one b | completed | prior |
| S-103 | one c | in-dev | |

**Approval Status:** pending

### M2: Two

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-201 | two a | pending | |

**Approval Status:** pending

### M3: Three

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-301 | three a | pending | |

**Approval Status:** pending
`);

const strategy: ExecutionStrategy = {
  version: 1,
  maxParallelMilestones: 8,
  maxParallelStoriesPerMilestone: 8,
  milestoneWaves: [
    { id: "W1", milestones: ["M1", "M2", "M3"], maxParallel: 8 },
  ],
  stories: {
    M1: {
      maxParallelStories: 8,
      storyWaves: [
        {
          id: "M1-W1",
          stories: ["S-101", "S-102", "S-103"],
          maxParallel: 8,
          writeSets: {
            "S-101": ["a.ts"],
            "S-102": ["b.ts"],
            "S-103": ["c.ts"],
          },
        },
      ],
    },
    M2: {
      maxParallelStories: 1,
      storyWaves: [
        { id: "M2-W1", stories: ["S-201"], maxParallel: 1, writeSets: { "S-201": ["d.ts"] } },
      ],
    },
    M3: {
      maxParallelStories: 1,
      storyWaves: [
        { id: "M3-W1", stories: ["S-301"], maxParallel: 1, writeSets: { "S-301": ["e.ts"] } },
      ],
    },
  },
};

describe("execution scheduler", () => {
  it("chunks milestone and story waves by resolved parallel caps and skips completed lanes", () => {
    const resolved = validateExecutionStrategy(strategy, tracker, {
      source: "file",
      maxParallelMilestones: 8,
      maxParallelStoriesPerMilestone: 8,
    });
    const schedule = planExecutionWaves({
      strategy: resolved,
      milestones: tracker.milestones,
      mode: "all-milestones",
      parallel: { ...DEFAULT_CONFIG.parallel, max_milestones: 2, max_stories_per_milestone: 1 },
    });

    expect(schedule.enabled).toBe(true);
    expect(schedule.milestoneBatches.map((batch) => batch.milestones.map((lane) => lane.milestone.id))).toEqual([
      ["M1", "M2"],
      ["M3"],
    ]);
    const m1 = schedule.milestoneBatches[0].milestones[0];
    expect(m1.storyBatches.map((batch) => batch.stories.map((lane) => lane.story.id))).toEqual([
      ["S-101"],
      ["S-103"],
    ]);
    expect(schedule.skippedStories).toContain("S-102");
  });

  it("single-milestone mode schedules all pending milestones as separate batches so the gate can stop", () => {
    const resolved = validateExecutionStrategy(strategy, tracker, {
      source: "file",
      maxParallelMilestones: 8,
      maxParallelStoriesPerMilestone: 8,
    });
    const schedule = planExecutionWaves({
      strategy: resolved,
      milestones: tracker.milestones,
      mode: "single-milestone",
      parallel: DEFAULT_CONFIG.parallel,
    });
    expect(schedule.milestoneBatches.map((batch) => batch.milestones.map((lane) => lane.milestone.id))).toEqual([
      ["M1"],
      ["M2"],
      ["M3"],
    ]);
  });

  it("propagates abort before building batches", () => {
    const resolved = validateExecutionStrategy(strategy, tracker, {
      source: "file",
      maxParallelMilestones: 8,
      maxParallelStoriesPerMilestone: 8,
    });
    const controller = new AbortController();
    controller.abort(new Error("stop now"));
    expect(() =>
      planExecutionWaves({
        strategy: resolved,
        milestones: tracker.milestones,
        mode: "all-milestones",
        parallel: DEFAULT_CONFIG.parallel,
        signal: controller.signal,
      }),
    ).toThrow(/stop now/);
  });
});
