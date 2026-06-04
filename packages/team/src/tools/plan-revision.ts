import type { TranscriptHandle } from "../orchestrator/transcript";
import { applyPlanPatch, PLAN_PATCH_NO_CHANGE_MESSAGE, type AppliedPatch, type PlanPatch, PlanPatchError } from "../plan/patch";
import type { PlanRevisionMetrics } from "../plan/revision-metrics";
import type { TeamMember } from "../runtime/types";
import type { PlanRevisionMode } from "../config/schema";
import type { SpawnAgentReturning } from "./shared";
import { DEV_PLAN_CAP_BYTES, EXECUTION_STRATEGY_JSON_EXAMPLE, truncateWithTranscriptHint } from "./shared";

export interface PlanRevisionResult {
  plan: string;
  metrics: PlanRevisionMetrics;
  applied: AppliedPatch[];
  patchText?: string;
}

export interface PlanRevisionOptions {
  mode: PlanRevisionMode;
  priorPlan: string;
  findings: { findings: { P0: string[]; P1: string[]; P2: string[]; P3: string[] } };
  planner: TeamMember;
  sp: SpawnAgentReturning;
  signal?: AbortSignal;
  transcript: TranscriptHandle;
  round: number;
  label: string;
  errorPrefix: string;
  composeFullPrompt(): string;
  extraContext?: string;
}

export async function revisePlanWithPatchOrFallback(opts: PlanRevisionOptions): Promise<PlanRevisionResult> {
  if (opts.mode === "full") {
    const full = await opts.sp.spawnText(
      opts.planner,
      { task: opts.composeFullPrompt(), signal: opts.signal },
      opts.errorPrefix,
    );
    return {
      plan: full,
      applied: [],
      metrics: fullMetrics(opts.priorPlan, full, false),
    };
  }

  const patchPrompt = composePlanPatchRevisePrompt({
    label: opts.label,
    priorPlan: opts.priorPlan,
    findings: opts.findings,
    extraContext: opts.extraContext,
  });
  const patchText = await opts.sp.spawnText(
    opts.planner,
    { task: patchPrompt, signal: opts.signal },
    opts.errorPrefix,
  );
  await opts.transcript.record({
    role: "planner",
    label: "revision-patch",
    round: opts.round,
    body: patchText,
    meta: { length: patchText.length },
  });

  try {
    const patch = parsePatchJson(patchText);
    const applied = applyPlanPatch(opts.priorPlan, patch);
    applied.metrics.plannerOutputBytes = Buffer.byteLength(patchText);
    await opts.transcript.record({
      role: "system",
      label: "patch-applied",
      round: opts.round,
      status: "OK",
      body: JSON.stringify({ applied: applied.applied, metrics: applied.metrics }, null, 2),
      meta: {
        operationCount: applied.applied.length,
        finalPlanBytes: applied.metrics.finalPlanBytes,
      },
    });
    return { plan: applied.plan, applied: applied.applied, metrics: applied.metrics, patchText };
  } catch (err) {
    if (isNoChangePatchError(err)) {
      await opts.transcript.record({
        role: "system",
        label: "patch-noop",
        round: opts.round,
        status: "FAILED",
        body: `Patch application produced no changes; refusing to advance the review loop.\n\n${formatPatchError(err)}`,
        meta: { patchBytes: Buffer.byteLength(patchText) },
      });
      throw err;
    }
    await opts.transcript.record({
      role: "system",
      label: "patch-fallback",
      round: opts.round,
      status: "OK",
      body: `Patch application failed; falling back to full plan rewrite.\n\n${formatPatchError(err)}`,
      meta: { patchBytes: Buffer.byteLength(patchText) },
    });
    const full = await opts.sp.spawnText(
      opts.planner,
      { task: opts.composeFullPrompt(), signal: opts.signal },
      opts.errorPrefix,
    );
    return {
      plan: full,
      applied: [],
      patchText,
      metrics: fullMetrics(opts.priorPlan, full, true, Buffer.byteLength(patchText)),
    };
  }
}

export function composePlanPatchRevisePrompt(args: {
  label: string;
  priorPlan: string;
  findings: { findings: { P0: string[]; P1: string[]; P2: string[]; P3: string[] } };
  extraContext?: string;
}): string {
  return [
    `Revise this ${args.label} by returning ONLY a raw JSON patch object. Do not return markdown.`,
    "",
    "Patch schema:",
    "{",
    '  "operations": [',
    '    { "op": "replace_section", "target": { "milestoneId": "M2", "storyId": "S-203" }, "body": "- **S-203 — New title.** New body.\\n" },',
    '    { "op": "replace_within_section", "target": { "topLevelHeading": "Architecture" }, "anchor": "exact old text", "body": "replacement text" },',
    '    { "op": "append_to_section", "target": { "milestoneId": "M1", "section": "Acceptance Criteria" }, "body": "- [ ] New criterion.\\n" }',
    "  ]",
    "}",
    "",
    "Valid op values: replace_section, replace_within_section, insert_after_section, append_to_section, delete_section.",
    "Targets must be hierarchical: use topLevelHeading OR milestoneId, plus optional section and/or storyId. Story targets may use { milestoneId, storyId } (the validator infers section=Stories); any non-Stories section combined with a storyId is rejected. Do not target by repeated heading text alone.",
    "For replace_within_section, anchor must be an exact substring that appears exactly once inside the resolved target section.",
    "",
    "When patching the `## Execution Strategy` section, use this JSON object shape. `milestoneWaves` must be objects with `id` and `milestones`; do not use array-of-arrays.",
    "```json",
    EXECUTION_STRATEGY_JSON_EXAMPLE,
    "```",
    "",
    "Return only operations needed to address P0/P1/P2/P3 findings.",
    args.extraContext ? `\nExtra context:\n${args.extraContext}` : "",
    "",
    "Reviewer findings:",
    JSON.stringify(args.findings.findings, null, 2),
    "",
    "Prior plan:",
    truncateWithTranscriptHint(args.priorPlan, DEV_PLAN_CAP_BYTES, `*planner-revise*`),
  ].join("\n");
}

function parsePatchJson(raw: string): PlanPatch {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as PlanPatch;
  } catch (_err) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) throw new PlanPatchError("planner output was not valid JSON");
    return JSON.parse(trimmed.slice(start, end + 1)) as PlanPatch;
  }
}

function fullMetrics(priorPlan: string, finalPlan: string, fallbackUsed: boolean, patchBytes = 0): PlanRevisionMetrics {
  const metrics: PlanRevisionMetrics = {
    mode: "full",
    patchAttempted: fallbackUsed,
    patchApplied: false,
    fallbackUsed,
    plannerOutputBytes: Buffer.byteLength(finalPlan),
    priorPlanBytes: Buffer.byteLength(priorPlan),
    finalPlanBytes: Buffer.byteLength(finalPlan),
  };
  if (patchBytes > 0) metrics.patchOutputBytes = patchBytes;
  return metrics;
}

function formatPatchError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function isNoChangePatchError(err: unknown): boolean {
  return err instanceof PlanPatchError && err.message === PLAN_PATCH_NO_CHANGE_MESSAGE;
}
