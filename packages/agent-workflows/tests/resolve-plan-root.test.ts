import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePlanRoot, planFolderPathFromRoot } from "../src/artifacts/paths";

describe("resolvePlanRoot", () => {
  const repoRoot = "/workspace/my-project";

  it("(a) undefined → <repoRoot>/ai_plan", () => {
    expect(resolvePlanRoot(repoRoot, undefined)).toBe("/workspace/my-project/ai_plan");
  });

  it("(b) absolute path → returned normalized (no trailing slash)", () => {
    expect(resolvePlanRoot(repoRoot, "/Users/me/notes/")).toBe("/Users/me/notes");
    expect(resolvePlanRoot(repoRoot, "/Users/me/notes")).toBe("/Users/me/notes");
  });

  it("(c) relative path → resolved against repoRoot", () => {
    expect(resolvePlanRoot(repoRoot, "my-plans")).toBe("/workspace/my-project/my-plans");
    expect(resolvePlanRoot(repoRoot, "./other-plans")).toBe("/workspace/my-project/other-plans");
  });

  it("(d) ~/x → expanded against os.homedir()", () => {
    const home = os.homedir();
    expect(resolvePlanRoot(repoRoot, "~/notes/plans")).toBe(path.join(home, "notes/plans"));
    expect(resolvePlanRoot(repoRoot, "~/")).toBe(home);
  });

  it("(e) trailing slash trimmed", () => {
    const result = resolvePlanRoot(repoRoot, "/some/path/");
    expect(result).not.toMatch(/\/$/);
  });

  it("(edge) filesystem root '/' is preserved as-is", () => {
    expect(resolvePlanRoot(repoRoot, "/")).toBe("/");
  });
});

describe("planFolderPathFromRoot", () => {
  it("(f) joins planRoot + slug verbatim", () => {
    expect(planFolderPathFromRoot("/workspace/plans", "2026-05-26-my-task")).toBe(
      "/workspace/plans/2026-05-26-my-task",
    );
  });

  it("(g) does NOT inject an extra ai_plan segment", () => {
    const result = planFolderPathFromRoot("/workspace/ai_plan", "2026-05-26-my-task");
    expect(result).toBe("/workspace/ai_plan/2026-05-26-my-task");
    // No double ai_plan
    expect(result).not.toContain("ai_plan/ai_plan");
  });
});
