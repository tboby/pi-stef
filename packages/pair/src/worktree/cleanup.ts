import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { WorktreeError } from "./validate";

const execFileAsync = promisify(execFile);

export interface CleanupOptions {
  worktreePath: string;
  branchName: string;
  baseBranch?: string; // defaults to current branch
}

/**
 * Rollup worktree commits to base branch and delete the worktree.
 *
 * Steps:
 * 1. Get current branch (base)
 * 2. Merge worktree branch into base (--ff-only)
 * 3. Remove worktree
 * 4. Delete branch
 */
export async function rollupAndCleanup(opts: CleanupOptions): Promise<void> {
  const { worktreePath, branchName, baseBranch } = opts;

  // Get base branch if not specified
  let base = baseBranch;
  if (!base) {
    const { stdout } = await execFileAsync("git", [
      "branch",
      "--show-current",
    ]);
    base = stdout.trim();
  }

  if (!base) {
    throw new WorktreeError("Could not determine base branch");
  }

  // Switch to base branch
  await execFileAsync("git", ["checkout", base]);

  // Merge worktree branch (ff-only) — MUST succeed before cleanup
  try {
    await execFileAsync("git", ["merge", "--ff-only", branchName]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WorktreeError(
      `Failed to merge ${branchName} into ${base}: ${msg}. Worktree preserved at ${worktreePath} for manual resolution.`
    );
  }

  // Only remove worktree after successful merge
  try {
    await execFileAsync("git", ["worktree", "remove", worktreePath]);
  } catch {
    // Try force remove if normal remove fails
    await execFileAsync("git", [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);
  }

  // Delete branch after successful merge
  try {
    await execFileAsync("git", ["branch", "-d", branchName]);
  } catch {
    // Branch may already be deleted by merge
  }
}

/**
 * Remove a worktree without merging (for abort/cleanup scenarios).
 */
export async function removeWorktree(worktreePath: string): Promise<void> {
  try {
    await execFileAsync("git", ["worktree", "remove", "--force", worktreePath]);
  } catch {
    // Ignore errors during cleanup
  }
}
