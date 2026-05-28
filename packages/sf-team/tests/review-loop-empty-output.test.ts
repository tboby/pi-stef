import { describe, expect, it, vi } from "vitest";

import {
  ReviewerEmptyVerdictError,
  type ReviewerPriorContext,
  RevisionUnchangedError,
  isEmptyReviewerOutput,
  runReviewLoop,
} from "../src/review/loop";
import { parseReviewerVerdict } from "../src/review/parse";

const REVISE_TEXT = `## Summary
fix
## Findings
### P0
- something blocks
### P1
- None.
### P2
- None.
### P3
- None.
## Verdict
VERDICT: REVISE`;

const APPROVED_TEXT = `## Summary
ok
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

function reviewerYielding<P>(verdictTexts: string[]) {
  let i = 0;
  return vi.fn(async (_payload: P, _prior?: ReviewerPriorContext<P>) => {
    const text = verdictTexts[Math.min(i, verdictTexts.length - 1)];
    i += 1;
    return { verdictText: text, verdict: parseReviewerVerdict(text) };
  });
}

describe("isEmptyReviewerOutput helper", () => {
  it("returns true for empty string and whitespace-only text", () => {
    expect(isEmptyReviewerOutput("")).toBe(true);
    expect(isEmptyReviewerOutput("   ")).toBe(true);
    expect(isEmptyReviewerOutput("\n\n\t  \n")).toBe(true);
  });

  it("returns false for any non-whitespace text — including malformed-but-non-empty bodies", () => {
    expect(isEmptyReviewerOutput("hello")).toBe(false);
    // Reviewer that emits a malformed body but is clearly non-empty: that's
    // a parser concern (UNKNOWN verdict); the loop's empty-output guard MUST
    // NOT swallow it.
    expect(isEmptyReviewerOutput("## Findings\n### P0\n- whatever")).toBe(false);
  });
});

describe("runReviewLoop throws ReviewerEmptyVerdictError on empty reviewer output", () => {
  it("round 1: empty verdictText raises ReviewerEmptyVerdictError; revise is NEVER called", async () => {
    const reviewer = reviewerYielding([""]);
    const revise = vi.fn().mockResolvedValue("never-used");
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 }),
    ).rejects.toBeInstanceOf(ReviewerEmptyVerdictError);
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(revise).not.toHaveBeenCalled();
  });

  it("round 1: error carries round=1, lastPayload, and undefined priorVerdictText (no prior round to cite)", async () => {
    const reviewer = reviewerYielding(["   \n  \t  \n"]);
    const revise = vi.fn();
    let captured: ReviewerEmptyVerdictError | undefined;
    try {
      await runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 });
    } catch (err) {
      if (err instanceof ReviewerEmptyVerdictError) captured = err;
      else throw err;
    }
    expect(captured).toBeInstanceOf(ReviewerEmptyVerdictError);
    expect(captured!.round).toBe(1);
    expect(captured!.lastPayload).toBe("p1");
    expect(captured!.priorVerdictText).toBeUndefined();
  });

  it("round 2 (the M3 case): empty reviewer output AFTER a successful REVISE round throws ReviewerEmptyVerdictError; revise is NOT called for round 2 → safeguard never fires", async () => {
    const reviewer = reviewerYielding([REVISE_TEXT, ""]);
    const revise = vi.fn().mockResolvedValue("p2-revised");
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 }),
    ).rejects.toBeInstanceOf(ReviewerEmptyVerdictError);
    // Round 1 reviewer + round 1 revise + round 2 reviewer = 2 reviewer + 1 revise
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });

  it("round 2: error carries round=2, lastPayload (the revised one), and priorVerdictText from round 1", async () => {
    const reviewer = reviewerYielding([REVISE_TEXT, ""]);
    const revise = vi.fn().mockResolvedValue("p2-revised");
    let captured: ReviewerEmptyVerdictError | undefined;
    try {
      await runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 });
    } catch (err) {
      if (err instanceof ReviewerEmptyVerdictError) captured = err;
      else throw err;
    }
    expect(captured).toBeInstanceOf(ReviewerEmptyVerdictError);
    expect(captured!.round).toBe(2);
    expect(captured!.lastPayload).toBe("p2-revised");
    expect(captured!.priorVerdictText).toBe(REVISE_TEXT);
  });

  it("regression: RevisionUnchangedError still fires when reviewer returns valid REVISE and revise produces byte-equal payload — empty-output path is orthogonal", async () => {
    const reviewer = reviewerYielding([REVISE_TEXT]);
    const revise = vi.fn().mockResolvedValue("p1");
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 }),
    ).rejects.toBeInstanceOf(RevisionUnchangedError);
    expect(reviewer).toHaveBeenCalledTimes(1);
  });

  it("non-empty malformed verdict (UNKNOWN but with body) is NOT treated as empty — falls through to revise as before", async () => {
    // Reviewer emits a body but no verdict line. parseReviewerVerdict tags
    // it UNKNOWN. The loop must NOT throw ReviewerEmptyVerdictError — that
    // path is reserved for whitespace-only output. Here the loop should
    // call revise normally; we then return APPROVED so the loop terminates
    // cleanly without a RevisionUnchangedError.
    const malformed = "## Findings\n### P0\n- a problem";
    const reviewer = reviewerYielding([malformed, APPROVED_TEXT]);
    const revise = vi.fn().mockResolvedValue("p2");
    const r = await runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 });
    expect(r.roundsUsed).toBe(2);
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
  });
});
