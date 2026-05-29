import { describe, expect, it } from "vitest";

import { composeVerifyFixesPrompt } from "../src/tools/shared";

/**
 * Round-2+ reviewer prompt builder. Without this, the loop runs a
 * fresh full review every round and finds new things on each pass —
 * burning hours of agent time without converging. This prompt scopes
 * the reviewer to (a) verifying the prior P0/P1/P2 findings are
 * addressed and (b) flagging revision-introduced regressions only.
 */
describe("composeVerifyFixesPrompt", () => {
  const baseArgs = {
    label: "plan",
    priorVerdictText: "## Findings\n### P0\n- Missing M2 spec\n## Verdict\nVERDICT: REVISE",
    priorPayload: "Plan v1\n## Goal\n- Build X\n## Milestones\n- M1: foo",
    revisedPayload: "Plan v2\n## Goal\n- Build X\n## Milestones\n- M1: foo\n- M2: bar",
  };

  it("embeds the prior verdict text so the reviewer can see what it found last round", () => {
    const out = composeVerifyFixesPrompt(baseArgs);
    expect(out).toContain("## Findings\n### P0\n- Missing M2 spec");
    expect(out).toContain("VERDICT: REVISE");
    expect(out).toContain("--- PRIOR VERDICT");
    expect(out).toContain("--- END PRIOR VERDICT ---");
  });

  it("embeds the prior payload AND the revised payload under labeled fences", () => {
    const out = composeVerifyFixesPrompt(baseArgs);
    expect(out).toContain("--- PRIOR PLAN");
    expect(out).toContain("--- END PRIOR PLAN ---");
    expect(out).toContain("Plan v1\n## Goal\n- Build X");
    expect(out).toContain("--- REVISED PLAN");
    expect(out).toContain("--- END REVISED PLAN ---");
    expect(out).toContain("Plan v2\n## Goal");

    // Order matters: prior must appear BEFORE revised so the reviewer
    // reads them as before/after.
    const priorIdx = out.indexOf("--- PRIOR PLAN");
    const revisedIdx = out.indexOf("--- REVISED PLAN");
    expect(priorIdx).toBeGreaterThan(0);
    expect(revisedIdx).toBeGreaterThan(priorIdx);
  });

  it("explicitly tells the reviewer to scope the round to verifying prior findings + revision-introduced regressions", () => {
    const out = composeVerifyFixesPrompt(baseArgs);
    // The narrow-scope instruction is the WHOLE point of this prompt;
    // assert the language survives any future copy-edits.
    expect(out).toMatch(/verify|address|adequately/i);
    expect(out).toMatch(/regression|directly introduced/i);
    // Negative: the reviewer must NOT be told to enumerate everything.
    expect(out).toMatch(/do NOT enumerate|do not search/i);
  });

  it("specifies APPROVED vs REVISE decision rule for round 2+", () => {
    const out = composeVerifyFixesPrompt(baseArgs);
    expect(out).toContain("VERDICT: APPROVED");
    expect(out).toContain("VERDICT: REVISE");
    // P3 cosmetic findings can be dropped — the prompt says so explicitly.
    expect(out).toMatch(/P3 .* may be dropped/i);
  });

  it("the `label` parameter customizes the fence headers (used by impl/followup variants)", () => {
    const out = composeVerifyFixesPrompt({ ...baseArgs, label: "code change for M3" });
    expect(out).toContain("--- PRIOR CODE CHANGE FOR M3");
    expect(out).toContain("--- REVISED CODE CHANGE FOR M3");
    // The body still reads naturally with the lower-case label.
    expect(out).toContain("reviewed this code change for M3");
  });

  it("does NOT include the verdict template — that is appended by `makeReviewer` so every reviewer spawn gets it once", () => {
    // The template lives in shared.ts:REVIEWER_VERDICT_TEMPLATE.
    // composeVerifyFixesPrompt must not duplicate it; doubling it
    // would confuse the reviewer about the expected output shape.
    const out = composeVerifyFixesPrompt(baseArgs);
    expect(out).not.toContain("Return your review using EXACTLY this structure");
    expect(out).not.toContain("DO NOT use phrases like");
  });
});
