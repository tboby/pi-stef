import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveSkillPath } from "../src/runtime/resolve-skill";

function tmp(): { dir: string; dispose: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "ct-skill-"));
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("M4 resolveSkillPath", () => {
  it("returns undefined for unknown skill", () => {
    const { dir, dispose } = tmp();
    try {
      expect(resolveSkillPath("nope", { homeDir: dir, repoRoot: dir })).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("finds a skill under ~/.pi/skills/<name>", () => {
    const { dir, dispose } = tmp();
    try {
      const skillsDir = path.join(dir, ".pi", "skills", "mySkill");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(path.join(skillsDir, "SKILL.md"), "# hi");
      const resolved = resolveSkillPath("mySkill", { homeDir: dir, repoRoot: dir });
      expect(resolved).toBe(skillsDir);
    } finally {
      dispose();
    }
  });

  it("finds a skill under repo-local skills/<name>", () => {
    const { dir, dispose } = tmp();
    try {
      const skillsDir = path.join(dir, "skills", "tdd");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(path.join(skillsDir, "SKILL.md"), "# tdd");
      const resolved = resolveSkillPath("tdd", { homeDir: tmpdir(), repoRoot: dir });
      expect(resolved).toBe(skillsDir);
    } finally {
      dispose();
    }
  });

  it("finds nested repo-local skills by SKILL.md frontmatter name", () => {
    const { dir, dispose } = tmp();
    try {
      const skillsDir = path.join(dir, "skills", "mobile", "testing");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(path.join(skillsDir, "SKILL.md"), "---\nname: mobile-testing\ndescription: test mobile apps\n---\n# Mobile Testing\n");
      const resolved = resolveSkillPath("mobile-testing", { homeDir: tmpdir(), repoRoot: dir });
      expect(resolved).toBe(skillsDir);
    } finally {
      dispose();
    }
  });

  it("finds a skill under packages/<pkg>/skills/<name>", () => {
    const { dir, dispose } = tmp();
    try {
      const skillsDir = path.join(dir, "packages", "alpha", "skills", "tdd");
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(path.join(skillsDir, "SKILL.md"), "# tdd");
      const resolved = resolveSkillPath("tdd", { homeDir: tmpdir(), repoRoot: dir });
      expect(resolved).toBe(skillsDir);
    } finally {
      dispose();
    }
  });

  it("respects extraRoots for fh-agent skill dirs", () => {
    const { dir, dispose } = tmp();
    try {
      const root = path.join(dir, "extra");
      const skillDir = path.join(root, "writing-plans");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(path.join(skillDir, "SKILL.md"), "# wp");
      const resolved = resolveSkillPath("writing-plans", {
        homeDir: tmpdir(),
        repoRoot: tmpdir(),
        extraRoots: [root],
      });
      expect(resolved).toBe(skillDir);
    } finally {
      dispose();
    }
  });
});
