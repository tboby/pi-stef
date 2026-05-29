import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

import { PLAN_FOLDER_ROOT, planFolderPathFromRoot } from "./paths";

export type StoryStatus = "pending" | "in-dev" | "needs-rework" | "completed" | "deferred";

export interface ParsedStory {
  id: string;
  description: string;
  status: StoryStatus;
  notes: string;
}

export interface ParsedMilestone {
  id: string;
  title: string;
  stories: ParsedStory[];
  approvalStatus: string | undefined;
}

export interface ParsedTracker {
  raw: string;
  milestones: ParsedMilestone[];
}

const STORY_TRACKER_FILE = "story-tracker.md";

export async function parseStoryTracker(repoRoot: string, slug: string, planRoot?: string): Promise<ParsedTracker> {
  const resolvedPlanRoot = planRoot ?? path.join(repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const trackerPath = path.join(planFolderPathFromRoot(resolvedPlanRoot, slug), STORY_TRACKER_FILE);
  const raw = await readFile(trackerPath, "utf8");
  return parseTrackerText(raw);
}

export function parseTrackerText(raw: string): ParsedTracker {
  const milestones: ParsedMilestone[] = [];
  const lines = raw.split("\n");

  let currentMilestone: ParsedMilestone | undefined;
  let inTable = false;
  for (const line of lines) {
    const milestoneHeader = line.match(/^###\s+(M\d+):\s*(.+)$/);
    if (milestoneHeader) {
      if (currentMilestone) milestones.push(currentMilestone);
      currentMilestone = {
        id: milestoneHeader[1],
        title: milestoneHeader[2].trim(),
        stories: [],
        approvalStatus: undefined,
      };
      inTable = false;
      continue;
    }
    if (!currentMilestone) continue;

    const approvalMatch = line.match(/^\*\*Approval Status:\*\*\s*(.+)$/);
    if (approvalMatch) {
      currentMilestone.approvalStatus = approvalMatch[1].trim();
      continue;
    }

    if (line.trim().startsWith("|") && /\|\s*Story\s*\|/i.test(line)) {
      inTable = true;
      continue;
    }
    if (inTable) {
      // Skip the divider row
      if (/^\s*\|\s*-/.test(line)) continue;
      if (line.trim().length === 0 || !line.trim().startsWith("|")) {
        inTable = false;
        continue;
      }
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.length >= 3) {
        const [id, description, status, ...rest] = cells;
        if (/^S-/.test(id)) {
          currentMilestone.stories.push({
            id,
            description,
            status: parseStatus(status),
            notes: rest.join(" | ").trim(),
          });
        }
      }
    }
  }
  if (currentMilestone) milestones.push(currentMilestone);
  return { raw, milestones };
}

function parseStatus(s: string): StoryStatus {
  const norm = s.trim().toLowerCase();
  if (norm === "in-dev" || norm === "in_dev" || norm === "in progress") return "in-dev";
  if (norm === "needs-rework" || norm === "needs rework" || norm === "rework") return "needs-rework";
  if (norm === "completed" || norm === "done") return "completed";
  if (norm === "deferred" || norm === "skipped") return "deferred";
  return "pending";
}

export interface UpdateStoryInput {
  slug: string;
  storyId: string;
  status?: StoryStatus;
  notes?: string;
}

/**
 * Mutate a single row in story-tracker.md atomically (write to .tmp, rename in
 * place). Only the row whose first cell starts with `<storyId> ` (or is exactly
 * `storyId`) is rewritten; everything else is preserved verbatim.
 */
export async function updateStoryTracker(repoRoot: string, input: UpdateStoryInput, planRoot?: string): Promise<void> {
  const resolvedPlanRoot = planRoot ?? path.join(repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const trackerPath = path.join(planFolderPathFromRoot(resolvedPlanRoot, input.slug), STORY_TRACKER_FILE);
  const raw = await readFile(trackerPath, "utf8");
  const updated = updateTrackerText(raw, input);
  if (updated === raw) return;
  const tmp = `${trackerPath}.tmp`;
  await writeFile(tmp, updated, "utf8");
  await rename(tmp, trackerPath);
}

export interface UpdateMilestoneApprovalInput {
  slug: string;
  milestoneId: string;
  approvalStatus: string;
}

/** Update only the `**Approval Status:** ...` line for a given milestone. */
export async function updateMilestoneApproval(
  repoRoot: string,
  input: UpdateMilestoneApprovalInput,
  planRoot?: string,
): Promise<void> {
  const resolvedPlanRoot = planRoot ?? path.join(repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const trackerPath = path.join(planFolderPathFromRoot(resolvedPlanRoot, input.slug), STORY_TRACKER_FILE);
  const raw = await readFile(trackerPath, "utf8");
  const updated = updateApprovalText(raw, input);
  if (updated === raw) return;
  const tmp = `${trackerPath}.tmp`;
  await writeFile(tmp, updated, "utf8");
  await rename(tmp, trackerPath);
}

export function updateApprovalText(raw: string, input: UpdateMilestoneApprovalInput): string {
  const lines = raw.split("\n");
  let inMilestone = false;
  for (let i = 0; i < lines.length; i += 1) {
    const headerMatch = lines[i].match(/^###\s+(M\d+):/);
    if (headerMatch) {
      inMilestone = headerMatch[1] === input.milestoneId;
      continue;
    }
    if (!inMilestone) continue;
    if (/^\*\*Approval Status:\*\*/.test(lines[i])) {
      lines[i] = `**Approval Status:** ${input.approvalStatus}`;
      inMilestone = false;
    }
  }
  return lines.join("\n");
}

export function updateTrackerText(raw: string, input: UpdateStoryInput): string {
  const lines = raw.split("\n");
  let inTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith("|") && /\|\s*Story\s*\|/i.test(line)) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (line.trim().length === 0 || !line.trim().startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\s*\|\s*-/.test(line)) continue;
    const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
    if (cells.length < 3) continue;
    const [id, description] = cells;
    if (id !== input.storyId) continue;
    const status = input.status ?? (cells[2] as StoryStatus);
    const notes = input.notes ?? cells.slice(3).join(" | ");
    lines[i] = `| ${id} | ${description} | ${status} | ${notes} |`;
  }
  return lines.join("\n");
}
