import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorktreeError, requireGitOrThrow, validateRepoState, requireInsideWorkTree } from "../../src/worktree/validate";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

describe("WorktreeError", () => {
  it("has correct name and message", () => {
    const err = new WorktreeError("test error");
    expect(err.name).toBe("WorktreeError");
    expect(err.message).toBe("test error");
  });
});

describe("requireGitOrThrow", () => {
  it("succeeds when git is available", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: "git version 2.39.0", stderr: "" });
      return {} as any;
    });
    await expect(requireGitOrThrow()).resolves.toBeUndefined();
  });

  it("throws WorktreeError when git is not available", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(new Error("command not found"), { stdout: "", stderr: "" });
      return {} as any;
    });
    await expect(requireGitOrThrow()).rejects.toThrow(WorktreeError);
  });
});

describe("validateRepoState", () => {
  it("succeeds on clean working tree", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      callCount++;
      if (callCount === 1) {
        // git --version
        cb(null, { stdout: "git version 2.39.0", stderr: "" });
      } else {
        // git status --porcelain
        cb(null, { stdout: "", stderr: "" });
      }
      return {} as any;
    });
    await expect(validateRepoState()).resolves.toBeUndefined();
  });

  it("throws on dirty working tree", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      callCount++;
      if (callCount === 1) {
        cb(null, { stdout: "git version 2.39.0", stderr: "" });
      } else {
        cb(null, { stdout: "M file.txt", stderr: "" });
      }
      return {} as any;
    });
    await expect(validateRepoState()).rejects.toThrow(WorktreeError);
  });

  it("skips dirty check when allowDirty is true", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: "git version 2.39.0", stderr: "" });
      return {} as any;
    });
    await expect(validateRepoState({ allowDirty: true })).resolves.toBeUndefined();
  });
});

describe("requireInsideWorkTree", () => {
  it("returns repo root when inside work tree", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      callCount++;
      if (callCount === 1) {
        cb(null, { stdout: "true", stderr: "" });
      } else {
        cb(null, { stdout: "/Users/test/repo\n", stderr: "" });
      }
      return {} as any;
    });
    const root = await requireInsideWorkTree();
    expect(root).toBe("/Users/test/repo");
  });

  it("throws when not inside work tree", async () => {
    mockExecFile.mockImplementation((_cmd: string, _args: string[], cb: any) => {
      cb(null, { stdout: "false", stderr: "" });
      return {} as any;
    });
    await expect(requireInsideWorkTree()).rejects.toThrow(WorktreeError);
  });
});
