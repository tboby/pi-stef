import { describe, expect, it, vi } from "vitest";

import { startHeartbeat } from "../src/runtime/watchdog";
import { applyAgentEvent } from "../src/tui/wiring";
import { emptyState, upsertAgent } from "../src/tui/state";

/**
 * The watchdog historically killed the spawned child the instant stdout
 * went silent for `thresholdMs`. That signal is wrong for pi-coding-agent:
 * during a long inference call, Anthropic's SSE pings hit pi's TCP socket
 * but are filtered out by pi's HTTP layer and never reach pi's stdout, so
 * a perfectly-healthy pi appears "silent" to the watchdog and gets killed
 * mid-thought. The fix is multi-signal: at threshold expiry, run a
 * positive process-aliveness probe; only escalate to `onStall` when the
 * probe says the process is gone, OR when an absolute hard timeout has
 * elapsed (true-hang safety net). When the probe says alive, fire `onWarn`
 * for diagnostics and keep watching.
 *
 * These tests exercise the new branching contract on `startHeartbeat`.
 * They use small ms values so the suite stays fast.
 */
describe("startHeartbeat: multi-signal liveness", () => {
  it("(1) when livenessProbe returns true at threshold, onStall does NOT fire; onWarn fires once with the byte-silence duration", async () => {
    const onStall = vi.fn();
    const onWarn = vi.fn();
    const probe = vi.fn(() => true);
    const hb = startHeartbeat(100, onStall, {
      livenessProbe: probe,
      absoluteTimeoutMs: 10_000,
      onWarn,
    });
    // Wait long enough for a SINGLE threshold expiry — the sampler runs at
    // half the threshold (50ms) so a single warn should land between
    // 100ms and 200ms.
    await new Promise((r) => setTimeout(r, 180));
    hb.stop();
    expect(onStall).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalledTimes(1);
    const [silenceMs] = onWarn.mock.calls[0]!;
    expect(silenceMs).toBeGreaterThanOrEqual(100);
    // Probe was invoked once, AT the threshold (not on every sample tick).
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("(2) when livenessProbe returns false at threshold, onStall fires (existing behavior preserved)", async () => {
    const onStall = vi.fn();
    const onWarn = vi.fn();
    const probe = vi.fn(() => false);
    const hb = startHeartbeat(100, onStall, {
      livenessProbe: probe,
      absoluteTimeoutMs: 10_000,
      onWarn,
    });
    await new Promise((r) => setTimeout(r, 180));
    hb.stop();
    expect(onStall).toHaveBeenCalledTimes(1);
    expect(onWarn).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("(3) when probe stays true past absoluteTimeoutMs, onStall fires regardless — safety-net path for a true user-code hang", async () => {
    const onStall = vi.fn();
    const onWarn = vi.fn();
    const probe = vi.fn(() => true);
    // Threshold 80ms, absolute 240ms. We expect:
    //   ~80ms: warn #1 (probe alive, no kill)
    //   ~160ms: warn #2 (probe alive, no kill)
    //   ~240ms: absolute timeout exceeded → onStall fires
    const hb = startHeartbeat(80, onStall, {
      livenessProbe: probe,
      absoluteTimeoutMs: 240,
      onWarn,
    });
    await new Promise((r) => setTimeout(r, 400));
    hb.stop();
    expect(onStall).toHaveBeenCalledTimes(1);
    // At least one warn fired BEFORE the stall; probe was still returning true.
    expect(onWarn.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("(4) with no livenessProbe configured, behaves identically to today (back-compat: same 1_000ms sample floor)", async () => {
    // The no-probe path preserves byte-for-byte production behavior:
    // sample floor = 1_000ms, so a 200ms threshold's first sample fires
    // at t≈1000ms with since=1000 ≥ 200 → onStall.
    //
    // We assert TWICE: at 700ms (well before the 1_000ms floor would
    // sample) and at 1_300ms (after the floor has had a chance to fire).
    // A broken implementation with a smaller floor (50ms) would fire
    // before 700ms and fail the early assertion — the prior version of
    // this test only checked the late assertion and would have passed
    // either implementation.
    const onStall = vi.fn();
    const hb = startHeartbeat(200, onStall);
    await new Promise((r) => setTimeout(r, 700));
    expect(onStall).not.toHaveBeenCalled(); // floor enforced — no early fire
    await new Promise((r) => setTimeout(r, 600));
    hb.stop();
    expect(onStall).toHaveBeenCalledTimes(1);
    const [lastBeat] = onStall.mock.calls[0]!;
    expect(typeof lastBeat).toBe("number");
  }, 5_000);

  it("(5) livenessProbe is invoked AT threshold expiry only, not on every sample tick", async () => {
    const probe = vi.fn(() => true);
    const onWarn = vi.fn();
    const hb = startHeartbeat(100, vi.fn(), {
      livenessProbe: probe,
      absoluteTimeoutMs: 10_000,
      onWarn,
    });
    // The sampler runs at ~50ms. Over 230ms we expect ~4-5 sample ticks
    // but only ~2 threshold expiries. Probe must be called at most once
    // per threshold expiry — so AT MOST 3 times.
    await new Promise((r) => setTimeout(r, 230));
    hb.stop();
    expect(probe.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("(6) subsequent silence after a warn fires a NEW warn after another threshold has elapsed", async () => {
    const probe = vi.fn(() => true);
    const onWarn = vi.fn();
    const onStall = vi.fn();
    const hb = startHeartbeat(80, onStall, {
      livenessProbe: probe,
      absoluteTimeoutMs: 10_000,
      onWarn,
    });
    // Over 250ms with threshold 80ms, we expect onWarn to fire 2-3 times.
    // (Not one-shot.)
    await new Promise((r) => setTimeout(r, 250));
    hb.stop();
    expect(onStall).not.toHaveBeenCalled();
    expect(onWarn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("(9) wiring: applyAgentEvent treats `stall-warning` as a no-op (state preserved unchanged)", () => {
    // Regression: the new AgentEvent variant must not fall through to a
    // missing default branch in `applyAgentEvent` (which would return
    // undefined and corrupt widgetState). The wiring intentionally does
    // NOT surface stall-warning to the user — it's diagnostic-only.
    const initial = upsertAgent(emptyState(), {
      id: "developer",
      role: "developer",
      model: "test-model",
      state: "running",
      startedAtMs: 1_000_000,
    });
    const after = applyAgentEvent(initial, "developer", {
      kind: "stall-warning",
      silenceMs: 30_000,
      lastEventAtMs: 999_970,
    });
    // Reference equality is enforceable (the case returns `state` directly,
    // no copy). If a future refactor copies state, this would loosen to a
    // structural equality, but identity is the strongest signal.
    expect(after).toBe(initial);
  });

  it("beat() resets the silence counter; a beat between threshold ticks suppresses the next warn", async () => {
    const probe = vi.fn(() => true);
    const onWarn = vi.fn();
    const onStall = vi.fn();
    const hb = startHeartbeat(120, onStall, {
      livenessProbe: probe,
      absoluteTimeoutMs: 10_000,
      onWarn,
    });
    // Beat every 60ms for 360ms — never let silence reach the 120ms threshold.
    for (let i = 0; i < 6; i += 1) {
      await new Promise((r) => setTimeout(r, 60));
      hb.beat();
    }
    hb.stop();
    expect(onStall).not.toHaveBeenCalled();
    expect(onWarn).not.toHaveBeenCalled();
  });
});
