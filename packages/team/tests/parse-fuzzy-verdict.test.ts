import { describe, expect, it } from "vitest";

import { isApproved, parseFuzzyVerdict, parseReviewerVerdict } from "../src/review/parse";

/**
 * Real-world reviewer output that broke the previous strict-only parser:
 * `## Verdict: **Approve with minor revisions**` + `### Required revisions`
 * + `### Optional improvements`. Caused infinite loops in the wild because
 * verdict parsed as UNKNOWN (no `VERDICT: APPROVED` line) and findings were
 * all empty (no `### P0/P1/P2/P3` sections).
 */
const REAL_FREEFORM_VERDICT = `## Verdict: **Approve with minor revisions**

The plan is well-scoped, fact-grounded, and shows strong behavior-preservation discipline. Three small issues should be tightened before execution; none are structural blockers.

---

### Strengths

- Behavior preservation is enforced, not asserted.
- Read-only ai_plan/ rule has belt + suspenders.
- Conservative install-*.sh rule.

### Required revisions (small)

1. S-101 violates the stated ai_plan/ rule, in spirit. The plan writes baselines into ai_plan/2026-05-01-.../baseline/, then carves out an exception.
2. Tool version pinning conflicts with repo convention. Pin to exact versions.
3. TypeScript 6.0.3 + ESLint 9 compatibility is non-trivial. Add a pre-flight check.

### Optional improvements

- M5-S502 is the one user-visible doc change. Call it out explicitly.
- Add React-specific lint config for apps/catalog.

### Outstanding questions

- Q1. Are baselines allowed to live outside ai_plan/?

---

**Bottom line:** ship it after addressing the three required revisions; the optional items can be folded in during M2/M3 without re-planning.`;

describe("parseFuzzyVerdict — fallback for reviewers that ignore the strict template", () => {
  it("recognizes `## Verdict: **Approve with minor revisions**` as conditional → REVISE", () => {
    const r = parseFuzzyVerdict(REAL_FREEFORM_VERDICT);
    expect(r).not.toBeNull();
    // "Approve with minor revisions" is conditional approval — the user still
    // has work to do. Map to REVISE so the loop continues until the work is
    // actually done. (Either way isApproved() returns false because P2 is
    // populated with the required revisions; this assertion just pins the
    // explicit verdict signal.)
    expect(r!.verdict).toBe("REVISE");
  });

  it("maps `### Required revisions` items into P2 findings", () => {
    const r = parseFuzzyVerdict(REAL_FREEFORM_VERDICT);
    expect(r!.findings.P2).toHaveLength(3);
    expect(r!.findings.P2[0]).toMatch(/S-101 violates/);
    expect(r!.findings.P2[1]).toMatch(/version pinning/);
    expect(r!.findings.P2[2]).toMatch(/TypeScript 6.0.3/);
  });

  it("maps `### Optional improvements` items into P3 findings", () => {
    const r = parseFuzzyVerdict(REAL_FREEFORM_VERDICT);
    expect(r!.findings.P3).toHaveLength(2);
    expect(r!.findings.P3[0]).toMatch(/M5-S502/);
    expect(r!.findings.P3[1]).toMatch(/React-specific/);
  });

  it("recognizes `Verdict: Reject` / `Verdict: Revise` / `do not approve` as REVISE", () => {
    expect(parseFuzzyVerdict("## Verdict: Reject — needs rework\n### Required revisions\n- foo")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Revise\n### Required revisions\n- foo")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("## Verdict: Cannot approve at this time\n### Blockers\n- foo")?.verdict).toBe("REVISE");
  });

  it("returns null when neither verdict signal nor severity section is present", () => {
    expect(parseFuzzyVerdict("just some prose with nothing structured")).toBeNull();
  });
});

describe("parseReviewerVerdict — strict-then-fuzzy precedence", () => {
  it("strict structure still wins when both forms are present (defense: trust the explicit template)", () => {
    const text = `## Summary\nok\n## Findings\n### P0\n- None.\n### P1\n- None.\n### P2\n- explicit P2 entry\n### P3\n- None.\n## Verdict\nVERDICT: REVISE\n\n### Required revisions\n- this should be ignored, P2 above wins`;
    const r = parseReviewerVerdict(text);
    expect(r.verdict).toBe("REVISE");
    expect(r.findings.P2).toEqual(["explicit P2 entry"]);
  });

  it("falls through to fuzzy when strict structure produces nothing — verdict + findings together drive correct loop behavior", () => {
    const r = parseReviewerVerdict(REAL_FREEFORM_VERDICT);
    // "Approve with minor revisions" is conditional → REVISE.
    // P2 captures the 3 required revisions; P3 captures the 2 optional improvements.
    // isApproved() returns false either way because P2 is non-empty.
    expect(r.verdict).toBe("REVISE");
    expect(r.findings.P2.length).toBe(3);
    expect(r.findings.P3.length).toBe(2);
    expect(isApproved(r)).toBe(false);
  });

  it("free-form Approve with NO revisions parses to APPROVED with empty findings (terminates loop cleanly)", () => {
    const text = `## Verdict: **Approve**\n\nThe plan looks good. Ship it.`;
    const r = parseReviewerVerdict(text);
    expect(r.verdict).toBe("APPROVED");
    expect(r.findings.P0).toEqual([]);
    expect(r.findings.P1).toEqual([]);
    expect(r.findings.P2).toEqual([]);
    expect(r.findings.P3).toEqual([]);
  });

  it("free-form Reject parses to REVISE", () => {
    const text = `## Verdict: Reject\n\n### Required revisions\n- one\n- two`;
    const r = parseReviewerVerdict(text);
    expect(r.verdict).toBe("REVISE");
    expect(r.findings.P2).toEqual(["one", "two"]);
  });

  it("regression: explicit `VERDICT: APPROVED` + free-form `### Required revisions` is BLOCKED via merged P2", () => {
    // Codex P1: previous parser returned APPROVED with empty findings →
    // false-positive approval. Now fuzzy P2 fills in even when strict
    // verdict is APPROVED, so isApproved() correctly rejects.
    const text = `## Summary\nlooks ok\n\n## Findings\n## Verdict\nVERDICT: APPROVED\n\n### Required revisions\n- something must be fixed\n- another required item`;
    const r = parseReviewerVerdict(text);
    expect(r.verdict).toBe("APPROVED");
    // BUT: P2 is non-empty so isApproved → false; loop continues.
    expect(r.findings.P2).toEqual(["something must be fixed", "another required item"]);
    expect(isApproved(r)).toBe(false);
  });

  it("conditional approval ('approve after fixing X') maps to REVISE", () => {
    expect(parseFuzzyVerdict("## Verdict: Approve after fixing the auth bug")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve once tests pass")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("## Verdict: Approve if you address the perf concern")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve, contingent on lint cleanup")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve when CI is green")?.verdict).toBe("REVISE");
  });

  it("MULTIPLE P2-equivalent sections all merge — `### Required fixes` AND `### Blockers` both contribute", () => {
    const text = `## Verdict: Revise\n\n### Required fixes\n- foo\n\n### Blockers\n- bar`;
    const r = parseFuzzyVerdict(text)!;
    expect(r.findings.P2).toEqual(["foo", "bar"]);
  });

  it("first matching P2 section being empty does NOT hide a later non-empty one", () => {
    const text = `### Required fixes\n- None.\n\n### Blockers\n- real blocker`;
    const r = parseFuzzyVerdict(text)!;
    expect(r.findings.P2).toEqual(["real blocker"]);
  });

  it("conditional approval covers multiple approval tokens", () => {
    expect(parseFuzzyVerdict("## Verdict: Approve with minor revisions")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: ship it after fixing X")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: LGTM pending test fixes")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Looks good once CI is green")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve with changes")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve with nits")?.verdict).toBe("REVISE");
  });

  it("`cannot ship it yet` maps to REVISE", () => {
    expect(parseFuzzyVerdict("Verdict: Cannot ship it yet — needs rework")?.verdict).toBe("REVISE");
  });

  it("negated approvals map to REVISE (covers contractions: don't, can't, won't, doesn't, isn't, etc.)", () => {
    expect(parseFuzzyVerdict("Verdict: Not approved")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: not LGTM")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: not ready to ship it")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: should not ship it")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: can't approve")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: doesn't look good")?.verdict).toBe("REVISE");
    // Codex round-3 P1: contracted-aux negations.
    expect(parseFuzzyVerdict("Verdict: don't approve this")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: don't ship it yet")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: won't approve")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: shouldn't approve in this state")?.verdict).toBe("REVISE");
  });

  it("approval with a benign reference to a conditional word in a separate clause is APPROVED", () => {
    // The conditional check must be clause-aware — `pending` here describes
    // the state being absent, not a condition on approval.
    expect(parseFuzzyVerdict("Verdict: Approved, no pending issues")?.verdict).toBe("APPROVED");
    expect(parseFuzzyVerdict("Verdict: Approved. No pending issues.")?.verdict).toBe("APPROVED");
    expect(parseFuzzyVerdict("Verdict: LGTM; without pending changes")?.verdict).toBe("APPROVED");
    expect(parseFuzzyVerdict("Verdict: Looks good — ready to ship without revisions")?.verdict).toBe("APPROVED");
  });

  it("conditional in the SAME clause as approval still maps to REVISE (clause-aware, not blanket)", () => {
    expect(parseFuzzyVerdict("Verdict: Approve when ready")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve after auth bug fixed")?.verdict).toBe("REVISE");
    expect(parseFuzzyVerdict("Verdict: Approve with minor revisions to README")?.verdict).toBe("REVISE");
  });

  it("explicit strict `### P2\\n- None.` BLOCKS fuzzy from filling P2 with later free-form revisions appendix", () => {
    // Reviewer explicitly emitted strict P2 = empty, then included a quoted/example
    // `### Required revisions` block elsewhere (e.g. inside a code fence or summary).
    // The strict empty MUST win.
    const text = `## Findings\n### P0\n- None.\n### P1\n- None.\n### P2\n- None.\n### P3\n- None.\n## Verdict\nVERDICT: APPROVED\n\n### Required revisions\n- this is an example, not active feedback`;
    const r = parseReviewerVerdict(text);
    expect(r.verdict).toBe("APPROVED");
    expect(r.findings.P2).toEqual([]); // strict `- None.` wins
  });

  it("strict P0/P1/P2/P3 headers consume to end-of-line — `### P2 (must fix)` does not leak '(must fix)' into findings", () => {
    const text = `## Findings\n### P0\n- None.\n### P1\n- None.\n### P2 (must fix)\n- real P2 finding\n### P3\n- None.\n## Verdict\nVERDICT: REVISE`;
    const r = parseReviewerVerdict(text);
    expect(r.findings.P2).toEqual(["real P2 finding"]);
    // The (must fix) qualifier was consumed as part of the heading, not added as an item.
    expect(r.findings.P2.some((f) => f.includes("must fix"))).toBe(false);
  });
});
