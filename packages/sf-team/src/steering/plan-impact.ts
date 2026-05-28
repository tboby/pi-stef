import type { ResolvedExecutionStrategy } from "../plan/execution-strategy";
import type { ParsedMilestone, ParsedTracker } from "../plan/tracker";
import type { SteeringDecision, SteeringInstruction } from "./types";

export interface PlanImpactInput {
  tracker: ParsedTracker;
  decision: SteeringDecision;
  instruction?: SteeringInstruction;
  executionStrategy?: ResolvedExecutionStrategy;
}

export interface PlanImpact {
  affectedMilestones: string[];
  affectedStories: string[];
  replayMilestones: string[];
  replayStories: string[];
  earliestReplayPoint?: {
    milestoneId?: string;
    storyId?: string;
    reason: string;
  };
  planStructureChanged: boolean;
  requiresCompletedWorkConfirmation: boolean;
}

export function analyzePlanImpact(input: PlanImpactInput): PlanImpact {
  const index = trackerIndex(input.tracker);
  const affectedMilestones = new Set<string>();
  const affectedStories = new Set<string>();

  for (const milestoneId of input.decision.affectedMilestones) {
    if (index.milestones.has(milestoneId)) affectedMilestones.add(milestoneId);
  }
  for (const storyId of input.decision.affectedStories) {
    const owner = index.storyToMilestone.get(storyId);
    if (!owner) continue;
    affectedStories.add(storyId);
  }
  const replayPoint = input.decision.earliestReplayPoint;
  if (replayPoint?.milestoneId && index.milestones.has(replayPoint.milestoneId)) {
    affectedMilestones.add(replayPoint.milestoneId);
  }
  if (replayPoint?.storyId) {
    const owner = index.storyToMilestone.get(replayPoint.storyId);
    if (owner) {
      affectedStories.add(replayPoint.storyId);
      affectedMilestones.add(owner);
    }
  }

  const fullReplayMilestones = cascadeMilestones({
    affectedMilestones,
    tracker: input.tracker,
    strategy: input.executionStrategy,
  });
  const replayStories = cascadeStories({
    affectedStories,
    replayMilestones: fullReplayMilestones,
    tracker: input.tracker,
    strategy: input.executionStrategy,
  });
  const replayMilestones = milestonesForStories(input.tracker, replayStories, fullReplayMilestones);
  const earliest = earliestReplayPoint(input.tracker, replayMilestones, replayStories, input.decision.summary);
  const impactedCompleted = replayStories.some((storyId) => index.storyById.get(storyId)?.status === "completed")
    || replayMilestones.some((milestoneId) => index.milestoneById.get(milestoneId)?.approvalStatus?.startsWith("approved"));

  return {
    affectedMilestones: [...affectedMilestones],
    affectedStories: [...affectedStories],
    replayMilestones,
    replayStories,
    earliestReplayPoint: earliest,
    planStructureChanged: input.decision.planPatchRequired || input.decision.amendedUserFacingPlanText !== undefined,
    requiresCompletedWorkConfirmation: impactedCompleted || input.decision.kind === "backtrack-completed-work",
  };
}

function cascadeMilestones(input: {
  affectedMilestones: Set<string>;
  tracker: ParsedTracker;
  strategy?: ResolvedExecutionStrategy;
}): string[] {
  if (input.affectedMilestones.size === 0) return [];
  if (!input.strategy) return milestoneSuffix(input.tracker.milestones, input.affectedMilestones);

  const waveByMilestone = new Map<string, string>();
  for (const wave of input.strategy.milestoneWaves) {
    for (const milestoneId of wave.milestones) waveByMilestone.set(milestoneId, wave.id);
  }
  const affectedWaves = new Set(
    [...input.affectedMilestones]
      .map((milestoneId) => waveByMilestone.get(milestoneId))
      .filter((waveId): waveId is string => !!waveId),
  );
  const includeWaves = cascadeWaveIds(
    input.strategy.milestoneWaves.map((wave) => ({ id: wave.id, dependsOn: wave.dependsOn })),
    affectedWaves,
  );
  const out = new Set<string>();
  for (const wave of input.strategy.milestoneWaves) {
    if (!includeWaves.has(wave.id)) continue;
    for (const milestoneId of wave.milestones) out.add(milestoneId);
  }
  return orderedMilestones(input.tracker, out);
}

function cascadeStories(input: {
  affectedStories: Set<string>;
  replayMilestones: string[];
  tracker: ParsedTracker;
  strategy?: ResolvedExecutionStrategy;
}): string[] {
  const out = new Set<string>();
  const replayMilestones = new Set(input.replayMilestones);
  const storyOwnerMilestones = new Set<string>();
  for (const milestone of input.tracker.milestones) {
    if (replayMilestones.has(milestone.id)) {
      for (const story of milestone.stories) out.add(story.id);
      continue;
    }
    const affectedInMilestone = milestone.stories
      .filter((story) => input.affectedStories.has(story.id))
      .map((story) => story.id);
    if (affectedInMilestone.length === 0) continue;
    storyOwnerMilestones.add(milestone.id);
    for (const storyId of cascadeStoriesWithinMilestone(milestone, affectedInMilestone, input.strategy)) {
      out.add(storyId);
    }
  }
  for (const milestoneId of downstreamMilestones(input.tracker, storyOwnerMilestones, input.strategy)) {
    const milestone = input.tracker.milestones.find((candidate) => candidate.id === milestoneId);
    for (const story of milestone?.stories ?? []) out.add(story.id);
  }
  return orderedStories(input.tracker, out);
}

function cascadeStoriesWithinMilestone(
  milestone: ParsedMilestone,
  affectedStories: string[],
  strategy?: ResolvedExecutionStrategy,
): string[] {
  const affected = new Set(affectedStories);
  const storyStrategy = strategy?.stories[milestone.id];
  if (!storyStrategy) {
    const firstIndex = milestone.stories.findIndex((story) => affected.has(story.id));
    return firstIndex < 0 ? [] : milestone.stories.slice(firstIndex).map((story) => story.id);
  }
  const waveByStory = new Map<string, string>();
  for (const wave of storyStrategy.storyWaves) {
    for (const storyId of wave.stories) waveByStory.set(storyId, wave.id);
  }
  const affectedWaves = new Set(
    affectedStories
      .map((storyId) => waveByStory.get(storyId))
      .filter((waveId): waveId is string => !!waveId),
  );
  const includeWaves = cascadeWaveIds(
    storyStrategy.storyWaves.map((wave) => ({ id: wave.id, dependsOn: wave.dependsOn })),
    affectedWaves,
  );
  const out = new Set<string>();
  for (const wave of storyStrategy.storyWaves) {
    if (!includeWaves.has(wave.id)) continue;
    for (const storyId of wave.stories) out.add(storyId);
  }
  return milestone.stories.filter((story) => out.has(story.id)).map((story) => story.id);
}

function cascadeWaveIds(
  waves: Array<{ id: string; dependsOn: string[] }>,
  affectedWaves: Set<string>,
): Set<string> {
  const include = new Set(affectedWaves);
  let changed = true;
  while (changed) {
    changed = false;
    for (const wave of waves) {
      if (include.has(wave.id)) continue;
      if (wave.dependsOn.some((dep) => include.has(dep))) {
        include.add(wave.id);
        changed = true;
      }
    }
  }
  return include;
}

function downstreamMilestones(
  tracker: ParsedTracker,
  ownerMilestones: Set<string>,
  strategy?: ResolvedExecutionStrategy,
): string[] {
  if (ownerMilestones.size === 0) return [];
  if (!strategy) {
    const first = tracker.milestones.findIndex((milestone) => ownerMilestones.has(milestone.id));
    return first < 0 ? [] : tracker.milestones.slice(first + 1).map((milestone) => milestone.id);
  }
  const waveByMilestone = new Map<string, string>();
  for (const wave of strategy.milestoneWaves) {
    for (const milestoneId of wave.milestones) waveByMilestone.set(milestoneId, wave.id);
  }
  const ownerWaves = new Set(
    [...ownerMilestones]
      .map((milestoneId) => waveByMilestone.get(milestoneId))
      .filter((waveId): waveId is string => !!waveId),
  );
  const all = cascadeWaveIds(
    strategy.milestoneWaves.map((wave) => ({ id: wave.id, dependsOn: wave.dependsOn })),
    ownerWaves,
  );
  for (const ownerWave of ownerWaves) all.delete(ownerWave);
  const out = new Set<string>();
  for (const wave of strategy.milestoneWaves) {
    if (!all.has(wave.id)) continue;
    for (const milestoneId of wave.milestones) out.add(milestoneId);
  }
  return orderedMilestones(tracker, out);
}

function earliestReplayPoint(
  tracker: ParsedTracker,
  replayMilestones: string[],
  replayStories: string[],
  reason: string,
): PlanImpact["earliestReplayPoint"] {
  if (replayStories.length > 0) {
    const storyId = replayStories[0];
    return { milestoneId: trackerIndex(tracker).storyToMilestone.get(storyId), storyId, reason };
  }
  if (replayMilestones.length > 0) return { milestoneId: replayMilestones[0], reason };
  return undefined;
}

function milestoneSuffix(milestones: ParsedMilestone[], affected: Set<string>): string[] {
  const first = milestones.findIndex((milestone) => affected.has(milestone.id));
  return first < 0 ? [] : milestones.slice(first).map((milestone) => milestone.id);
}

function orderedMilestones(tracker: ParsedTracker, milestones: Set<string>): string[] {
  return tracker.milestones.filter((milestone) => milestones.has(milestone.id)).map((milestone) => milestone.id);
}

function orderedStories(tracker: ParsedTracker, stories: Set<string>): string[] {
  return tracker.milestones.flatMap((milestone) => milestone.stories.filter((story) => stories.has(story.id)).map((story) => story.id));
}

function milestonesForStories(tracker: ParsedTracker, storyIds: string[], fullReplayMilestones: string[]): string[] {
  const out = new Set(fullReplayMilestones);
  const stories = new Set(storyIds);
  for (const milestone of tracker.milestones) {
    if (milestone.stories.some((story) => stories.has(story.id))) out.add(milestone.id);
  }
  return orderedMilestones(tracker, out);
}

function trackerIndex(tracker: ParsedTracker) {
  const milestones = new Set(tracker.milestones.map((milestone) => milestone.id));
  const milestoneById = new Map(tracker.milestones.map((milestone) => [milestone.id, milestone]));
  const storyToMilestone = new Map<string, string>();
  const storyById = new Map<string, ParsedMilestone["stories"][number]>();
  for (const milestone of tracker.milestones) {
    for (const story of milestone.stories) {
      storyToMilestone.set(story.id, milestone.id);
      storyById.set(story.id, story);
    }
  }
  return { milestones, milestoneById, storyToMilestone, storyById };
}
