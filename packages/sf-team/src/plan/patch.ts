import type { PlanRevisionMetrics } from "./revision-metrics";

export interface PlanPatchTarget {
  topLevelHeading?: string;
  milestoneId?: string;
  section?: "Description" | "Acceptance Criteria" | "Stories" | "Milestone Completion Rule";
  storyId?: string;
}

export type PlanPatchOperation =
  | { op: "replace_section"; target: PlanPatchTarget; body: string }
  | { op: "replace_within_section"; target: PlanPatchTarget; anchor: string; body: string }
  | { op: "insert_after_section"; target: PlanPatchTarget; body: string }
  | { op: "append_to_section"; target: PlanPatchTarget; body: string }
  | { op: "delete_section"; target: PlanPatchTarget };

export interface PlanPatch {
  operations: PlanPatchOperation[];
}

export interface AppliedPatch {
  op: PlanPatchOperation["op"];
  target: PlanPatchTarget;
  start: number;
  end: number;
  bytesBefore: number;
  bytesAfter: number;
}

export class PlanPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanPatchError";
  }
}

interface Heading {
  level: number;
  text: string;
  start: number;
  lineEnd: number;
}

interface ResolvedRange {
  fullStart: number;
  fullEnd: number;
  contentStart: number;
  contentEnd: number;
}

const SECTION_NAMES = ["Description", "Acceptance Criteria", "Stories", "Milestone Completion Rule"] as const;
export const PLAN_PATCH_NO_CHANGE_MESSAGE = "patch produced no changes";

export function applyPlanPatch(priorPlan: string, patch: PlanPatch): {
  plan: string;
  applied: AppliedPatch[];
  metrics: PlanRevisionMetrics;
} {
  const startedAt = Date.now();
  validatePatch(patch);
  const eol = priorPlan.includes("\r\n") ? "\r\n" : "\n";
  let plan = priorPlan;
  const applied: AppliedPatch[] = [];

  for (const rawOp of patch.operations) {
    const op = normalizeOperation(rawOp, eol);
    const range = resolveTarget(plan, op.target);
    const before = plan;
    let next: string;
    let start: number;
    let end: number;

    switch (op.op) {
      case "replace_section": {
        start = isStoryTarget(op.target) ? range.fullStart : range.contentStart;
        end = isStoryTarget(op.target) ? range.fullEnd : range.contentEnd;
        next = replaceRange(plan, start, end, op.body);
        break;
      }
      case "replace_within_section": {
        const content = plan.slice(range.contentStart, range.contentEnd);
        const matches = countMatches(content, op.anchor);
        if (matches !== 1) {
          throw new PlanPatchError(`anchor must match exactly once in target; got ${matches}`);
        }
        const local = content.indexOf(op.anchor);
        start = range.contentStart + local;
        end = start + op.anchor.length;
        next = replaceRange(plan, start, end, op.body);
        break;
      }
      case "insert_after_section": {
        start = range.fullEnd;
        end = range.fullEnd;
        next = replaceRange(plan, start, end, op.body);
        break;
      }
      case "append_to_section": {
        start = range.contentEnd;
        end = range.contentEnd;
        next = replaceRange(plan, start, end, op.body);
        break;
      }
      case "delete_section": {
        start = range.fullStart;
        end = range.fullEnd;
        next = replaceRange(plan, start, end, "");
        break;
      }
    }

    applied.push({
      op: op.op,
      target: op.target,
      start,
      end,
      bytesBefore: Buffer.byteLength(before),
      bytesAfter: Buffer.byteLength(next),
    });
    plan = next;
  }

  if (plan === priorPlan) {
    throw new PlanPatchError(PLAN_PATCH_NO_CHANGE_MESSAGE);
  }

  return {
    plan,
    applied,
    metrics: {
      mode: "patch",
      patchAttempted: true,
      patchApplied: true,
      fallbackUsed: false,
      plannerOutputBytes: 0,
      priorPlanBytes: Buffer.byteLength(priorPlan),
      finalPlanBytes: Buffer.byteLength(plan),
      applyDurationMs: Math.max(0, Date.now() - startedAt),
      operationCount: applied.length,
    },
  };
}

function validatePatch(patch: PlanPatch): void {
  if (!patch || !Array.isArray(patch.operations)) throw new PlanPatchError("patch.operations must be an array");
  if (patch.operations.length === 0) throw new PlanPatchError("patch.operations must contain at least one operation");
  for (const op of patch.operations) {
    if (!isRecord(op)) throw new PlanPatchError("patch operation must be an object");
    if (!["replace_section", "replace_within_section", "insert_after_section", "append_to_section", "delete_section"].includes(String(op.op))) {
      throw new PlanPatchError(`unknown patch operation: ${String(op.op)}`);
    }
    if (!isRecord(op.target)) throw new PlanPatchError("patch operation target must be an object");
    if (op.op !== "delete_section" && (typeof op.body !== "string" || op.body.length === 0)) {
      throw new PlanPatchError(`${String(op.op)} requires a non-empty body`);
    }
    if (op.op === "replace_within_section" && (typeof op.anchor !== "string" || op.anchor.length === 0)) {
      throw new PlanPatchError("replace_within_section requires a non-empty anchor");
    }
  }
}

function normalizeOperation(op: PlanPatchOperation, eol: string): PlanPatchOperation {
  if ("body" in op) return { ...op, body: normalizeEol(op.body, eol) } as PlanPatchOperation;
  return op;
}

function normalizeEol(body: string, eol: string): string {
  return body.replace(/\r\n|\r|\n/g, eol);
}

function resolveTarget(plan: string, target: PlanPatchTarget): ResolvedRange {
  if (!target || Object.keys(target).length === 0) throw new PlanPatchError("target is required");
  if (target.storyId) {
    if (!target.milestoneId) throw new PlanPatchError("storyId targets require milestoneId");
    if (target.section !== undefined && target.section !== "Stories") {
      throw new PlanPatchError("storyId targets must use section=Stories");
    }
  }
  if (target.topLevelHeading) return resolveTopLevel(plan, target.topLevelHeading);
  if (target.milestoneId) return resolveMilestoneTarget(plan, target);
  throw new PlanPatchError("target must include topLevelHeading or milestoneId");
}

function resolveTopLevel(plan: string, heading: string): ResolvedRange {
  const headings = collectHeadings(plan);
  const found = headings.filter((h) => h.level === 2 && equalName(h.text, heading));
  if (found.length !== 1) throw new PlanPatchError(`top-level heading not found or ambiguous: ${heading}`);
  const h = found[0];
  const next = headings.find((candidate) => candidate.start > h.start && candidate.level <= h.level);
  const fullEnd = next?.start ?? plan.length;
  return { fullStart: h.start, fullEnd, contentStart: h.lineEnd, contentEnd: fullEnd };
}

function resolveMilestoneTarget(plan: string, target: PlanPatchTarget): ResolvedRange {
  const milestone = findMilestone(plan, target.milestoneId!);
  // When storyId is set without an explicit section, infer "Stories" — stories
  // live only inside the Stories sub-section of a milestone, so this is
  // unambiguous. resolveTarget already rejects storyId combined with a
  // non-Stories section, so by this point either section is "Stories" or
  // section is undefined and we infer it.
  const effectiveSection = target.section ?? (target.storyId ? "Stories" : undefined);
  if (!effectiveSection) return milestone;
  const section = findMilestoneSection(plan, milestone, effectiveSection);
  if (!target.storyId) return section;
  return findStory(plan, section, target.storyId);
}

function findMilestone(plan: string, milestoneId: string): ResolvedRange {
  const headings = collectHeadings(plan);
  const found = headings.filter((h) => h.level === 3 && milestoneIdFromHeading(h.text) === milestoneId);
  if (found.length !== 1) throw new PlanPatchError(`milestone not found or ambiguous: ${milestoneId}`);
  const h = found[0];
  const next = headings.find((candidate) => {
    if (candidate.start <= h.start) return false;
    if (candidate.level <= 2) return true;
    return candidate.level === 3 && milestoneIdFromHeading(candidate.text) !== undefined;
  });
  const fullEnd = next?.start ?? plan.length;
  return { fullStart: h.start, fullEnd, contentStart: h.lineEnd, contentEnd: fullEnd };
}

function findMilestoneSection(plan: string, milestone: ResolvedRange, section: PlanPatchTarget["section"]): ResolvedRange {
  const markers = collectSectionMarkers(plan, milestone);
  const found = markers.filter((m) => m.name === section);
  if (found.length !== 1) throw new PlanPatchError(`milestone section not found or ambiguous: ${section}`);
  const marker = found[0];
  const next = markers.find((candidate) => candidate.start > marker.start);
  const fullEnd = next?.start ?? milestone.fullEnd;
  return { fullStart: marker.start, fullEnd, contentStart: marker.lineEnd, contentEnd: fullEnd };
}

function findStory(plan: string, section: ResolvedRange, storyId: string): ResolvedRange {
  const stories = collectStories(plan, section);
  const found = stories.filter((story) => story.id === storyId);
  if (found.length !== 1) throw new PlanPatchError(`story not found or ambiguous: ${storyId}`);
  return found[0].range;
}

function collectHeadings(plan: string): Heading[] {
  const headings: Heading[] = [];
  const re = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  for (const m of plan.matchAll(re)) {
    const start = m.index ?? 0;
    headings.push({ level: m[1].length, text: m[2].trim(), start, lineEnd: lineEnd(plan, start) });
  }
  return headings;
}

function collectSectionMarkers(plan: string, range: ResolvedRange): Array<{ name: PlanPatchTarget["section"]; start: number; lineEnd: number }> {
  const markers: Array<{ name: PlanPatchTarget["section"]; start: number; lineEnd: number }> = [];
  const slice = plan.slice(range.contentStart, range.contentEnd);
  const re = /^(?:(#{4,6})\s+(.+?)\s*#*\s*|\*\*(Description|Acceptance Criteria|Stories|Milestone Completion Rule):?\*\*.*)$/gm;
  for (const m of slice.matchAll(re)) {
    const nameText = (m[2] ?? m[3] ?? "").replace(/:$/, "").trim();
    const name = SECTION_NAMES.find((candidate) => equalName(candidate, nameText));
    if (!name) continue;
    const start = range.contentStart + (m.index ?? 0);
    markers.push({ name, start, lineEnd: lineEnd(plan, start) });
  }
  return markers;
}

function collectStories(plan: string, section: ResolvedRange): Array<{ id: string; range: ResolvedRange }> {
  const stories: Array<{ id: string; range: ResolvedRange }> = [];
  const slice = plan.slice(section.contentStart, section.contentEnd);
  const re = /^-\s+\*\*(S-[A-Za-z0-9_-]+)\b.*$/gm;
  const starts: Array<{ id: string; start: number; lineEnd: number }> = [];
  for (const m of slice.matchAll(re)) {
    const start = section.contentStart + (m.index ?? 0);
    starts.push({ id: m[1], start, lineEnd: lineEnd(plan, start) });
  }
  for (let i = 0; i < starts.length; i += 1) {
    const item = starts[i];
    const fullEnd = starts[i + 1]?.start ?? section.contentEnd;
    stories.push({ id: item.id, range: { fullStart: item.start, fullEnd, contentStart: item.start, contentEnd: fullEnd } });
  }
  return stories;
}

function lineEnd(plan: string, start: number): number {
  const idx = plan.indexOf("\n", start);
  return idx === -1 ? plan.length : idx + 1;
}

function replaceRange(plan: string, start: number, end: number, body: string): string {
  return `${plan.slice(0, start)}${body}${plan.slice(end)}`;
}

function countMatches(text: string, needle: string): number {
  if (needle.length === 0 || text.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = text.indexOf(needle, idx);
    if (found === -1) return count;
    count += 1;
    idx = found + needle.length;
  }
}

function milestoneIdFromHeading(text: string): string | undefined {
  const m = /^(M\d+)\b/i.exec(text.trim());
  return m?.[1].toUpperCase();
}

function equalName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function isStoryTarget(target: PlanPatchTarget): boolean {
  return typeof target.storyId === "string" && target.storyId.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
