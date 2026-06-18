import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWorktree, type CreateWorktreeOptions } from "../../src/worktree/create";
import { WorktreeError } from "../../src/worktree/validate";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// Mock fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
const mockExecFile = vi.mocked(execFile);
const mockExistsSync = vi.mocked(existsSync);

describe("createWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupMocks(opts: { branchExists?: boolean; pathExists?: boolean } = {}) {
    let revParseCallCount = 0;

    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      const args = _args as string[];

      if (args[0] === "--version") {
        cb(null, { stdout: "git version 2.39.0", stderr: "" });
      } else if (args[0] === "status") {
        cb(null, { stdout: "", stderr: "" });
      } else if (args[0] === "rev-parse" && args[1] === "--is-inside-work-tree") {
        cb(null, { stdout: "true", stderr: "" });
      } else if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        cb(null, { stdout: "/Users/test/repo\n", stderr: "" });
      } else if (args[0] === "rev-parse" && args[1] === "--verify") {
        revParseCallCount++;
        if (revParseCallCount === 1 && opts.branchExists) {
          // First call: branch exists check — branch exists
          cb(null, { stdout: "abc123", stderr: "" });
        } else if (revParseCallCount === 1) {
          // First call: branch exists check — branch doesn't exist
          cb(new Error("not found"), { stdout: "", stderr: "" });
        } else {
          // Second call: resolve base SHA
          cb(null, { stdout: "def456\n", stderr: "" });
        }
      } else if (args[0] === "worktree" && args[1] === "add") {
        cb(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
      return {} as any;
    });

    if (opts.pathExists) {
      mockExistsSync.mockReturnValue(true);
    }
  }

  it("creates worktree with valid slug", async () => {
    setupMocks();
    const result = await createWorktree({ slug: "my-feature" });
    expect(result.branchName).toBe("pair/my-feature");
    expect(result.worktreePath).toContain("pair-my-feature");
    expect(result.baseSha).toBe("def456");
  });

  it("rejects invalid slug with special characters", async () => {
    await expect(createWorktree({ slug: "my feature!" })).rejects.toThrow(WorktreeError);
  });

  it("rejects slug with spaces", async () => {
    await expect(createWorktree({ slug: "my feature" })).rejects.toThrow(WorktreeError);
  });

  it("accepts slug with dots and hyphens", async () => {
    setupMocks();
    const result = await createWorktree({ slug: "my.feature-1.0" });
    expect(result.branchName).toBe("pair/my.feature-1.0");
  });

  it("throws when branch already exists", async () => {
    setupMocks({ branchExists: true });
    await expect(createWorktree({ slug: "existing" })).rejects.toThrow(WorktreeError);
  });

  it("uses custom branch prefix", async () => {
    setupMocks();
    const result = await createWorktree({ slug: "test", branchPrefix: "feature/" });
    expect(result.branchName).toBe("feature/test");
  });
});
