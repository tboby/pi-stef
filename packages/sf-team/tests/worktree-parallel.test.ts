import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const installSpy = vi.hoisted(() =>
  vi.fn((_worktreePath: string) => ({
    kind: "skipped" as const,
    reason: "no_package_json" as const,
  })),
);

vi.mock("../src/worktree/install-deps", () => ({
  installDependenciesIfMissing: installSpy,
}));

import { createWorktree, ensureLaneWorktree, validateWorktreeBranchName, WorktreeCreationError } from "../src/worktree/create";
import { mergeBranchIntoWorktree } from "../src/worktree/merge";

function makeRepo(): { root: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "ct-wt-par-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", "-b", "main"], repo);
  run("git", ["config", "user.email", "a@b"], repo);
  run("git", ["config", "user.name", "tester"], repo);
  writeFileSync(path.join(repo, "README.md"), "hi\n");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-q", "-m", "init"], repo);
  return { root: repo, dispose: () => rmSync(root, { recursive: true, force: true }) };
}

function run(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

describe("parallel lane worktrees", () => {
  it("allows an explicit safe branch name while keeping the slug-derived default", async () => {
    const { root, dispose } = makeRepo();
    try {
      const explicit = await createWorktree({
        repoRoot: root,
        slug: "lane-m1-s101",
        branchPrefix: "implement/",
        branchName: "implement/demo/milestones/M1/stories/S-101",
      });
      expect(explicit.branch).toBe("implement/demo/milestones/M1/stories/S-101");

      const fallback = await createWorktree({
        repoRoot: root,
        slug: "lane-m1-s102",
        branchPrefix: "implement/",
      });
      expect(fallback.branch).toBe("implement/lane-m1-s102");
    } finally {
      dispose();
    }
  });

  it("rejects unsafe branch names before invoking git", () => {
    const invalid = [
      "",
      " implement/x",
      "implement//x",
      "implement/x ",
      "implement/../x",
      "implement/x;rm",
      "implement/x y",
      "implement/x?y",
    ];
    for (const name of invalid) {
      expect(() => validateWorktreeBranchName(name)).toThrow(WorktreeCreationError);
    }
    expect(() => validateWorktreeBranchName("implement/demo/M1/S-101")).not.toThrow();
  });

  it("reuses a clean attached lane worktree and refuses a dirty one", async () => {
    const { root, dispose } = makeRepo();
    try {
      const first = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-reuse",
        branchName: "implement/demo/M1/S-101",
      });
      expect(first.reused).toBe(false);

      const reused = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-reuse",
        branchName: "implement/demo/M1/S-101",
      });
      expect(reused.reused).toBe(true);
      expect(realpathSync(reused.worktreePath)).toBe(realpathSync(first.worktreePath));

      writeFileSync(path.join(first.worktreePath, "dirty.txt"), "dirty\n");
      await expect(
        ensureLaneWorktree({
          repoRoot: root,
          slug: "lane-reuse",
          branchName: "implement/demo/M1/S-101",
        }),
      ).rejects.toMatchObject({ stage: "branch-collision" });
    } finally {
      dispose();
    }
  });

  it("attaches an existing branch that has no worktree", async () => {
    const { root, dispose } = makeRepo();
    try {
      run("git", ["branch", "implement/demo/M1"], root);
      const created = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-existing-branch",
        branchName: "implement/demo/M1",
      });
      expect(created.reused).toBe(false);
      expect(run("git", ["branch", "--show-current"], created.worktreePath)).toBe("implement/demo/M1");
    } finally {
      dispose();
    }
  });

  it("calls installDependenciesIfMissing(worktreePath) on the new-lane (non-reused) path", async () => {
    const { root, dispose } = makeRepo();
    installSpy.mockClear();
    try {
      const created = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-install-new",
        branchName: "implement/demo/M2/S-201",
      });
      expect(created.reused).toBe(false);
      expect(installSpy).toHaveBeenCalledTimes(1);
      expect(installSpy).toHaveBeenCalledWith(created.worktreePath);
    } finally {
      dispose();
    }
  });

  it("calls installDependenciesIfMissing(worktreePath) on the reused-lane path", async () => {
    const { root, dispose } = makeRepo();
    try {
      const first = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-install-reused",
        branchName: "implement/demo/M2/S-202",
      });
      // Clear the spy AFTER the first call so we only see the reused-lane invocation.
      installSpy.mockClear();
      const reused = await ensureLaneWorktree({
        repoRoot: root,
        slug: "lane-install-reused",
        branchName: "implement/demo/M2/S-202",
      });
      expect(reused.reused).toBe(true);
      expect(installSpy).toHaveBeenCalledTimes(1);
      // attached.path comes back from `git worktree list --porcelain` which
      // returns the realpath-resolved location; on macOS that prefixes /private
      // to /var/folders/... while mkdtempSync returns the bare /var path.
      const calledWith = installSpy.mock.calls[0]?.[0] as string | undefined;
      expect(calledWith).toBeDefined();
      expect(realpathSync(calledWith!)).toBe(realpathSync(first.worktreePath));
    } finally {
      dispose();
    }
  });
});

describe("parallel lane merges", () => {
  it("reports conflicts without overwriting the target lane", async () => {
    const { root, dispose } = makeRepo();
    try {
      const target = await ensureLaneWorktree({
        repoRoot: root,
        slug: "target",
        branchName: "implement/target",
      });
      const source = await ensureLaneWorktree({
        repoRoot: root,
        slug: "source",
        branchName: "implement/source",
      });

      writeFileSync(path.join(target.worktreePath, "shared.txt"), "target\n");
      run("git", ["add", "shared.txt"], target.worktreePath);
      run("git", ["commit", "-q", "-m", "target change"], target.worktreePath);

      writeFileSync(path.join(source.worktreePath, "shared.txt"), "source\n");
      run("git", ["add", "shared.txt"], source.worktreePath);
      run("git", ["commit", "-q", "-m", "source change"], source.worktreePath);

      const result = mergeBranchIntoWorktree({
        targetCwd: target.worktreePath,
        sourceBranch: source.branch,
        message: "merge source",
      });
      expect(result.status).toBe("conflict");
      expect(result.exitCode).not.toBe(0);
      expect(spawnSync("git", ["status", "--porcelain"], { cwd: target.worktreePath, encoding: "utf8" }).stdout).toBe("");
      expect(spawnSync("git", ["show", "HEAD:shared.txt"], { cwd: target.worktreePath, encoding: "utf8" }).stdout).toBe("target\n");
    } finally {
      dispose();
    }
  });
});
