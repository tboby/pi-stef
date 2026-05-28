import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { captureBaseline } from "../src/plan/baseline";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-skip-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("captureBaseline gitMode guard", () => {
  it("returns undefined and skips write when gitMode='off'", async () => {
    const planRoot = path.join(tmpDir, "plans");
    const slug = "2026-05-26-test-task";
    fs.mkdirSync(path.join(planRoot, slug), { recursive: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await captureBaseline(planRoot, slug, { gitMode: "off" } as any);

    expect(result).toBeUndefined();
    const baselinePath = path.join(planRoot, slug, "baseline.json");
    expect(fs.existsSync(baselinePath)).toBe(false);
  });

  it("writes baseline.json at planRoot/<slug>/ when gitMode is absent", async () => {
    const planRoot = path.join(tmpDir, "plans");
    const slug = "2026-05-26-test-task";
    fs.mkdirSync(path.join(planRoot, slug), { recursive: true });

    const result = await captureBaseline(planRoot, slug);

    expect(result).toBeDefined();
    expect(typeof result?.headSha).toBe("string");
    const baselinePath = path.join(planRoot, slug, "baseline.json");
    expect(fs.existsSync(baselinePath)).toBe(true);
  });
});
