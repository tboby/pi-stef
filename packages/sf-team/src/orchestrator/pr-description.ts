import { spawnSync } from "node:child_process";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { PLAN_FOLDER_ROOT, planFolderPathFromRoot } from "../plan/paths";
import { parseStoryTracker } from "../plan/tracker";

export interface PrDescriptionInput {
  repoRoot: string;
  slug: string;
  /** Optional override of the title; defaults to the slug. */
  title?: string;
  /** Range to summarize git log over (default: HEAD~..HEAD when applicable). */
  gitRange?: string;
  /** When 'off', skip generation entirely and return undefined. */
  gitMode?: "on" | "off";
  /** Resolved plan-folder root; defaults to repoRoot/ai_plan when absent. */
  planRoot?: string;
}

/**
 * Generate a `pr-description.md` inside the plan folder, formatted as:
 *
 *   # Title
 *   ## Summary
 *   ## Changes
 *   ## Testing
 *   ## Notes
 *
 * Pulls Summary/Changes from the parsed story-tracker (completed + in-dev
 * stories) and `git log <range>` for ground truth. Creates the file
 * atomically (.tmp + rename).
 */
export async function generatePrDescription(input: PrDescriptionInput): Promise<string | undefined> {
  if (input.gitMode === "off") return undefined;
  const resolvedPlanRoot = input.planRoot ?? path.join(input.repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const folder = planFolderPathFromRoot(resolvedPlanRoot, input.slug);
  const fileName = "pr-description.md";
  const filePath = path.join(folder, fileName);
  const title = input.title ?? input.slug;
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(await summaryFromTracker(resolvedPlanRoot, input.slug));
  lines.push("");
  lines.push("## Changes");
  lines.push(...(await changesFromGit(input.repoRoot, input.gitRange)));
  lines.push("");
  lines.push("## Testing");
  lines.push("- pnpm typecheck");
  lines.push("- pnpm test");
  lines.push("");
  lines.push("## Notes");
  lines.push(`- Plan folder: ${folder}/`);
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, lines.join("\n"), "utf8");
  await rename(tmp, filePath);
  return filePath;
}

async function summaryFromTracker(planRoot: string, slug: string): Promise<string> {
  try {
    const t = await parseStoryTracker(planRoot, slug, planRoot);
    const total = t.milestones.flatMap((m) => m.stories).length;
    const completed = t.milestones.flatMap((m) => m.stories).filter((s) => s.status === "completed").length;
    const milestoneCount = t.milestones.length;
    const approvedCount = t.milestones.filter((m) => m.approvalStatus?.startsWith("approved")).length;
    return `${completed}/${total} stories complete across ${approvedCount}/${milestoneCount} approved milestones.`;
  } catch {
    return "(no story-tracker.md found)";
  }
}

async function changesFromGit(repoRoot: string, range?: string): Promise<string[]> {
  // Default to "the latest commit only". Callers that know the merge-base
  // (the tool wrappers in M10/M11/M12) pass the actual range. Defaulting to
  // `HEAD~5..HEAD` would pull unrelated commits into the PR description on
  // larger repos, while defaulting to `HEAD~..HEAD` fails on a fresh repo
  // with only one commit.
  const args = range ? ["log", "--pretty=- %s", range] : ["log", "--pretty=- %s", "-1"];
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return ["- (no git history available)"];
  return r.stdout.split("\n").filter((s) => s.trim().length > 0);
}
