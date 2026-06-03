import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { planFolderPathFromRoot } from "./paths";

const BASELINE_FILE = "baseline.json";

export interface Baseline {
  /** Captured HEAD SHA at entry. Empty string if not in a git repo. */
  headSha: string;
  /** `git status --porcelain=1` output verbatim at capture time. */
  porcelainStatus: string;
  /** ISO timestamp when captured. */
  capturedAt: string;
}

/**
 * Pure I/O primitive: writes baseline.json into the plan folder. The decision
 * of WHEN to call this (whenever `use_worktree=false`) lives in M9 S-911 inside
 * `runOrchestrator`; this module is policy-free.
 *
 * @param planRoot - Resolved parent directory for plan folders (e.g. `<repoRoot>/ai_plan`).
 */
export async function captureBaseline(
  planRoot: string,
  slug: string,
  opts: {
    cwdOverride?: string;
    gitMode?: "on" | "off";
    /** Repo root for git probing when planRoot is external to the repository. */
    repoRoot?: string;
  } = {},
): Promise<Baseline | undefined> {
  if (opts.gitMode === "off") return undefined;
  // Use explicit cwd override, then repoRoot (for external planRoot), then planRoot.
  const cwd = opts.cwdOverride ?? opts.repoRoot ?? planRoot;
  const headSha = readGitOutput(["rev-parse", "HEAD"], cwd);
  const porcelainStatus = readGitOutput(["status", "--porcelain=1"], cwd);
  const baseline: Baseline = {
    headSha,
    porcelainStatus,
    capturedAt: new Date().toISOString(),
  };
  const baselinePath = path.join(planFolderPathFromRoot(planRoot, slug), BASELINE_FILE);
  const tmp = `${baselinePath}.tmp`;
  await writeFile(tmp, JSON.stringify(baseline, null, 2), "utf8");
  await rename(tmp, baselinePath);
  return baseline;
}

export async function loadBaseline(planRoot: string, slug: string): Promise<Baseline | undefined> {
  const baselinePath = path.join(planFolderPathFromRoot(planRoot, slug), BASELINE_FILE);
  try {
    const raw = await readFile(baselinePath, "utf8");
    return JSON.parse(raw) as Baseline;
  } catch (err) {
    console.debug("[team]", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

function readGitOutput(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) return "";
  return r.stdout.trimEnd();
}
