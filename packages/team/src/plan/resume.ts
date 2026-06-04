import path from "node:path";
import { loadBaseline, type Baseline } from "./baseline";
import { parseStoryTracker, type ParsedMilestone, type ParsedStory } from "./tracker";
import { readPlanFolder, type PlanFolderRead } from "./read";
import { PLAN_FOLDER_ROOT } from "./paths";

export interface ResumeState {
  /** Plan folder is missing entirely. Tools should treat this as "no resume". */
  exists: boolean;
  slug: string;
  folder: string;
  /** Stories currently marked `in-dev`, in tracker order. Drives the resume prompt. */
  inDev: ParsedStory[];
  /** First milestone that still has pending stories. Undefined if all complete. */
  firstPendingMilestone?: ParsedMilestone;
  baseline?: Baseline;
  raw: PlanFolderRead;
}

/**
 * Read the plan folder + baseline + tracker and return a snapshot the
 * orchestrator uses to decide whether to prompt "Resume from S-XXX?" via
 * pi.ui.confirm. Pure read-only; never mutates the folder.
 */
export async function detectResumeState(repoRoot: string, slug: string): Promise<ResumeState> {
  const raw = await readPlanFolder(repoRoot, slug);
  if (!raw.fiveFile && !raw.taskPlan) {
    return { exists: false, slug, folder: raw.folder, inDev: [], raw };
  }
  let inDev: ParsedStory[] = [];
  let firstPendingMilestone: ParsedMilestone | undefined;
  try {
    const parsed = await parseStoryTracker(repoRoot, slug);
    for (const m of parsed.milestones) {
      for (const s of m.stories) {
        if (s.status === "in-dev") inDev.push(s);
      }
    }
    firstPendingMilestone = parsed.milestones.find((m) =>
      m.stories.some((s) => s.status === "pending" || s.status === "in-dev" || s.status === "needs-rework"),
    );
  } catch (_err) {
    // tracker missing or unparseable; resume detection still useful via baseline.
  }
  const planRoot = path.join(repoRoot, PLAN_FOLDER_ROOT); // migration-allowed: legacy
  const baseline = await loadBaseline(planRoot, slug);
  return { exists: true, slug, folder: raw.folder, inDev, firstPendingMilestone, baseline, raw };
}
