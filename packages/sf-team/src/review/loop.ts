import { isApproved, type ReviewerVerdict } from "./parse";

/**
 * Reviewer-driven review loop.
 *
 * The driver alternates a `reviewer(payload)` call and a `revise(findings,
 * prevPayload, signal?)` call. The `revise` callback is MANDATORY (locked
 * plan decision: M5 S-504/S-505) — it produces the next payload from the
 * current findings. If `revise` returns a payload byte-equal to the prior one,
 * the loop refuses to advance and raises {@link RevisionUnchangedError} so the
 * orchestrator can surface a friendly error instead of burning rounds.
 *
 * Termination conditions:
 *   - reviewer returns APPROVED with no P0/P1/P2 findings -> resolved
 *   - max rounds reached without approval -> {@link MaxReviewRoundsError}
 *   - signal aborted -> {@link ReviewLoopAbortedError}
 *   - revise returns same payload -> {@link RevisionUnchangedError}
 *   - reviewer returns whitespace-only output (after the adapter's one-shot
 *     retry) -> {@link ReviewerEmptyVerdictError}
 */

/**
 * Context the loop hands to the reviewer for round 2+.
 *
 * On round 1 the reviewer receives `prior=undefined` and runs a full
 * fresh review (the original behavior). From round 2 onward the loop
 * forwards the immediately-previous round's verdict + payload so the
 * reviewer can SCOPE its work to "did the planner/developer actually
 * fix what we flagged last round, and did the revision introduce any
 * new regressions?" instead of producing a fresh fault list against
 * the whole payload — which is what made the loop run for hours
 * without converging in practice.
 */
export interface ReviewerPriorContext<P> {
  /** Parsed verdict from the previous round (the one being addressed). */
  findings: ReviewerVerdict;
  /** Raw verdict text from the previous round, including the `## Findings` block. */
  verdictText: string;
  /** Payload reviewed by the previous round, BEFORE the revision under review now. */
  payload: P;
}

export type ReviewerFn<P> = (
  payload: P,
  prior: ReviewerPriorContext<P> | undefined,
  signal?: AbortSignal,
) => Promise<{ verdictText: string; verdict: ReviewerVerdict }>;
export type ReviseFn<P> = (findings: ReviewerVerdict, prevPayload: P, signal?: AbortSignal) => Promise<P>;

export interface RunReviewLoopOptions<P> {
  initialPayload: P;
  reviewer: ReviewerFn<P>;
  revise: ReviseFn<P>;
  maxRounds: number;
  signal?: AbortSignal;
}

export interface ReviewLoopResult<P> {
  approved: ReviewerVerdict;
  finalPayload: P;
  roundsUsed: number;
  history: { round: number; verdictText: string; verdict: ReviewerVerdict }[];
}

export class MaxReviewRoundsError<P = unknown> extends Error {
  readonly lastVerdict: ReviewerVerdict;
  /** Raw reviewer text from the final round (the body the reviewer agent emitted, including `## Verdict` line). */
  readonly lastVerdictText: string;
  readonly lastPayload: P;
  readonly history: { round: number; verdict: ReviewerVerdict }[];
  constructor(
    message: string,
    detail: {
      lastVerdict: ReviewerVerdict;
      lastVerdictText: string;
      lastPayload: P;
      history: { round: number; verdict: ReviewerVerdict }[];
    },
  ) {
    super(message);
    this.name = "MaxReviewRoundsError";
    this.lastVerdict = detail.lastVerdict;
    this.lastVerdictText = detail.lastVerdictText;
    this.lastPayload = detail.lastPayload;
    this.history = detail.history;
  }
}

/**
 * Raised by {@link runReviewLoop} when the reviewer returns whitespace-only
 * output for a round, even after the adapter (`makeReviewer`) retried once.
 *
 * Without this error, an empty reviewer output is parsed as
 * `{ verdict: "UNKNOWN", findings: empty, summary: "" }`. Because `isApproved`
 * returns false for UNKNOWN, the loop would call `revise` with no actionable
 * findings, the planner/developer would reproduce the previous output
 * verbatim, and {@link RevisionUnchangedError} would fire — masking the
 * true upstream failure (reviewer subprocess flaked / timed out / produced
 * no assistant text) under a confusing byte-equal-payload message.
 *
 * Carries the round number (1-indexed), the payload that was being
 * reviewed, and — on round 2+ — the prior round's raw verdict text so the
 * orchestrator can persist artifacts and report a useful error.
 */
export class ReviewerEmptyVerdictError<P = unknown> extends Error {
  readonly round: number;
  readonly lastPayload: P;
  /** Raw verdict text from the round BEFORE the empty round; undefined on round 1. */
  readonly priorVerdictText: string | undefined;
  constructor(round: number, detail: { lastPayload: P; priorVerdictText: string | undefined }) {
    super(
      `runReviewLoop: reviewer returned empty output on round ${round} (after one retry). ` +
        "Treating as a reviewer subprocess failure rather than a REVISE signal; refusing to advance.",
    );
    this.name = "ReviewerEmptyVerdictError";
    this.round = round;
    this.lastPayload = detail.lastPayload;
    this.priorVerdictText = detail.priorVerdictText;
  }
}

/**
 * Returns true when reviewer-emitted text is whitespace-only — the precise
 * failure mode in the M3 case where the subprocess completed but emitted
 * no assistant text. Note: a malformed-but-non-empty body (UNKNOWN verdict
 * but real characters present) is NOT treated as empty — that's a parser
 * concern, not a subprocess flake, and falls through to the normal
 * REVISE/UNKNOWN path.
 */
export function isEmptyReviewerOutput(text: string): boolean {
  return text.trim().length === 0;
}

export class RevisionUnchangedError<P = unknown> extends Error {
  readonly round: number;
  /** The last (and only) payload the planner produced before reverting. */
  readonly lastPayload: P;
  /** Raw reviewer verdict text from the round that was about to advance. */
  readonly lastVerdictText: string;
  /** Parsed reviewer verdict from the round that was about to advance. */
  readonly lastVerdict: ReviewerVerdict;
  constructor(
    round: number,
    detail: { lastPayload: P; lastVerdictText: string; lastVerdict: ReviewerVerdict },
  ) {
    super(
      `runReviewLoop: revise callback returned a payload byte-equal to the previous round (round ${round}). ` +
        "This would re-review the same content until max-rounds; refusing to advance.",
    );
    this.name = "RevisionUnchangedError";
    this.round = round;
    this.lastPayload = detail.lastPayload;
    this.lastVerdictText = detail.lastVerdictText;
    this.lastVerdict = detail.lastVerdict;
  }
}

export class ReviewLoopAbortedError extends Error {
  constructor() {
    super("runReviewLoop: aborted via AbortSignal");
    this.name = "ReviewLoopAbortedError";
  }
}

export async function runReviewLoop<P>(opts: RunReviewLoopOptions<P>): Promise<ReviewLoopResult<P>> {
  if (opts.maxRounds < 1) throw new Error("runReviewLoop: maxRounds must be >= 1");
  const history: { round: number; verdictText: string; verdict: ReviewerVerdict }[] = [];

  let payload: P = opts.initialPayload;
  let lastSerialized = serializeForCompare(payload);
  // Prior context handed to the reviewer on round 2+. Undefined on
  // round 1 (full fresh review). Populated AFTER each non-approving
  // reviewer call so the next iteration's reviewer sees what was
  // flagged + the payload the revision was based on.
  let prior: ReviewerPriorContext<P> | undefined;

  for (let round = 1; round <= opts.maxRounds; round += 1) {
    if (opts.signal?.aborted) throw new ReviewLoopAbortedError();
    const review = await opts.reviewer(payload, prior, opts.signal);
    // Re-check abort AFTER the reviewer await: even if the reviewer returned
    // APPROVED, an abort that fired during the call must surface.
    if (opts.signal?.aborted) throw new ReviewLoopAbortedError();
    // Empty reviewer output is a subprocess failure, not a REVISE signal.
    // The adapter (`makeReviewer`) has already retried once; if we're still
    // empty, abort the loop with a specific error rather than feeding the
    // empty findings into `revise` (which would reproduce the prior payload
    // and cascade into RevisionUnchangedError — the misleading symptom in
    // the M3 case).
    if (isEmptyReviewerOutput(review.verdictText)) {
      throw new ReviewerEmptyVerdictError(round, {
        lastPayload: payload,
        priorVerdictText: prior?.verdictText,
      });
    }
    history.push({ round, verdictText: review.verdictText, verdict: review.verdict });

    if (isApproved(review.verdict)) {
      return { approved: review.verdict, finalPayload: payload, roundsUsed: round, history };
    }

    if (round === opts.maxRounds) {
      throw new MaxReviewRoundsError(
        `runReviewLoop: max ${opts.maxRounds} rounds reached without approval`,
        {
          lastVerdict: review.verdict,
          lastVerdictText: review.verdictText,
          lastPayload: payload,
          history: history.map(({ round: r, verdict }) => ({ round: r, verdict })),
        },
      );
    }

    if (opts.signal?.aborted) throw new ReviewLoopAbortedError();
    const next = await opts.revise(review.verdict, payload, opts.signal);
    // Re-check abort AFTER revise as well.
    if (opts.signal?.aborted) throw new ReviewLoopAbortedError();
    const nextSerialized = serializeForCompare(next);
    if (nextSerialized === lastSerialized) {
      throw new RevisionUnchangedError(round, {
        lastPayload: payload,
        lastVerdictText: review.verdictText,
        lastVerdict: review.verdict,
      });
    }
    // Capture the just-reviewed payload + verdict as `prior` BEFORE we
    // advance — the next round's reviewer needs to know what it had
    // flagged and what the revision was supposed to address.
    prior = { findings: review.verdict, verdictText: review.verdictText, payload };
    payload = next;
    lastSerialized = nextSerialized;
  }
  // Should be unreachable — the for-loop always either returns or throws.
  throw new MaxReviewRoundsError("runReviewLoop: exhausted rounds", {
    lastVerdict: history[history.length - 1]?.verdict ?? { summary: "", findings: { P0: [], P1: [], P2: [], P3: [] }, verdict: "UNKNOWN" },
    lastVerdictText: history[history.length - 1]?.verdictText ?? "",
    lastPayload: payload,
    history: history.map(({ round, verdict }) => ({ round, verdict })),
  });
}

function serializeForCompare<P>(payload: P): string {
  if (typeof payload === "string") return payload;
  if (payload instanceof Uint8Array) return Buffer.from(payload).toString("base64");
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
