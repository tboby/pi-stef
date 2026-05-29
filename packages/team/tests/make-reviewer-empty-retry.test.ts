import { describe, expect, it, vi } from "vitest";

import type { ReviewerPriorContext } from "../src/review/loop";
import { makeReviewer } from "../src/tools/shared";
import type { TeamMember } from "../src/runtime/types";

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

const member: TeamMember = {
  role: "reviewer",
  model: "test-reviewer",
};

/**
 * `makeReviewer`'s adapter contract: a single outward call (the function it
 * returns) corresponds to ONE result the loop sees per round. If the
 * underlying `spawnText` returns whitespace-only text (the M3 case),
 * `makeReviewer` retries `spawnText` exactly once. Whatever the retry
 * returns — empty or not — is what gets handed back. The wrapper closures
 * in `tools/{implement,plan,followup,task}.ts` therefore record exactly
 * one transcript line per round, and the `round` counter inside those
 * closures advances exactly once.
 */
describe("makeReviewer one-shot retry on empty spawnText output", () => {
  it("does NOT retry when spawnText returns non-empty text — single call", async () => {
    const spawnText = vi.fn().mockResolvedValue(REVISE_TEXT);
    const taskFor = vi.fn(
      (_payload: string, _prior?: ReviewerPriorContext<string>) => "task body",
    );
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    const r = await reviewer("p1", undefined, undefined);
    expect(spawnText).toHaveBeenCalledTimes(1);
    expect(r.verdictText).toBe(REVISE_TEXT);
    expect(r.verdict.verdict).toBe("REVISE");
  });

  it("does NOT retry when spawnText returns malformed-but-non-empty text — UNKNOWN verdict still flows through, parser-not-flake concern", async () => {
    const malformed = "## Findings\n### P0\n- a problem";
    const spawnText = vi.fn().mockResolvedValue(malformed);
    const taskFor = vi.fn(() => "task body");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    const r = await reviewer("p1", undefined, undefined);
    expect(spawnText).toHaveBeenCalledTimes(1);
    expect(r.verdictText).toBe(malformed);
    expect(r.verdict.verdict).toBe("UNKNOWN");
  });

  it("retries spawnText exactly once when first call returns whitespace-only text; returns the retry's parsed verdict", async () => {
    const spawnText = vi
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("   \n\n  \t\n")
      .mockResolvedValueOnce(APPROVED_TEXT);
    const taskFor = vi.fn(() => "task body");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    const r = await reviewer("p1", undefined, undefined);
    expect(spawnText).toHaveBeenCalledTimes(2);
    expect(r.verdictText).toBe(APPROVED_TEXT);
    expect(r.verdict.verdict).toBe("APPROVED");
  });

  it("retries spawnText exactly once when first call returns empty string", async () => {
    const spawnText = vi
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(REVISE_TEXT);
    const taskFor = vi.fn(() => "task body");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    const r = await reviewer("p1", undefined, undefined);
    expect(spawnText).toHaveBeenCalledTimes(2);
    expect(r.verdictText).toBe(REVISE_TEXT);
  });

  it("returns the empty result (does NOT throw) when both calls are empty — emptiness handling is the loop's job", async () => {
    const spawnText = vi
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
    const taskFor = vi.fn(() => "task body");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    const r = await reviewer("p1", undefined, undefined);
    // Adapter returns empty result; runReviewLoop will throw
    // ReviewerEmptyVerdictError when it sees this.
    expect(spawnText).toHaveBeenCalledTimes(2);
    expect(r.verdictText).toBe("");
    expect(r.verdict.verdict).toBe("UNKNOWN");
  });

  it("retry uses the same task body — taskFor is invoked once, not re-evaluated for the retry", async () => {
    // The task body is composed once per loop round (it embeds the prior
    // verdict text + payload for round 2+); a retry is a SUBPROCESS retry,
    // not a fresh prompt round, so taskFor must NOT be called twice.
    const spawnText = vi
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(APPROVED_TEXT);
    const taskFor = vi.fn(() => "task body once");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    await reviewer("p1", undefined, undefined);
    expect(taskFor).toHaveBeenCalledTimes(1);
    expect(spawnText).toHaveBeenCalledTimes(2);
    // The two spawnText calls should have been made with the SAME task body
    // — the retry uses the original prompt verbatim.
    const firstTask = (spawnText.mock.calls[0]?.[1] as { task: string } | undefined)?.task;
    const secondTask = (spawnText.mock.calls[1]?.[1] as { task: string } | undefined)?.task;
    expect(firstTask).toBe(secondTask);
  });

  it("forwards the AbortSignal to both the first call and the retry", async () => {
    const ac = new AbortController();
    const spawnText = vi
      .fn<(...a: unknown[]) => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(APPROVED_TEXT);
    const taskFor = vi.fn(() => "task body");
    const reviewer = makeReviewer(spawnText, member, taskFor, "err");
    await reviewer("p1", undefined, ac.signal);
    const firstSignal = (spawnText.mock.calls[0]?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    const secondSignal = (spawnText.mock.calls[1]?.[1] as { signal?: AbortSignal } | undefined)?.signal;
    expect(firstSignal).toBe(ac.signal);
    expect(secondSignal).toBe(ac.signal);
  });
});
