import { describe, expect, it } from "vitest";

import { extractVerdict, isApproved, parseReviewerVerdict } from "../src/review/parse";

const FULL_APPROVED = `## Summary
Looks great.

## Findings
### P0
- None.
### P1
- None.
### P2
- None.
### P3
- Cosmetic: rename foo to bar.

## Verdict
VERDICT: APPROVED`;

const FULL_REVISE = `## Summary
Two blockers.

## Findings
### P0
- Race condition in foo() during shutdown.
### P1
- None.
### P2
- Off-by-one in bar() at line 42.
### P3
- None.

## Verdict
VERDICT: REVISE`;

describe("M5 parseReviewerVerdict", () => {
  it("APPROVED with all P0/P1/P2 None and one P3 cosmetic", () => {
    const v = parseReviewerVerdict(FULL_APPROVED);
    expect(v.verdict).toBe("APPROVED");
    expect(v.findings.P0).toEqual([]);
    expect(v.findings.P1).toEqual([]);
    expect(v.findings.P2).toEqual([]);
    expect(v.findings.P3).toEqual(["Cosmetic: rename foo to bar."]);
    expect(isApproved(v)).toBe(true);
  });

  it("REVISE with P0 + P2 findings", () => {
    const v = parseReviewerVerdict(FULL_REVISE);
    expect(v.verdict).toBe("REVISE");
    expect(v.findings.P0).toEqual(["Race condition in foo() during shutdown."]);
    expect(v.findings.P2).toEqual(["Off-by-one in bar() at line 42."]);
    expect(isApproved(v)).toBe(false);
  });

  it("APPROVED is rejected by isApproved if any P0/P1/P2 finding leaks through", () => {
    const v = parseReviewerVerdict(`## Summary
ok

## Findings
### P0
- None.
### P1
- some risk
### P2
- None.
### P3
- None.

## Verdict
VERDICT: APPROVED`);
    expect(v.verdict).toBe("APPROVED");
    expect(isApproved(v)).toBe(false);
  });

  it("malformed (no Findings section) parses with empty findings + UNKNOWN/explicit verdict", () => {
    const v = parseReviewerVerdict("just text\nVERDICT: REVISE");
    expect(v.findings.P0).toEqual([]);
    expect(v.findings.P1).toEqual([]);
    expect(v.findings.P2).toEqual([]);
    expect(v.findings.P3).toEqual([]);
    expect(v.verdict).toBe("REVISE");
  });

  it("no verdict line returns UNKNOWN", () => {
    expect(parseReviewerVerdict("foo\nbar").verdict).toBe("UNKNOWN");
  });

  it("partial sections (only P0 and P3 headers present)", () => {
    const v = parseReviewerVerdict(`## Summary
partial

## Findings
### P0
- a blocker
### P3
- a cosmetic

## Verdict
VERDICT: REVISE`);
    expect(v.findings.P0).toEqual(["a blocker"]);
    expect(v.findings.P1).toEqual([]);
    expect(v.findings.P2).toEqual([]);
    expect(v.findings.P3).toEqual(["a cosmetic"]);
  });

  it("LAST verdict line wins (so summary text mentioning 'VERDICT: REVISE' as a quote doesn't poison)", () => {
    const text = `## Summary
The plan claims "VERDICT: REVISE was the prior outcome".

## Findings
### P0
- None.
### P1
- None.
### P2
- None.
### P3
- None.

## Verdict
VERDICT: APPROVED`;
    expect(extractVerdict(text)).toBe("APPROVED");
    expect(parseReviewerVerdict(text).verdict).toBe("APPROVED");
  });

  it("`- None.` empty marker is canonical (period required)", () => {
    const v = parseReviewerVerdict(`## Findings
### P0
- None.
### P1
- not none, has content
### P2
### P3
- None.
## Verdict
VERDICT: REVISE`);
    expect(v.findings.P0).toEqual([]);
    expect(v.findings.P1).toEqual(["not none, has content"]);
    expect(v.findings.P3).toEqual([]);
  });

  it("real finding co-existing with a stray `- None.` does NOT discard the real finding", () => {
    // Defends against malformed reviewer output that says both "real
    // finding" and "- None." in the same severity block. The real finding
    // must win — otherwise a P0/P1/P2 leaks through as approvable.
    const v = parseReviewerVerdict(`## Summary
mixed
## Findings
### P0
- a real blocker
- None.
### P1
- None.
### P2
- None.
### P3
- None.
## Verdict
VERDICT: APPROVED`);
    expect(v.findings.P0).toEqual(["a real blocker"]);
    expect(isApproved(v)).toBe(false);
  });
});
