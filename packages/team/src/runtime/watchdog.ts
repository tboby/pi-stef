/**
 * Heartbeat-based stall detector. Used by `spawnAgent` to flip an `AgentRun`
 * to `stalled` when no protocol event has been observed for `thresholdMs`.
 *
 * The watchdog is purely passive — it does not kill anything. The spawner
 * decides whether to kill on stall (typically yes, with SIGTERM → 2s →
 * SIGKILL handled by `killTree`).
 *
 * ## Multi-signal liveness
 *
 * In the original single-signal design, byte silence on stdout was treated
 * as authoritative evidence that pi was hung. That signal is wrong: pi is a
 * Node process whose work happens inside the HTTP/SSE layer of the
 * Anthropic SDK. During a long inference call, Anthropic streams ping
 * events every ~25 seconds, but those bytes are consumed by Node's HTTP
 * module and pi's SSE parser without ever reaching pi's stdout. So a
 * perfectly-healthy pi looks "silent" to a stdout-only watchdog.
 *
 * The new design is multi-signal:
 *   - When stdout has been silent for `thresholdMs`, run an optional
 *     `livenessProbe`. If it returns true (the child process is still
 *     alive), fire `onWarn(silenceMs)` for diagnostics and KEEP WATCHING.
 *     The threshold-expiry is reset, so another `thresholdMs` of silence
 *     fires another warn — silence is observable, not fatal.
 *   - When the probe returns false (process is gone), call `onStall`.
 *   - Independent of the probe, when total silence exceeds
 *     `absoluteTimeoutMs`, call `onStall` regardless. This is the
 *     safety net for true user-code hangs (e.g. a deadlock on a Promise
 *     that never resolves) — the probe would still report alive.
 *   - When no `livenessProbe` is configured, behavior is byte-for-byte
 *     identical to the single-signal era (back-compat for tests).
 */
export interface Heartbeat {
  /** Stamp a fresh activity time. Reset by every observed event. */
  beat(): void;
  /** Stop the watchdog. Idempotent. */
  stop(): void;
}

export interface StartHeartbeatOptions {
  /**
   * Liveness probe invoked at threshold expiry. Return true if the spawned
   * subprocess is still alive (`process.kill(pid, 0)` is the canonical
   * implementation in `spawn.ts`). When true, `onStall` is suppressed and
   * `onWarn` is called instead.
   *
   * When omitted, the watchdog reverts to the single-signal behavior:
   * threshold expiry → `onStall`.
   */
  livenessProbe?: () => boolean;
  /**
   * Absolute upper bound on total silence, regardless of the probe. When
   * `Date.now() - lastBeat >= absoluteTimeoutMs`, `onStall` fires even if
   * the probe is still returning true. Provides a safety net for hangs
   * that the probe cannot detect (e.g. deadlocked user code).
   *
   * Required when `livenessProbe` is provided. Ignored otherwise.
   */
  absoluteTimeoutMs?: number;
  /**
   * Diagnostic callback fired each time the byte-silence threshold is
   * exceeded with the probe still reporting alive. The argument is the
   * elapsed-since-last-beat duration in ms (≥ thresholdMs). Spawn records
   * a `stall-warning` event with this value so users can see "pi went
   * silent at 18:59 but was still alive; resumed at 19:01".
   */
  onWarn?: (silenceMs: number) => void;
}

export function startHeartbeat(
  thresholdMs: number,
  onStall: (lastEventAtMs: number) => void,
  opts: StartHeartbeatOptions = {},
): Heartbeat {
  const { livenessProbe, absoluteTimeoutMs, onWarn } = opts;
  let lastBeat = Date.now();
  /**
   * Threshold-expiry counter, separate from `lastBeat`. After a warn fires,
   * we reset this so the NEXT warn requires another full `thresholdMs` of
   * silence — keeps the warn rate proportional to silence duration. Crucially
   * we do NOT reset `lastBeat` itself, so `absoluteTimeoutMs` continues to
   * count from the last real activity.
   */
  let nextWarnEligibleAt = lastBeat + thresholdMs;
  let stopped = false;
  // We sample at half the threshold so worst-case fire latency is +50%.
  //
  // The floor is split by mode:
  //   - With a `livenessProbe` (the new multi-signal path, which is what
  //     production always uses), floor is 50ms so tests with sub-second
  //     thresholds run reliably. Probe-mode is unconditionally bound by
  //     `absoluteTimeoutMs`, so tighter sampling is safe.
  //   - Without a probe (legacy single-signal path, used by older tests),
  //     keep the original 1_000ms floor so behavior is byte-for-byte
  //     identical to the pre-multi-signal era.
  const sampleFloorMs = livenessProbe ? 50 : 1_000;
  const sampleMs = Math.max(sampleFloorMs, Math.floor(thresholdMs / 2));
  const interval = setInterval(() => {
    if (stopped) return;
    const now = Date.now();
    const since = now - lastBeat;
    if (since < thresholdMs) return;

    // Absolute-timeout safety net: takes precedence over the probe so a
    // deadlocked-but-alive process is still killed eventually.
    if (livenessProbe && absoluteTimeoutMs !== undefined && since >= absoluteTimeoutMs) {
      stopped = true;
      clearInterval(interval);
      onStall(lastBeat);
      return;
    }

    // Probe-veto path: at threshold expiry, ask the probe whether the
    // child is still alive. If alive, suppress onStall, fire onWarn, and
    // arm the next warn for another threshold of silence.
    if (livenessProbe && now >= nextWarnEligibleAt) {
      const alive = livenessProbe();
      if (alive) {
        onWarn?.(since);
        nextWarnEligibleAt = now + thresholdMs;
        return;
      }
      // Probe says the process is gone — escalate.
      stopped = true;
      clearInterval(interval);
      onStall(lastBeat);
      return;
    }

    // No-probe path (back-compat): threshold expiry alone triggers stall.
    if (!livenessProbe) {
      stopped = true;
      clearInterval(interval);
      onStall(lastBeat);
    }
  }, sampleMs);
  // Don't keep the event loop alive solely for the watchdog.
  if (typeof interval.unref === "function") interval.unref();
  return {
    beat(): void {
      const now = Date.now();
      lastBeat = now;
      nextWarnEligibleAt = now + thresholdMs;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
  };
}
