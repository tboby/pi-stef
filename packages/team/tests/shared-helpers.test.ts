/**
 * Tests for shared-helpers diff functions, particularly verifying that
 * readStagedDiff and readStagedDiffStat handle large output (>1MB)
 * without truncation due to spawnSync's default maxBuffer.
 */
import { describe, expect, it, vi } from "vitest";

import {
  GIT_MAX_BUFFER,
  readStagedDiff,
  readStagedDiffStat,
} from "../src/tools/shared-helpers";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";

const mockedSpawnSync = vi.mocked(spawnSync);

describe("GIT_MAX_BUFFER", () => {
  it("should be 50MB", () => {
    expect(GIT_MAX_BUFFER).toBe(50 * 1024 * 1024);
  });
});

describe("readStagedDiff", () => {
  it("returns full output when diff exceeds 1MB default maxBuffer", () => {
    const largeDiff = "diff --git a/big.ts b/big.ts\n".repeat(60_000);
    expect(largeDiff.length).toBeGreaterThan(1024 * 1024);

    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: largeDiff,
      stderr: "",
      pid: 1,
      output: [null, largeDiff, ""],
      signal: null,
    } as ReturnType<typeof spawnSync>);

    const result = readStagedDiff("/fake/repo");
    expect(result).toBe(largeDiff);
    expect(result.length).toBeGreaterThan(1024 * 1024);

    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--cached"],
      expect.objectContaining({ maxBuffer: GIT_MAX_BUFFER }),
    );
  });

  it('returns "" on non-zero exit status', () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "error",
      pid: 1,
      output: [null, "", "error"],
      signal: null,
    } as ReturnType<typeof spawnSync>);

    expect(readStagedDiff("/fake/repo")).toBe("");
  });
});

describe("readStagedDiffStat", () => {
  it("passes maxBuffer to spawnSync", () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: " file.ts | 5 ++++-\n",
      stderr: "",
      pid: 1,
      output: [null, " file.ts | 5 ++++-\n", ""],
      signal: null,
    } as ReturnType<typeof spawnSync>);

    readStagedDiffStat("/fake/repo");
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "git",
      ["diff", "--cached", "--stat"],
      expect.objectContaining({ maxBuffer: GIT_MAX_BUFFER }),
    );
  });
});
