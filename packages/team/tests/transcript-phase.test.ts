import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTranscript } from "../src/orchestrator/transcript";

describe("transcript per-phase counters", () => {
  it("starts at 0001 for each phase and buckets files", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "fh-tx-"));
    try {
      const t = createTranscript(repoRoot, "demo");
      await t.record({ role: "planner", label: "draft", body: "x" });
      await t.record({ role: "reviewer", label: "round-1", body: "y", status: "APPROVED" });
      t.setPhase("implementation");
      await t.record({ role: "developer", label: "impl-M1-S101", body: "z" });

      const planning = readdirSync(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "planning"),
      ).sort();
      const impl = readdirSync(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "implementation"),
      ).sort();
      expect(planning).toHaveLength(2);
      expect(planning[0]).toMatch(/^0001-/);
      expect(planning[1]).toMatch(/^0002-/);
      expect(impl).toHaveLength(1);
      expect(impl[0]).toMatch(/^0001-/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("resumes counter from existing files in the phase folder", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "fh-tx-"));
    try {
      const planning = path.join(repoRoot, "ai_plan", "demo", "transcript", "planning");
      mkdirSync(planning, { recursive: true });
      writeFileSync(path.join(planning, "0007-existing.md"), "");
      const t = createTranscript(repoRoot, "demo");
      const written = await t.record({ role: "planner", label: "resume", body: "x" });
      expect(written).toBeDefined();
      expect(path.basename(written!)).toMatch(/^0008-/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("system entries land in the active phase", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "fh-tx-"));
    try {
      const t = createTranscript(repoRoot, "demo");
      await t.record({ role: "system", label: "validation-failed", body: "p", status: "FAILED" });
      t.setPhase("implementation");
      await t.record({ role: "system", label: "patch-1", body: "q" });
      const planning = readdirSync(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "planning"),
      );
      const impl = readdirSync(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "implementation"),
      );
      expect(planning.some((f) => f.includes("validation-failed"))).toBe(true);
      expect(impl.some((f) => f.includes("patch-1"))).toBe(true);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("resume counters are independent per phase", async () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "fh-tx-"));
    try {
      const planning = path.join(repoRoot, "ai_plan", "demo", "transcript", "planning");
      const impl = path.join(repoRoot, "ai_plan", "demo", "transcript", "implementation");
      mkdirSync(planning, { recursive: true });
      mkdirSync(impl, { recursive: true });
      writeFileSync(path.join(planning, "0003-prev.md"), "");
      writeFileSync(path.join(impl, "0010-prev.md"), "");
      const t = createTranscript(repoRoot, "demo");
      const planningWrite = await t.record({ role: "planner", label: "after-resume", body: "x" });
      t.setPhase("implementation");
      const implWrite = await t.record({ role: "developer", label: "after-resume", body: "y" });
      expect(path.basename(planningWrite!)).toMatch(/^0004-/);
      expect(path.basename(implWrite!)).toMatch(/^0011-/);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it("folder() returns the active phase folder by default", () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "fh-tx-"));
    try {
      const t = createTranscript(repoRoot, "demo");
      expect(t.folder()).toBe(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "planning"),
      );
      t.setPhase("implementation");
      expect(t.folder()).toBe(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "implementation"),
      );
      // explicit override regardless of active phase
      expect(t.folder("planning")).toBe(
        path.join(repoRoot, "ai_plan", "demo", "transcript", "planning"),
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
