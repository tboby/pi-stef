import { describe, expect, it, vi } from "vitest";

import {
  MaxReviewRoundsError,
  ReviewLoopAbortedError,
  type ReviewerPriorContext,
  RevisionUnchangedError,
  runReviewLoop,
} from "../src/review/loop";
import { parseReviewerVerdict } from "../src/review/parse";

function makeReviewer<P = unknown>(verdictTexts: string[]) {
  let i = 0;
  return vi.fn(async (_payload: P, _prior?: ReviewerPriorContext<P>) => {
    const text = verdictTexts[Math.min(i, verdictTexts.length - 1)];
    i += 1;
    return { verdictText: text, verdict: parseReviewerVerdict(text) };
  });
}

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

describe("M5 runReviewLoop terminates on APPROVED", () => {
  it("returns first-round APPROVED without calling revise", async () => {
    const reviewer = makeReviewer([APPROVED_TEXT]);
    const revise = vi.fn();
    const r = await runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 });
    expect(r.roundsUsed).toBe(1);
    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(revise).not.toHaveBeenCalled();
    expect(r.finalPayload).toBe("p1");
  });

  it("loops through revise once then approves", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, APPROVED_TEXT]);
    const revise = vi.fn().mockResolvedValue("p2");
    const r = await runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5 });
    expect(r.roundsUsed).toBe(2);
    expect(reviewer).toHaveBeenCalledTimes(2);
    expect(revise).toHaveBeenCalledTimes(1);
    expect(r.finalPayload).toBe("p2");
  });
});

describe("M5 runReviewLoop revise callback feeds the next payload forward", () => {
  it("the second reviewer call sees the revised payload, not the original", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, APPROVED_TEXT]);
    const revise = vi.fn().mockResolvedValue("revised-payload");
    await runReviewLoop({ initialPayload: "original-payload", reviewer, revise, maxRounds: 5 });
    expect(reviewer.mock.calls[0]?.[0]).toBe("original-payload");
    expect(reviewer.mock.calls[1]?.[0]).toBe("revised-payload");
  });
});

describe("runReviewLoop forwards prior context to the reviewer on round 2+", () => {
  it("round 1 reviewer receives prior=undefined; round 2 receives the prior round's verdict + payload", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, APPROVED_TEXT]);
    const revise = vi.fn().mockResolvedValue("revised");
    await runReviewLoop({ initialPayload: "original", reviewer, revise, maxRounds: 5 });

    // Round 1: prior is undefined (full fresh review).
    expect(reviewer.mock.calls[0]?.[1]).toBeUndefined();
    expect(reviewer.mock.calls[0]?.[0]).toBe("original");

    // Round 2: prior carries (a) the verdict text from round 1, (b)
    // the parsed verdict, (c) the payload round 1 reviewed (the
    // ORIGINAL, before the revision under review now).
    const round2Prior = reviewer.mock.calls[1]?.[1];
    expect(round2Prior).toBeDefined();
    expect(round2Prior!.verdictText).toBe(REVISE_TEXT);
    expect(round2Prior!.findings.verdict).toBe("REVISE");
    expect(round2Prior!.payload).toBe("original");

    // Round 2's CURRENT payload is the revised one — distinct from prior.payload.
    expect(reviewer.mock.calls[1]?.[0]).toBe("revised");
  });

  it("round 3 receives round 2's verdict + payload (NOT round 1's) — prior is always immediately-previous", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, REVISE_TEXT, APPROVED_TEXT]);
    let counter = 0;
    const revise = vi.fn().mockImplementation(async () => `r${++counter}`);
    await runReviewLoop({ initialPayload: "p0", reviewer, revise, maxRounds: 5 });

    expect(reviewer.mock.calls[0]?.[1]).toBeUndefined();

    // Round 2's prior = round 1 (payload "p0").
    expect(reviewer.mock.calls[1]?.[1]?.payload).toBe("p0");

    // Round 3's prior = round 2 (payload "r1" — the first revision).
    const round3Prior = reviewer.mock.calls[2]?.[1];
    expect(round3Prior).toBeDefined();
    expect(round3Prior!.payload).toBe("r1");
    // The CURRENT payload at round 3 is the SECOND revision ("r2").
    expect(reviewer.mock.calls[2]?.[0]).toBe("r2");
  });

  it("RevisionUnchangedError still fires when revise returns the byte-equal payload — prior tracking does NOT break this guard", async () => {
    // Reviewer returns REVISE on round 1; revise returns the same
    // payload; the loop must refuse to advance regardless of the new
    // prior-tracking behavior.
    const reviewer = makeReviewer([REVISE_TEXT]);
    const revise = vi.fn().mockResolvedValue("p1");
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 10 }),
    ).rejects.toBeInstanceOf(RevisionUnchangedError);
    // Reviewer was called exactly once — the loop short-circuited
    // before round 2 (so we never attempted to forward prior).
    expect(reviewer).toHaveBeenCalledTimes(1);
  });
});

describe("M5 runReviewLoop refuses same-payload re-review (RevisionUnchangedError)", () => {
  it("byte-equal revision raises immediately, before max-rounds exhaustion", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, REVISE_TEXT, REVISE_TEXT, APPROVED_TEXT]);
    // Revise returns the same payload — should raise on round 1.
    const revise = vi.fn().mockResolvedValue("p1");
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 10 }),
    ).rejects.toBeInstanceOf(RevisionUnchangedError);
    expect(reviewer).toHaveBeenCalledTimes(1);
  });

  it("byte-equal complex-object revision also raises (JSON.stringify equivalence)", async () => {
    const reviewer = makeReviewer<{ plan: string; v: number }>([REVISE_TEXT, REVISE_TEXT]);
    const orig = { plan: "draft", v: 1 };
    const revise = vi.fn().mockResolvedValue({ plan: "draft", v: 1 });
    await expect(
      runReviewLoop({ initialPayload: orig, reviewer, revise, maxRounds: 5 }),
    ).rejects.toBeInstanceOf(RevisionUnchangedError);
  });
});

describe("M5 runReviewLoop max-rounds escalation", () => {
  it("raises MaxReviewRoundsError when never approves before maxRounds", async () => {
    const reviewer = makeReviewer([REVISE_TEXT, REVISE_TEXT, REVISE_TEXT]);
    let counter = 0;
    const revise = vi.fn().mockImplementation(async () => `p${++counter}`);
    await expect(
      runReviewLoop({ initialPayload: "p0", reviewer, revise, maxRounds: 3 }),
    ).rejects.toBeInstanceOf(MaxReviewRoundsError);
    expect(reviewer).toHaveBeenCalledTimes(3);
    expect(revise).toHaveBeenCalledTimes(2); // not called after the final reviewer
  });
});

describe("M5 runReviewLoop AbortSignal cancellation", () => {
  it("aborting before reviewer resolves raises ReviewLoopAbortedError", async () => {
    const ctrl = new AbortController();
    const reviewer = vi.fn().mockImplementation(async () => {
      // Simulate the reviewer taking time, then check abort upon return.
      await new Promise((r) => setTimeout(r, 50));
      return { verdictText: REVISE_TEXT, verdict: parseReviewerVerdict(REVISE_TEXT) };
    });
    const revise = vi.fn().mockResolvedValue("p2");
    setTimeout(() => ctrl.abort(), 10);
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(ReviewLoopAbortedError);
  });

  it("aborting WHILE reviewer is in flight, even when reviewer ultimately returns APPROVED, raises ReviewLoopAbortedError", async () => {
    const ctrl = new AbortController();
    const reviewer = vi.fn().mockImplementation(async () => {
      // Reviewer runs slow and resolves to APPROVED — but the user aborts mid-flight.
      await new Promise((r) => setTimeout(r, 100));
      return { verdictText: APPROVED_TEXT, verdict: parseReviewerVerdict(APPROVED_TEXT) };
    });
    const revise = vi.fn().mockResolvedValue("p2");
    setTimeout(() => ctrl.abort(), 30);
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(ReviewLoopAbortedError);
  });

  it("aborting WHILE revise is in flight (between rounds) raises ReviewLoopAbortedError", async () => {
    const ctrl = new AbortController();
    const reviewer = makeReviewer([REVISE_TEXT, APPROVED_TEXT]);
    const revise = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return "p2";
    });
    setTimeout(() => ctrl.abort(), 30);
    await expect(
      runReviewLoop({ initialPayload: "p1", reviewer, revise, maxRounds: 5, signal: ctrl.signal }),
    ).rejects.toBeInstanceOf(ReviewLoopAbortedError);
  });
});
