import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { assertPathInsideRoot } from "./path-safety";
import { sanitizeGuidanceText } from "./guidance-sanitize";
import type { SteeringGuidance } from "./types";

const PLAN_NOTES_HEADING = "## Steering Notes";

export interface AppendPlanNoteInput {
  planFolderPath: string;
  repoRoot: string;
  guidance: SteeringGuidance;
}

function formatBullet(row: SteeringGuidance): string {
  const date = row.appendedAt;
  const scopeTarget = row.scope.target ? `:${row.scope.target}` : "";
  const sanitized = sanitizeGuidanceText(row.text);
  return `- ${date}: ${sanitized} (scope: ${row.scope.kind}${scopeTarget}, source: ${row.source}:${row.instructionId})`;
}

async function ensureFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") return "";
    throw err;
  }
}

/**
 * Append a "## Steering Notes" entry to `<planFolder>/milestone-plan.md` and
 * to `<planFolder>/final-transcript.md`. Idempotent: a bullet whose
 * `(source: ...:<instructionId>)` already exists is skipped.
 *
 * Caller resolves the planFolderPath via the existing planFolderPath
 * helper; we additionally guard via `assertPathInsideRoot` so a hostile
 * planSlug cannot redirect writes outside the repo root.
 */
export async function appendSteeringPlanNote(
  input: AppendPlanNoteInput,
): Promise<{ wrote: { milestonePlan: boolean; finalTranscript: boolean } }> {
  const planFolder = assertPathInsideRoot(input.planFolderPath, input.repoRoot);
  await mkdir(planFolder, { recursive: true });

  const bullet = formatBullet(input.guidance);
  const provenanceMarker = `source: ${input.guidance.source}:${input.guidance.instructionId}`;

  const milestoneFile = path.join(planFolder, "milestone-plan.md");
  const finalTranscriptFile = path.join(planFolder, "final-transcript.md");

  const milestoneWrote = await appendBulletToFile(milestoneFile, bullet, provenanceMarker);
  const finalTranscriptWrote = await appendBulletToFile(finalTranscriptFile, bullet, provenanceMarker);

  return { wrote: { milestonePlan: milestoneWrote, finalTranscript: finalTranscriptWrote } };
}

async function appendBulletToFile(
  filePath: string,
  bullet: string,
  provenanceMarker: string,
): Promise<boolean> {
  const existing = await ensureFile(filePath);
  if (existing.includes(provenanceMarker)) return false;
  const trimmed = existing.replace(/\s+$/u, "");
  const headingPresent = trimmed.includes(PLAN_NOTES_HEADING);
  let next: string;
  if (headingPresent) {
    next = `${trimmed}\n${bullet}\n`;
  } else {
    next = `${trimmed}\n\n${PLAN_NOTES_HEADING}\n${bullet}\n`;
    if (existing.length === 0) {
      next = `${PLAN_NOTES_HEADING}\n${bullet}\n`;
    }
  }
  await writeFile(filePath, next, "utf8");
  return true;
}

export { PLAN_NOTES_HEADING };
