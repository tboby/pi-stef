import { readFile } from "node:fs/promises";
import path from "node:path";

import { EXECUTION_STRATEGY_FILE, PLAN_FOLDER_ROOT, planFolderPathFromRoot } from "./paths";
import { parseStoryTracker, type ParsedTracker } from "./tracker";

export type ExecutionStrategySource = "plan" | "file" | "sequential-fallback";

export interface ExecutionStrategy {
  version: 1;
  maxParallelMilestones?: number;
  maxParallelStoriesPerMilestone?: number;
  milestoneWaves: MilestoneWave[];
  stories?: Record<string, MilestoneStoryStrategy>;
}

export interface MilestoneWave {
  id: string;
  milestones: string[];
  dependsOn?: string[];
  maxParallel?: number;
  rationale?: string;
}

export interface MilestoneStoryStrategy {
  maxParallelStories?: number;
  storyWaves: StoryWave[];
}

export interface StoryWave {
  id: string;
  stories: string[];
  dependsOn?: string[];
  maxParallel?: number;
  writeSets?: Record<string, string[]>;
  rationale?: string;
}

export interface ResolvedExecutionStrategy {
  version: 1;
  source: ExecutionStrategySource;
  warnings: string[];
  maxParallelMilestones: number;
  maxParallelStoriesPerMilestone: number;
  milestoneWaves: ResolvedMilestoneWave[];
  stories: Record<string, ResolvedMilestoneStoryStrategy>;
}

export interface ResolvedMilestoneWave {
  id: string;
  milestones: string[];
  dependsOn: string[];
  maxParallel: number;
}

export interface ResolvedMilestoneStoryStrategy {
  maxParallelStories: number;
  storyWaves: ResolvedStoryWave[];
}

export interface ResolvedStoryWave {
  id: string;
  stories: string[];
  dependsOn: string[];
  maxParallel: number;
  writeSets: Record<string, string[]>;
}

export interface ValidateExecutionStrategyOptions {
  source?: ExecutionStrategySource;
  maxParallelMilestones?: number;
  maxParallelStoriesPerMilestone?: number;
}

const DEFAULT_MAX_PARALLEL_MILESTONES = 4;
const DEFAULT_MAX_PARALLEL_STORIES_PER_MILESTONE = 4;

export class ExecutionStrategyValidationError extends Error {
  override name = "ExecutionStrategyValidationError";
}

export function parseExecutionStrategyText(text: string): ExecutionStrategy | null {
  const candidates: string[] = [];
  const sectionMatch = /^##\s+Execution Strategy\b/im.exec(text);
  if (sectionMatch) {
    const section = text.slice(sectionMatch.index);
    const nextSection = /^##\s+(?!Execution Strategy\b)/im.exec(section.slice(1));
    const sectionBody = nextSection ? section.slice(0, nextSection.index + 1) : section;
    candidates.push(...extractFencedJson(sectionBody));
  }
  candidates.push(...extractFencedJson(text));
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) candidates.push(trimmed);

  for (const candidate of candidates) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function validateExecutionStrategy(
  strategy: ExecutionStrategy,
  tracker: ParsedTracker,
  opts: ValidateExecutionStrategyOptions = {},
): ResolvedExecutionStrategy {
  assertRecord(strategy, "execution strategy");
  if (strategy.version !== 1) {
    throw new ExecutionStrategyValidationError("Execution strategy version must be 1");
  }
  if (!Array.isArray(strategy.milestoneWaves) || strategy.milestoneWaves.length === 0) {
    throw new ExecutionStrategyValidationError("Execution strategy must define at least one milestone wave");
  }

  const warnings: string[] = [];
  const maxParallelMilestones = resolveCap({
    name: "maxParallelMilestones",
    value: strategy.maxParallelMilestones,
    fallback: 1,
    limit: opts.maxParallelMilestones ?? DEFAULT_MAX_PARALLEL_MILESTONES,
    warnings,
  });
  const maxParallelStoriesPerMilestone = resolveCap({
    name: "maxParallelStoriesPerMilestone",
    value: strategy.maxParallelStoriesPerMilestone,
    fallback: 1,
    limit: opts.maxParallelStoriesPerMilestone ?? DEFAULT_MAX_PARALLEL_STORIES_PER_MILESTONE,
    warnings,
  });

  const trackerIndex = buildTrackerIndex(tracker);
  const resolvedMilestoneWaves = resolveMilestoneWaves(
    strategy.milestoneWaves,
    trackerIndex.milestoneIds,
    maxParallelMilestones,
    warnings,
  );
  const scheduledMilestones = new Set(resolvedMilestoneWaves.flatMap((w) => w.milestones));
  const missingMilestones = [...trackerIndex.milestoneIds].filter((id) => !scheduledMilestones.has(id));
  if (missingMilestones.length > 0) {
    throw new ExecutionStrategyValidationError(
      `Execution strategy does not schedule milestone(s): ${missingMilestones.join(", ")}`,
    );
  }

  const parallelMilestones = new Set<string>();
  for (const wave of resolvedMilestoneWaves) {
    if (wave.milestones.length > 1 || wave.maxParallel > 1) {
      for (const milestoneId of wave.milestones) parallelMilestones.add(milestoneId);
    }
  }

  const resolvedStories: Record<string, ResolvedMilestoneStoryStrategy> = {};
  const storyStrategies = strategy.stories ?? {};
  for (const milestoneId of scheduledMilestones) {
    const milestoneStoryIds = trackerIndex.storiesByMilestone.get(milestoneId) ?? [];
    const storyStrategy = storyStrategies[milestoneId];
    if (!storyStrategy) {
      if (parallelMilestones.has(milestoneId)) {
        throw new ExecutionStrategyValidationError(
          `Missing story strategy for ${milestoneId} while it runs in a parallel milestone wave`,
        );
      }
      warnings.push(`Missing story strategy for ${milestoneId}; using sequential story fallback`);
      resolvedStories[milestoneId] = resolveStoryStrategy(
        milestoneId,
        buildSequentialStoryStrategy(milestoneId, milestoneStoryIds),
        trackerIndex,
        maxParallelStoriesPerMilestone,
        false,
        warnings,
      );
      continue;
    }
    resolvedStories[milestoneId] = resolveStoryStrategy(
      milestoneId,
      storyStrategy,
      trackerIndex,
      maxParallelStoriesPerMilestone,
      parallelMilestones.has(milestoneId),
      warnings,
    );
  }

  rejectCrossMilestoneWriteConflicts(resolvedMilestoneWaves, resolvedStories);

  return {
    version: 1,
    source: opts.source ?? "plan",
    warnings,
    maxParallelMilestones,
    maxParallelStoriesPerMilestone,
    milestoneWaves: resolvedMilestoneWaves,
    stories: resolvedStories,
  };
}

export function buildSequentialExecutionStrategyArtifact(tracker: ParsedTracker): ExecutionStrategy {
  const milestoneWaves: MilestoneWave[] = [];
  const stories: Record<string, MilestoneStoryStrategy> = {};
  tracker.milestones.forEach((milestone, milestoneIndex) => {
    const waveId = `W${milestoneIndex + 1}`;
    const wave: MilestoneWave = {
      id: waveId,
      milestones: [milestone.id],
      maxParallel: 1,
    };
    if (milestoneIndex > 0) wave.dependsOn = [`W${milestoneIndex}`];
    milestoneWaves.push(wave);
    stories[milestone.id] = buildSequentialStoryStrategy(
      milestone.id,
      milestone.stories.map((s) => s.id),
    );
  });
  return {
    version: 1,
    maxParallelMilestones: 1,
    maxParallelStoriesPerMilestone: 1,
    milestoneWaves,
    stories,
  };
}

export function deriveSequentialExecutionStrategy(tracker: ParsedTracker): ResolvedExecutionStrategy {
  return validateExecutionStrategy(buildSequentialExecutionStrategyArtifact(tracker), tracker, {
    source: "sequential-fallback",
    maxParallelMilestones: 1,
    maxParallelStoriesPerMilestone: 1,
  });
}

export async function loadExecutionStrategyForPlanFolder(
  repoRoot: string,
  slug: string,
  planRoot?: string,
): Promise<ResolvedExecutionStrategy> {
  const resolvedPlanRoot = planRoot ?? path.join(repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const tracker = await parseStoryTracker(repoRoot, slug, resolvedPlanRoot);
  const filePath = path.join(planFolderPathFromRoot(resolvedPlanRoot, slug), EXECUTION_STRATEGY_FILE);
  const body = await readFile(filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (body === undefined) return deriveSequentialExecutionStrategy(tracker);
  const parsed = parseExecutionStrategyText(body);
  if (!parsed) {
    throw new ExecutionStrategyValidationError(`${EXECUTION_STRATEGY_FILE} is not valid execution strategy JSON`);
  }
  return validateExecutionStrategy(parsed, tracker, { source: "file" });
}

function extractFencedJson(text: string): string[] {
  const candidates: string[] = [];
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of text.matchAll(fenceRe)) {
    const body = match[1].trim();
    if (body.startsWith("{")) candidates.push(body);
  }
  return candidates;
}

function parseJsonCandidate(candidate: string): ExecutionStrategy | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (_err) {
    return null;
  }
  if (
    isRecord(parsed)
    && parsed.version === 1
    && Array.isArray(parsed.milestoneWaves)
  ) {
    assertMilestoneWaveArrayShape(parsed.milestoneWaves);
    if (parsed.stories !== undefined) assertStoriesShape(parsed.stories);
    return parsed as unknown as ExecutionStrategy;
  }
  return null;
}

function assertMilestoneWaveArrayShape(waves: unknown[]): void {
  for (let index = 0; index < waves.length; index += 1) {
    assertMilestoneWaveObject(waves[index], `milestoneWaves[${index}]`);
  }
}

function assertStoriesShape(stories: unknown): void {
  assertRecord(stories, "stories");
  for (const [milestoneId, strategy] of Object.entries(stories)) {
    assertRecord(strategy, `stories.${milestoneId}`);
    const storyWaves = strategy.storyWaves;
    if (!Array.isArray(storyWaves)) {
      throw new ExecutionStrategyValidationError(
        `stories.${milestoneId}.storyWaves must be an array of story wave objects`,
      );
    }
    for (let index = 0; index < storyWaves.length; index += 1) {
      assertStoryWaveObject(storyWaves[index], `stories.${milestoneId}.storyWaves[${index}]`);
    }
  }
}

function assertMilestoneWaveObject(value: unknown, pathLabel: string): asserts value is MilestoneWave {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.milestones)) {
    throw new ExecutionStrategyValidationError(
      `${pathLabel} must be an object with id and milestones; got ${describeJsonValue(value)}`,
    );
  }
}

function assertStoryWaveObject(value: unknown, pathLabel: string): asserts value is StoryWave {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.stories)) {
    throw new ExecutionStrategyValidationError(
      `${pathLabel} must be an object with id and stories; got ${describeJsonValue(value)}`,
    );
  }
}

function resolveMilestoneWaves(
  waves: MilestoneWave[],
  knownMilestones: Set<string>,
  globalMax: number,
  warnings: string[],
): ResolvedMilestoneWave[] {
  const waveIds = new Set<string>();
  const scheduledMilestones = new Set<string>();
  const resolved: ResolvedMilestoneWave[] = [];

  for (let index = 0; index < waves.length; index += 1) {
    const wave = waves[index];
    assertMilestoneWaveObject(wave, `milestoneWaves[${index}]`);
    assertWaveId(wave.id, "Milestone wave");
    if (waveIds.has(wave.id)) throw new ExecutionStrategyValidationError(`Duplicate milestone wave id: ${wave.id}`);
    waveIds.add(wave.id);
    if (!Array.isArray(wave.milestones) || wave.milestones.length === 0) {
      throw new ExecutionStrategyValidationError(`Milestone wave ${wave.id} must include at least one milestone`);
    }
    const milestones = wave.milestones.map((milestoneId) => {
      if (!knownMilestones.has(milestoneId)) {
        throw new ExecutionStrategyValidationError(`Unknown milestone id in execution strategy: ${milestoneId}`);
      }
      if (scheduledMilestones.has(milestoneId)) {
        throw new ExecutionStrategyValidationError(`Duplicate milestone scheduled in execution strategy: ${milestoneId}`);
      }
      scheduledMilestones.add(milestoneId);
      return milestoneId;
    });
    resolved.push({
      id: wave.id,
      milestones,
      dependsOn: normalizeDependsOn(wave.dependsOn, `Milestone wave ${wave.id}`),
      maxParallel: resolveCap({
        name: `milestoneWaves.${wave.id}.maxParallel`,
        value: wave.maxParallel,
        fallback: Math.min(milestones.length, globalMax),
        limit: Math.min(milestones.length, globalMax),
        warnings,
      }),
    });
  }
  assertDependencyGraph("Milestone wave", resolved.map((wave) => ({
    id: wave.id,
    dependsOn: wave.dependsOn,
  })));
  return resolved;
}

function resolveStoryStrategy(
  milestoneId: string,
  storyStrategy: MilestoneStoryStrategy,
  trackerIndex: TrackerIndex,
  globalMax: number,
  milestoneRunsInParallel: boolean,
  warnings: string[],
): ResolvedMilestoneStoryStrategy {
  assertRecord(storyStrategy, `story strategy for ${milestoneId}`);
  if (!Array.isArray(storyStrategy.storyWaves) || storyStrategy.storyWaves.length === 0) {
    throw new ExecutionStrategyValidationError(`Story strategy for ${milestoneId} must include storyWaves`);
  }
  const knownStories = new Set(trackerIndex.storiesByMilestone.get(milestoneId) ?? []);
  const maxParallelStories = resolveCap({
    name: `stories.${milestoneId}.maxParallelStories`,
    value: storyStrategy.maxParallelStories,
    fallback: 1,
    limit: globalMax,
    warnings,
  });
  const waveIds = new Set<string>();
  const scheduledStories = new Set<string>();
  const resolvedWaves: ResolvedStoryWave[] = [];

  for (let index = 0; index < storyStrategy.storyWaves.length; index += 1) {
    const wave = storyStrategy.storyWaves[index];
    assertStoryWaveObject(wave, `stories.${milestoneId}.storyWaves[${index}]`);
    assertWaveId(wave.id, `Story wave for ${milestoneId}`);
    if (waveIds.has(wave.id)) {
      throw new ExecutionStrategyValidationError(`Duplicate story wave id for ${milestoneId}: ${wave.id}`);
    }
    waveIds.add(wave.id);
    if (!Array.isArray(wave.stories) || wave.stories.length === 0) {
      throw new ExecutionStrategyValidationError(`Story wave ${wave.id} must include at least one story`);
    }
    const stories = wave.stories.map((storyId) => {
      const owner = trackerIndex.storyToMilestone.get(storyId);
      if (!owner) throw new ExecutionStrategyValidationError(`Unknown story id in execution strategy: ${storyId}`);
      if (owner !== milestoneId) {
        throw new ExecutionStrategyValidationError(`Story ${storyId} does not belong to ${milestoneId}; it belongs to ${owner}`);
      }
      if (scheduledStories.has(storyId)) {
        throw new ExecutionStrategyValidationError(`Duplicate story scheduled in ${milestoneId}: ${storyId}`);
      }
      scheduledStories.add(storyId);
      return storyId;
    });
    const maxParallel = resolveCap({
      name: `stories.${milestoneId}.storyWaves.${wave.id}.maxParallel`,
      value: wave.maxParallel,
      fallback: Math.min(stories.length, maxParallelStories),
      limit: Math.min(stories.length, maxParallelStories),
      warnings,
    });
    const requiresWriteSets = milestoneRunsInParallel || stories.length > 1 || maxParallel > 1;
    const writeSets = normalizeWriteSets({
      milestoneId,
      waveId: wave.id,
      stories,
      rawWriteSets: wave.writeSets,
      required: requiresWriteSets,
    });
    if (stories.length > 1 || maxParallel > 1) {
      rejectWriteSetConflicts(writeSets, `story wave ${milestoneId}/${wave.id}`);
    }
    resolvedWaves.push({
      id: wave.id,
      stories,
      dependsOn: normalizeDependsOn(wave.dependsOn, `Story wave ${milestoneId}/${wave.id}`),
      maxParallel,
      writeSets,
    });
  }
  assertDependencyGraph("Story wave", resolvedWaves.map((wave) => ({
    id: wave.id,
    dependsOn: wave.dependsOn,
  })));
  const missingStories = [...knownStories].filter((storyId) => !scheduledStories.has(storyId));
  if (missingStories.length > 0) {
    throw new ExecutionStrategyValidationError(
      `Execution strategy for ${milestoneId} does not schedule story/stories: ${missingStories.join(", ")}`,
    );
  }
  return {
    maxParallelStories,
    storyWaves: resolvedWaves,
  };
}

function rejectCrossMilestoneWriteConflicts(
  milestoneWaves: ResolvedMilestoneWave[],
  stories: Record<string, ResolvedMilestoneStoryStrategy>,
): void {
  for (const wave of milestoneWaves) {
    if (wave.milestones.length <= 1 && wave.maxParallel <= 1) continue;
    const writeSetsByStory: Record<string, string[]> = {};
    for (const milestoneId of wave.milestones) {
      for (const storyWave of stories[milestoneId].storyWaves) {
        for (const storyId of storyWave.stories) {
          writeSetsByStory[`${milestoneId}/${storyId}`] = storyWave.writeSets[storyId] ?? [];
        }
      }
    }
    rejectWriteSetConflicts(writeSetsByStory, `milestone wave ${wave.id}`);
  }
}

function rejectWriteSetConflicts(writeSets: Record<string, string[]>, scope: string): void {
  const ownersByPath = new Map<string, string>();
  for (const [owner, paths] of Object.entries(writeSets)) {
    for (const filePath of paths) {
      const priorOwner = ownersByPath.get(filePath);
      if (priorOwner && priorOwner !== owner) {
        throw new ExecutionStrategyValidationError(
          `Unsafe write set conflict in ${scope}: ${priorOwner} and ${owner} both include ${filePath}`,
        );
      }
      ownersByPath.set(filePath, owner);
    }
  }
}

function normalizeWriteSets(args: {
  milestoneId: string;
  waveId: string;
  stories: string[];
  rawWriteSets: Record<string, string[]> | undefined;
  required: boolean;
}): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const raw = args.rawWriteSets ?? {};
  if (args.rawWriteSets !== undefined) assertRecord(args.rawWriteSets, `writeSets for ${args.milestoneId}/${args.waveId}`);
  for (const storyId of args.stories) {
    if (!Object.prototype.hasOwnProperty.call(raw, storyId)) {
      if (args.required) {
        throw new ExecutionStrategyValidationError(
          `Missing writeSets for ${storyId} in ${args.milestoneId}/${args.waveId}`,
        );
      }
      out[storyId] = [];
      continue;
    }
    const paths = raw[storyId];
    if (!Array.isArray(paths)) {
      throw new ExecutionStrategyValidationError(`writeSets.${storyId} must be an array of repo-relative paths`);
    }
    out[storyId] = paths.map((filePath) => normalizeWritePath(filePath, storyId));
  }
  for (const storyId of Object.keys(raw)) {
    if (!args.stories.includes(storyId)) {
      throw new ExecutionStrategyValidationError(
        `writeSets for ${args.milestoneId}/${args.waveId} references unscheduled story ${storyId}`,
      );
    }
  }
  return out;
}

function normalizeWritePath(filePath: string, storyId: string): string {
  if (typeof filePath !== "string") {
    throw new ExecutionStrategyValidationError(`writeSets.${storyId} contains a non-string path`);
  }
  const trimmed = filePath.trim();
  if (trimmed.length === 0) {
    throw new ExecutionStrategyValidationError(`writeSets.${storyId} contains an empty path`);
  }
  if (path.isAbsolute(trimmed) || trimmed.split(/[\\/]+/).includes("..")) {
    throw new ExecutionStrategyValidationError(`writeSets.${storyId} must use repo-relative paths: ${trimmed}`);
  }
  // writeSet entries are treated as literal repo-relative file paths,
  // never as glob patterns. We reject `*` and `?` because those are the
  // characters callers most commonly reach for when (mistakenly) trying
  // to express a glob — rejecting them up front turns a silent
  // "file not found" later into an actionable validator error.
  // `[`, `]`, `{`, `}` are NOT rejected: even though they have meaning in
  // POSIX glob syntax (character classes, brace expansion), they are
  // also valid POSIX filename characters and appear in legitimate paths
  // for Next.js / SvelteKit / Remix / Astro / Nuxt dynamic-route
  // segments (e.g. `[caseId]`, `[...slug]`, `[[...slug]]`, `{group}`).
  // Since we never glob-expand writeSet entries, those characters are
  // safe to pass through as-is.
  if (/[*?]/.test(trimmed)) {
    throw new ExecutionStrategyValidationError(
      `writeSets.${storyId} contains shell-glob wildcards (\`*\` or \`?\`): ${trimmed}`,
    );
  }
  if (/^(all|unknown|tbd)$/i.test(trimmed)) {
    throw new ExecutionStrategyValidationError(
      `writeSets.${storyId} contains a placeholder literal (\`all\`, \`unknown\`, \`tbd\`): ${trimmed}`,
    );
  }
  return trimmed.replace(/\\/g, "/");
}

function assertDependencyGraph(kind: string, nodes: { id: string; dependsOn: string[] }[]): void {
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!indexById.has(dep)) {
        throw new ExecutionStrategyValidationError(`${kind} ${node.id} depends on unknown wave ${dep}`);
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string, stack: string[]) => {
    if (visiting.has(nodeId)) {
      throw new ExecutionStrategyValidationError(`Cycle detected in ${kind.toLowerCase()} dependencies: ${[...stack, nodeId].join(" -> ")}`);
    }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodes[indexById.get(nodeId)!];
    for (const dep of node.dependsOn) visit(dep, [...stack, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const node of nodes) visit(node.id, []);

  for (const node of nodes) {
    const nodeIndex = indexById.get(node.id)!;
    for (const dep of node.dependsOn) {
      const depIndex = indexById.get(dep)!;
      if (depIndex >= nodeIndex) {
        throw new ExecutionStrategyValidationError(
          `${kind} ${node.id} dependency ${dep} must reference an earlier wave`,
        );
      }
    }
  }
}

function resolveCap(args: {
  name: string;
  value: number | undefined;
  fallback: number;
  limit: number;
  warnings: string[];
}): number {
  if (args.limit < 1 || !Number.isFinite(args.limit)) {
    throw new ExecutionStrategyValidationError(`${args.name} validator limit must be a positive finite number`);
  }
  const value = args.value ?? args.fallback;
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    throw new ExecutionStrategyValidationError(`${args.name} must be a positive finite integer`);
  }
  if (value > args.limit) {
    args.warnings.push(`${args.name} clamped from ${value} to ${args.limit}`);
    return args.limit;
  }
  return value;
}

function normalizeDependsOn(dependsOn: string[] | undefined, label: string): string[] {
  if (dependsOn === undefined) return [];
  if (!Array.isArray(dependsOn)) {
    throw new ExecutionStrategyValidationError(`${label} dependsOn must be an array`);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dep of dependsOn) {
    assertWaveId(dep, `${label} dependency`);
    if (seen.has(dep)) throw new ExecutionStrategyValidationError(`${label} has duplicate dependency ${dep}`);
    seen.add(dep);
    out.push(dep);
  }
  return out;
}

function assertWaveId(id: unknown, label: string): asserts id is string {
  if (typeof id !== "string" || !/^[A-Za-z0-9._-]+$/.test(id.trim())) {
    throw new ExecutionStrategyValidationError(`${label} id must be a non-empty safe token`);
  }
}

function describeJsonValue(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function buildSequentialStoryStrategy(milestoneId: string, storyIds: string[]): MilestoneStoryStrategy {
  return {
    maxParallelStories: 1,
    storyWaves: storyIds.map((storyId, storyIndex) => {
      const waveId = `${milestoneId}-W${storyIndex + 1}`;
      const wave: StoryWave = {
        id: waveId,
        stories: [storyId],
        maxParallel: 1,
        writeSets: { [storyId]: [] },
      };
      if (storyIndex > 0) wave.dependsOn = [`${milestoneId}-W${storyIndex}`];
      return wave;
    }),
  };
}

interface TrackerIndex {
  milestoneIds: Set<string>;
  storiesByMilestone: Map<string, string[]>;
  storyToMilestone: Map<string, string>;
}

function buildTrackerIndex(tracker: ParsedTracker): TrackerIndex {
  const milestoneIds = new Set<string>();
  const storiesByMilestone = new Map<string, string[]>();
  const storyToMilestone = new Map<string, string>();
  for (const milestone of tracker.milestones) {
    if (milestoneIds.has(milestone.id)) {
      throw new ExecutionStrategyValidationError(`Tracker contains duplicate milestone ${milestone.id}`);
    }
    milestoneIds.add(milestone.id);
    const storyIds: string[] = [];
    for (const story of milestone.stories) {
      if (storyToMilestone.has(story.id)) {
        throw new ExecutionStrategyValidationError(`Tracker contains duplicate story ${story.id}`);
      }
      storyIds.push(story.id);
      storyToMilestone.set(story.id, milestone.id);
    }
    storiesByMilestone.set(milestone.id, storyIds);
  }
  if (milestoneIds.size === 0) {
    throw new ExecutionStrategyValidationError("Story tracker has no milestones to schedule");
  }
  return { milestoneIds, storiesByMilestone, storyToMilestone };
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ExecutionStrategyValidationError(`${label} must be an object`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
