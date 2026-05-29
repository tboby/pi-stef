import { spawnSync } from "node:child_process";

export interface MergeBranchInput {
  targetCwd: string;
  sourceBranch: string;
  message?: string;
}

export interface MergeBranchResult {
  status: "merged" | "conflict" | "failed";
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export function mergeBranchIntoWorktree(input: MergeBranchInput): MergeBranchResult {
  const args = ["merge", "--no-ff", input.sourceBranch];
  if (input.message) args.push("-m", input.message);
  const r = spawnSync("git", args, { cwd: input.targetCwd, encoding: "utf8" });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  if (r.status === 0) {
    return { status: "merged", exitCode: r.status, stdout, stderr };
  }
  if (hasUnmergedPaths(input.targetCwd)) {
    const abort = spawnSync("git", ["merge", "--abort"], { cwd: input.targetCwd, encoding: "utf8" });
    return {
      status: "conflict",
      exitCode: r.status ?? null,
      stdout: [stdout, abort.stdout ? `merge --abort stdout:\n${abort.stdout}` : ""].filter(Boolean).join("\n"),
      stderr: [stderr, abort.stderr ? `merge --abort stderr:\n${abort.stderr}` : ""].filter(Boolean).join("\n"),
    };
  }
  return { status: "failed", exitCode: r.status ?? null, stdout, stderr };
}

function hasUnmergedPaths(cwd: string): boolean {
  const r = spawnSync("git", ["diff", "--name-only", "--diff-filter=U"], { cwd, encoding: "utf8" });
  return r.status === 0 && (r.stdout ?? "").trim().length > 0;
}
