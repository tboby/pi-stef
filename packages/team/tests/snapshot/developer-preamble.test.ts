/**
 * S-603: Snapshot tests for composeDeveloperSystemPreamble.
 *
 * (a) gitMode='off' — final prompt must contain no staging/commit tokens
 * (b) gitMode='on'  — must contain the original four git/staging sentences
 */
import { describe, expect, it } from "vitest";
import { composeDeveloperSystemPreamble } from "../../src/tools/shared";
import { composeDeveloperBrief, composeDevRevise } from "../../src/tools/run-task-workflow";

const STAGING_COMMIT_RE = /\b(stage|staged|git add|git commit)\b/i;

describe("composeDeveloperSystemPreamble gitMode='off'", () => {
  it("contains no staging or git-commit tokens", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "off" });
    expect(preamble).not.toMatch(STAGING_COMMIT_RE);
  });

  it("tells developer to emit a ## Changes block", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "off" });
    expect(preamble).toMatch(/## Changes/);
  });
});

describe("composeDeveloperSystemPreamble gitMode='on'", () => {
  it("contains DO NOT run git commit", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "on" });
    expect(preamble).toMatch(/DO NOT run `git commit`/);
  });

  it("contains stage only files you touched and never git add -A", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "on" });
    expect(preamble).toMatch(/stage only the files you touched/i);
    expect(preamble).toMatch(/never git add -A/i);
  });

  it("mentions orchestrator handles worktree/commit", () => {
    const preamble = composeDeveloperSystemPreamble({ gitMode: "on" });
    expect(preamble).toMatch(/orchestrator/i);
  });
});

describe("composeDeveloperBrief final prompt (gitMode='off')", () => {
  it("assembled prompt has no staging/commit tokens when gitMode='off'", () => {
    const prompt = composeDeveloperBrief("## Plan\n\nDo the thing.", { gitMode: "off" });
    expect(prompt).not.toMatch(STAGING_COMMIT_RE);
  });
});

describe("composeDeveloperBrief final prompt (gitMode='on')", () => {
  it("assembled prompt contains git commit instructions when gitMode='on'", () => {
    const prompt = composeDeveloperBrief("## Plan\n\nDo the thing.", { gitMode: "on" });
    expect(prompt).toMatch(/DO NOT run `git commit`/);
    expect(prompt).toMatch(/stage only the files you touched/i);
  });
});

describe("composeDevRevise final prompt", () => {
  const FINDINGS = { findings: { P0: [], P1: [], P2: [], P3: [] } };
  it("gitMode='off' has no staging/commit tokens", () => {
    const prompt = composeDevRevise("diff", FINDINGS, { gitMode: "off" });
    expect(prompt).not.toMatch(STAGING_COMMIT_RE);
  });

  it("gitMode='on' contains git commit instructions", () => {
    const prompt = composeDevRevise("diff", FINDINGS, { gitMode: "on" });
    expect(prompt).toMatch(/DO NOT run `git commit`/);
  });
});
