import { describe, expect, it } from "vitest";

import {
  PLANNER_TDD_REMINDER,
  REVIEWER_TDD_POLICY,
  composeTddContract,
} from "../src/tools/tdd-policy";
import {
  composeDeveloperBrief,
  composeDevRevise,
} from "../src/tools/run-task-workflow";
import {
  composeMilestoneBrief,
  composeStoryBrief,
  composeMilestoneRevise,
  composeEmptyDiffReprompt,
  composeStoryEmptyDiffReprompt,
} from "../src/tools/implement";
import { composeImplVerifyFixesPrompt } from "../src/tools/impl-summary";
import type { ParsedMilestone, ParsedStory } from "../src/plan/tracker";

function makeMilestoneFixture(): ParsedMilestone {
  const story: ParsedStory = {
    id: "S-101",
    description: "do x",
    status: "pending",
    notes: "",
  };
  return {
    id: "M1",
    title: "Sample milestone",
    approvalStatus: undefined,
    stories: [story],
  };
}

const PLAN_BODY = "### M1: Sample milestone\nbody-1\n\n### M2: Next\nbody-2\n";
const FINDINGS = { findings: { P0: ["something"], P1: [], P2: [], P3: [] } };

describe("TDD policy text — full snapshots lock the canonical wording", () => {
  // Inline snapshots so any drift in the canonical policy text fails this
  // test. Substring-only assertions (toContain) would let most of the body
  // change silently as long as the fragments survived.

  it("composeTddContract() — full text snapshot", () => {
    expect(composeTddContract()).toMatchInlineSnapshot(`
      "
      ## Mandatory test-first contract

      BEFORE writing any non-test code you MUST:

      1. **Write the test(s)** that capture the new/changed behavior. Add them to a *.test.ts (or *.spec.ts) file colocated with existing tests for the area you are touching.
      2. **Run them and confirm they fail (RED).** Use a targeted command (e.g. \`pnpm -F <pkg> test path/to/the.test.ts\` or \`pnpm -F <pkg> test -t "<test-name>"\`). Show that the test fails for the right reason — assertion failure on the new behavior, not a syntax error or import miss.
      3. **Implement the change.** Stage only files you touched (never \`git add -A\`).
      4. **Re-run the SAME targeted command and confirm GREEN.** ALL tests in the touched test file(s) — both the new ones and any pre-existing tests in those files — must pass. Do NOT run the full suite; the orchestrator runs the configured verification gate (typecheck + full test) after impl-review approval.

      Your handoff prose to the reviewer MUST include a section titled \`## TDD proof\` with the four labeled subsections:

        ### Tests added
        - \`<file>::<test-name>\` — one-line description per test

        ### Red
        \`\`\`
        <verbatim output of step 2: command + the failure tail>
        \`\`\`

        ### Implementation
        - One line summarizing what changed and why it now satisfies the test.

        ### Green
        \`\`\`
        <verbatim output of step 4: command + the pass summary line>
        \`\`\`

      If the change is genuinely test-irrelevant (docs, README, package.json bumps, type-only signature changes with no runtime branch), replace the \`## TDD proof\` section with a single line:

        \`no-test-needed: <one-sentence reason citing why no behavior changed>\`

      The reviewer will reject your handoff (P0 finding) if this proof block is missing or if the no-test-needed rationale is unconvincing for the staged diff."
    `);
  });

  it("REVIEWER_TDD_POLICY — full text snapshot", () => {
    expect(REVIEWER_TDD_POLICY()).toMatchInlineSnapshot(`
      "
      ## TDD enforcement

      The developer is bound by a strict test-first contract. The handoff prose MUST contain a \`## TDD proof\` section with \`### Tests added\`, \`### Red\`, \`### Implementation\`, \`### Green\` subsections. The single-line escape hatch \`no-test-needed: <reason>\` is acceptable ONLY when the staged diff is non-code (docs / config / type-only).

      If the proof block is missing OR the no-test-needed rationale is unconvincing for the staged diff, issue a P0 finding ("TDD proof missing" or "unconvincing no-test-needed rationale: <why>") and \`VERDICT: REVISE\`. Do NOT approve solely because the staged diff looks correct — without the proof, you cannot tell whether the developer actually exercised the change."
    `);
  });

  it("PLANNER_TDD_REMINDER — full text snapshot", () => {
    expect(PLANNER_TDD_REMINDER()).toMatchInlineSnapshot(`
      "
      ## Test-first planning reminder

      The downstream developer agent is bound by a strict test-first contract: write the test(s), confirm RED, implement, confirm GREEN. Lay out the plan body so each story explicitly schedules its test step BEFORE the implementation step. For test-irrelevant work (docs / config / type-only) you may omit the test step; flag those stories explicitly with \`no-test-needed: <reason>\`."
    `);
  });
});

describe("Every developer-brief composer embeds the TDD contract", () => {
  it("composeDeveloperBrief", () => {
    expect(composeDeveloperBrief("# Plan\n- s1")).toContain("Mandatory test-first contract");
  });

  it("composeDevRevise", () => {
    expect(composeDevRevise("diff", FINDINGS)).toContain("Mandatory test-first contract");
  });

  it("composeMilestoneBrief", () => {
    const milestone = makeMilestoneFixture();
    const out = composeMilestoneBrief(milestone, PLAN_BODY, { cwd: "/tmp" });
    expect(out).toContain("Mandatory test-first contract");
  });

  it("composeStoryBrief", () => {
    const milestone = makeMilestoneFixture();
    const story = milestone.stories[0];
    const writeSet = ["src/foo.ts"];
    const out = composeStoryBrief(milestone, story, writeSet, PLAN_BODY, { cwd: "/tmp" });
    expect(out).toContain("Mandatory test-first contract");
  });

  it("composeMilestoneRevise", () => {
    const out = composeMilestoneRevise("M1", "diff", FINDINGS, { cwd: "/tmp" });
    expect(out).toContain("Mandatory test-first contract");
  });

  it("composeEmptyDiffReprompt", () => {
    const milestone = makeMilestoneFixture();
    const out = composeEmptyDiffReprompt(milestone, "/tmp", 1);
    expect(out).toContain("Mandatory test-first contract");
  });

  it("composeStoryEmptyDiffReprompt", () => {
    const milestone = makeMilestoneFixture();
    const story = milestone.stories[0];
    const out = composeStoryEmptyDiffReprompt(milestone, story, ["src/foo.ts"], PLAN_BODY, "/tmp", 1);
    expect(out).toContain("Mandatory test-first contract");
  });
});

describe("gitMode: 'off' — developer prompts suppress staging/git language", () => {
  it("composeDeveloperBrief suppresses staging instructions", () => {
    const out = composeDeveloperBrief("# Plan\n- s1", { gitMode: "off" });
    expect(out).not.toContain("Stage only");
    expect(out).not.toContain("git add");
    expect(out).not.toContain("git commit");
    expect(out).toContain("Do NOT use git commands");
  });

  it("composeMilestoneBrief suppresses staging instructions", () => {
    const milestone = makeMilestoneFixture();
    const out = composeMilestoneBrief(milestone, PLAN_BODY, { cwd: "/tmp", gitMode: "off" });
    expect(out).not.toContain("Stage only");
    expect(out).not.toContain("git add");
    expect(out).toContain("Do NOT use git commands");
  });

  it("composeStoryBrief suppresses staging instructions", () => {
    const milestone = makeMilestoneFixture();
    const story = milestone.stories[0];
    const out = composeStoryBrief(milestone, story, ["src/foo.ts"], PLAN_BODY, { cwd: "/tmp", gitMode: "off" });
    expect(out).not.toContain("Stage only");
    expect(out).not.toContain("git add");
    expect(out).toContain("Do NOT use git commands");
  });

  it("composeEmptyDiffReprompt uses no-git wording", () => {
    const milestone = makeMilestoneFixture();
    const out = composeEmptyDiffReprompt(milestone, "/tmp", 1, { gitMode: "off" });
    expect(out).not.toContain("empty git diff");
    expect(out).not.toContain("stage actual changes");
    expect(out).toContain("no file changes");
    expect(out).toContain("make actual changes");
    expect(out).toContain("Do NOT use git commands");
  });

  it("composeStoryEmptyDiffReprompt uses no-git wording", () => {
    const milestone = makeMilestoneFixture();
    const story = milestone.stories[0];
    const out = composeStoryEmptyDiffReprompt(milestone, story, ["src/foo.ts"], PLAN_BODY, "/tmp", 1, { gitMode: "off" });
    expect(out).not.toContain("empty git diff");
    expect(out).not.toContain("stage actual changes");
    expect(out).toContain("no file changes");
    expect(out).toContain("make actual changes");
    expect(out).toContain("Do NOT use git commands");
  });
});

describe("Every reviewer-prompt composer embeds the reviewer TDD policy", () => {
  it("composeImplVerifyFixesPrompt", () => {
    const out = composeImplVerifyFixesPrompt({
      milestoneId: "M1",
      cwd: "/tmp",
      originalImplSummary: "summary",
      priorVerdictText: "## Verdict\nVERDICT: REVISE",
      currentFixSummary: "fix",
      transcriptHints: { priorVerdictName: "x" },
    });
    expect(out).toContain("TDD enforcement");
  });
  // Round-1 reviewer kickoffs are inline closures inside runTaskWorkflow
  // and implement.ts; covered indirectly via integration in M3.
});
