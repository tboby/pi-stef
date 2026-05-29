import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createTranscript } from "../src/orchestrator/transcript";

describe("createTranscript: per-orchestrator-run agent handoff log", () => {
  it("writes files under ai_plan/<slug>/transcript/<phase>/ with NNNN-role-label naming", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ts-"));
    try {
      const t = createTranscript(root, "demo");
      const p1 = await t.record({ role: "researcher", label: "analysis", body: "{}", status: "OK" });
      const p2 = await t.record({ role: "planner", label: "draft", body: "draft body" });
      const p3 = await t.record({ role: "reviewer", label: "review", round: 1, body: "verdict body", status: "REVISE" });
      const p4 = await t.record({ role: "planner", label: "revision", round: 1, body: "revised body" });
      const p5 = await t.record({ role: "reviewer", label: "review", round: 2, body: "verdict 2", status: "APPROVED" });

      expect(p1).toBeDefined();
      const folder = path.join(root, "ai_plan", "demo", "transcript", "planning");
      expect(existsSync(folder)).toBe(true);
      const files = readdirSync(folder).sort();
      expect(files).toEqual([
        "0001-researcher-analysis-OK.md",
        "0002-planner-draft.md",
        "0003-reviewer-review-round-1-REVISE.md",
        "0004-planner-revision-round-1.md",
        "0005-reviewer-review-round-2-APPROVED.md",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes a header line + meta block + body in each file", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ts-body-"));
    try {
      const t = createTranscript(root, "demo");
      await t.record({
        role: "reviewer",
        label: "review",
        round: 3,
        body: "## Verdict\nVERDICT: REVISE",
        status: "REVISE",
        meta: { P0: 1, P1: 0, P2: 2, P3: 0 },
      });
      const file = path.join(root, "ai_plan", "demo", "transcript", "planning", "0001-reviewer-review-round-3-REVISE.md");
      const body = readFileSync(file, "utf8");
      expect(body).toMatch(/^# reviewer — review \(round 3\) — REVISE$/m);
      expect(body).toContain("- **P0**: 1");
      expect(body).toContain("- **P2**: 2");
      expect(body).toContain("VERDICT: REVISE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never throws: best-effort write swallows folder-creation errors", async () => {
    // Use an invalid path — repoRoot points at a regular file so mkdir(folder, recursive:true)
    // will fail with ENOTDIR. The recorder must return undefined, not throw.
    const blocker = mkdtempSync(path.join(tmpdir(), "ts-blocker-"));
    const filePath = path.join(blocker, "not-a-dir");
    require("node:fs").writeFileSync(filePath, "x");
    try {
      const t = createTranscript(filePath, "demo");
      await expect(t.record({ role: "planner", label: "draft", body: "x" })).resolves.toBeUndefined();
    } finally {
      rmSync(blocker, { recursive: true, force: true });
    }
  });

  it("4-digit sequence padding survives cross-100 rollover (alphabetical = chronological)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ts-seq-"));
    try {
      const t = createTranscript(root, "demo");
      for (let i = 0; i < 105; i += 1) {
        await t.record({ role: "planner", label: `step`, body: "x" });
      }
      const folder = path.join(root, "ai_plan", "demo", "transcript", "planning");
      const files = readdirSync(folder);
      const sorted = [...files].sort();
      // First, second, and last in chronological insertion order.
      expect(sorted[0]).toMatch(/^0001-/);
      expect(sorted[1]).toMatch(/^0002-/);
      expect(sorted[99]).toMatch(/^0100-/); // crossing the 100 boundary
      expect(sorted[104]).toMatch(/^0105-/);
      // Critical invariant: 0099 sorts before 0100 (would FAIL with 2-digit padding).
      const idx99 = sorted.indexOf(sorted.find((f) => f.startsWith("0099-"))!);
      const idx100 = sorted.indexOf(sorted.find((f) => f.startsWith("0100-"))!);
      expect(idx99).toBeLessThan(idx100);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("sanitizes EVERY filename component (role, label, status) — not just label", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ts-san-"));
    try {
      const t = createTranscript(root, "demo");
      // Hostile inputs: slashes, traversal sequences, control chars, spaces.
      await t.record({
        role: "system",
        label: "weird label / with spaces & punct!",
        body: "x",
        status: "REVISE/PARTIAL", // status with a slash MUST NOT escape the folder
      });
      const folder = path.join(root, "ai_plan", "demo", "transcript", "planning");
      const files = readdirSync(folder);
      expect(files).toHaveLength(1);
      // No slashes in any component; every non-alphanumeric run collapses.
      expect(files[0]).not.toMatch(/\//);
      expect(files[0]).toBe("0001-system-weird-label-with-spaces-punct-REVISE-PARTIAL.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("status containing path-traversal characters cannot escape the transcript folder", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ts-esc-"));
    try {
      const t = createTranscript(root, "demo");
      await t.record({ role: "reviewer", label: "review", body: "x", status: "../../etc" });
      const folder = path.join(root, "ai_plan", "demo", "transcript", "planning");
      const files = readdirSync(folder);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe("0001-reviewer-review-ETC.md");
      // Nothing outside the transcript folder was written.
      expect(existsSync(path.join(root, "etc"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
