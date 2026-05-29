import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { composeMilestoneBrief, composeMilestoneRevise } from "../src/tools/implement";
import {
  composeDeveloperBrief as composeTaskDevBrief,
  composeDevRevise as composeTaskDevRevise,
} from "../src/tools/task";
import {
  composeDeveloperBrief as composeFollowupDevBrief,
  composeDevRevise as composeFollowupDevRevise,
} from "../src/tools/followup";
import { composeDeveloperSystemPreamble } from "../src/tools/shared";
import type { ParsedMilestone } from "../src/plan/tracker";

const M1: ParsedMilestone = {
  id: "M1",
  title: "Sample milestone",
  approvalStatus: undefined,
  stories: [
    { id: "S-101", description: "do x", status: "pending", notes: "" },
  ],
};
const PLAN = `### M1: Sample milestone\nbody-1\n\n### M2: Next\nbody-2\n`;
const FINDINGS = { findings: { P0: ["something"], P1: [], P2: [], P3: [] } };

describe("INITIAL developer prompts must explicitly forbid `git commit`", () => {
  it("implement.composeMilestoneBrief tells the developer NOT to commit", () => {
    const brief = composeMilestoneBrief(M1, PLAN);
    expect(brief).toMatch(/DO NOT run `git commit`/);
    expect(brief).toMatch(/orchestrator commits/i);
    expect(brief).toMatch(/stage only files you touched/i);
    expect(brief).toMatch(/never git add -A/);
  });

  it("task.composeDeveloperBrief tells the developer NOT to commit", () => {
    const brief = composeTaskDevBrief("plan body");
    expect(brief).toMatch(/DO NOT run `git commit`/);
    expect(brief).toMatch(/orchestrator commits/i);
    expect(brief).toMatch(/stage only files you touched/i);
  });

  it("followup.composeDeveloperBrief tells the developer NOT to commit", () => {
    const brief = composeFollowupDevBrief("plan body");
    expect(brief).toMatch(/DO NOT run `git commit`/);
    expect(brief).toMatch(/orchestrator commits/i);
    expect(brief).toMatch(/stage only files you touched/i);
  });
});

describe("REVISE developer prompts also forbid `git commit` (fresh --no-session spawn doesn't carry initial-prompt context)", () => {
  it("implement.composeMilestoneRevise tells the developer NOT to commit", () => {
    const revise = composeMilestoneRevise("M1", "diff body", FINDINGS);
    expect(revise).toMatch(/DO NOT run `git commit`/);
    expect(revise).toMatch(/orchestrator commits/i);
    expect(revise).toMatch(/stage only files you touched/i);
  });

  it("task.composeDevRevise tells the developer NOT to commit", () => {
    const revise = composeTaskDevRevise("diff body", FINDINGS);
    expect(revise).toMatch(/DO NOT run `git commit`/);
    expect(revise).toMatch(/orchestrator commits/i);
    expect(revise).toMatch(/stage only files you touched/i);
  });

  it("followup.composeDevRevise tells the developer NOT to commit", () => {
    const revise = composeFollowupDevRevise("diff body", FINDINGS);
    expect(revise).toMatch(/DO NOT run `git commit`/);
    expect(revise).toMatch(/orchestrator commits/i);
    expect(revise).toMatch(/stage only files you touched/i);
  });
});

describe("source-level invariants: developer skill list excludes auto-commit / worktree skills", () => {
  // The auto-commit skill contradicts the orchestrator's contract. We assert
  // the literal-source content of `defaultDev` rather than spawning, because
  // the skills set is constructed once at factory time and threaded through
  // many code paths — the simplest reliable assertion is on the source.
  it("implement.ts defaultDev skills literal excludes finishing-a-development-branch and using-git-worktrees", () => {
    const src = readFileSync(
      path.join(__dirname, "..", "src", "tools", "implement.ts"),
      "utf8",
    );
    const m = src.match(/function defaultDev\([^)]*\)[^{]*\{[\s\S]*?^}/m);
    expect(m, "defaultDev() must be locatable in implement.ts").toBeTruthy();
    const body = m![0];
    expect(body).toMatch(/skills:\s*\[/);
    expect(body).not.toMatch(/['"]finishing-a-development-branch['"]/);
    expect(body).not.toMatch(/['"]using-git-worktrees['"]/);
    expect(body).toMatch(/['"]tdd['"]/);
    expect(body).toMatch(/['"]verification-before-completion['"]/);
  });

  it("skills/team/developer.yaml metadata is consistent (no auto-commit skills, no hard-coded git wording)", () => {
    const yaml = readFileSync(
      path.join(__dirname, "..", "skills", "team", "developer.yaml"),
      "utf8",
    );
    expect(yaml).not.toMatch(/finishing-a-development-branch/);
    expect(yaml).not.toMatch(/using-git-worktrees/);
    expect(yaml).toMatch(/tdd/);
    expect(yaml).toMatch(/verification-before-completion/);
    // Git/staging wording moved from YAML to composeDeveloperSystemPreamble
    expect(yaml).not.toMatch(/DO NOT run `git commit`/);
    expect(yaml).not.toMatch(/stage only the files you touched/i);
  });

  it("composeDeveloperSystemPreamble({gitMode:'on'}) carries the git contract previously in the YAML", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "on" });
    expect(preamble).toMatch(/DO NOT run `git commit`/);
    expect(preamble).toMatch(/stage only the files you touched/i);
    expect(preamble).toMatch(/never git add -A/i);
  });
});
