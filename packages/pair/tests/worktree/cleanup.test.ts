import { describe, it, expect, vi, beforeEach } from "vitest";
import { rollupAndCleanup, removeWorktree } from "../../src/worktree/cleanup";
import { WorktreeError } from "../../src/worktree/validate";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

describe("rollupAndCleanup", () => {
  let callCount = 0;

  beforeEach(() => {
    callCount = 0;
    vi.clearAllMocks();
  });

  it("merges and removes worktree on success", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      callCount++;
      const args = _args as string[];

      if (args[0] === "branch" && args[1] === "--show-current") {
        cb(null, { stdout: "main\n", stderr: "" });
      } else if (args[0] === "checkout") {
        cb(null, { stdout: "", stderr: "" });
      } else if (args[0] === "merge") {
        cb(null, { stdout: "", stderr: "" });
      } else if (args[0] === "worktree" && args[1] === "remove") {
        cb(null, { stdout: "", stderr: "" });
      } else if (args[0] === "branch" && args[1] === "-d") {
        cb(null, { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
      return {} as any;
    });

    await expect(rollupAndCleanup({
      worktreePath: "/path/to/worktree",
      branchName: "pair/test",
    })).resolves.toBeUndefined();
  });

  it("throws WorktreeError when merge fails", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      const args = _args as string[];

      if (args[0] === "branch" && args[1] === "--show-current") {
        cb(null, { stdout: "main\n", stderr: "" });
      } else if (args[0] === "checkout") {
        cb(null, { stdout: "", stderr: "" });
      } else if (args[0] === "merge") {
        cb(new Error("merge conflict"), { stdout: "", stderr: "" });
      } else {
        cb(null, { stdout: "", stderr: "" });
      }
      return {} as any;
    });

    await expect(rollupAndCleanup({
      worktreePath: "/path/to/worktree",
      branchName: "pair/test",
    })).rejects.toThrow(WorktreeError);
  });

  it("uses provided base branch", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: "", stderr: "" });
      return {} as any;
    });

    await expect(rollupAndCleanup({
      worktreePath: "/path/to/worktree",
      branchName: "pair/test",
      baseBranch: "develop",
    })).resolves.toBeUndefined();
  });
});

describe("removeWorktree", () => {
  it("removes worktree force", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: "", stderr: "" });
      return {} as any;
    });

    await expect(removeWorktree("/path/to/worktree")).resolves.toBeUndefined();
  });

  it("ignores errors", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(new Error("permission denied"), { stdout: "", stderr: "" });
      return {} as any;
    });

    await expect(removeWorktree("/path/to/worktree")).resolves.toBeUndefined();
  });
});
