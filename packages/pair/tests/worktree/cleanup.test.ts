import { describe, it, expect, vi } from "vitest";
import { removeWorktree } from "../../src/worktree/cleanup";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
const mockExecFile = vi.mocked(execFile);

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
