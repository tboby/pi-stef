import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { scanForSecrets, SecretsInPayloadError } from "../review/secret-scan";
import { buildPiArgv, type BuildArgvOptions } from "./argv";
import { resolveSkillPath } from "./resolve-skill";
import { classifyRawEvent, type RawEventClassification } from "./events";
import { extractFinalAssistantText, parseLineDelimitedJson } from "./json-stream";
import type { AgentContextUsage, AgentEvent, AgentEventSummary, AgentRun, AgentRunMetrics, AgentTask, AgentTokenUsage, TeamMember, ToolCallObservation, ToolExecutionTiming } from "./types";
import { startHeartbeat } from "./watchdog";

/**
 * Default heartbeat threshold. Raised from 60s -> 300s so a reviewer that's
 * doing a long reasoning pass (thinking="xhigh" can easily run 2-5 minutes
 * silent) is not killed mid-thought. Callers can override via
 * `AgentTask.heartbeatMs` or the `agents.<role>.heartbeatMs` config knob.
 */
const DEFAULT_HEARTBEAT_MS = 300_000;
/**
 * Hard upper bound on total stdout silence per spawned agent — independent
 * of the per-event heartbeat threshold. The watchdog's process-liveness
 * probe lets a healthy-but-quiet pi keep running past `heartbeatMs`, but
 * a truly hung pi (e.g. deadlocked in user code; the kill -0 probe still
 * reports alive in that case) needs an unconditional safety net. 30 min
 * matches the ceiling on a single Anthropic streaming inference call in
 * practice, with comfortable headroom.
 *
 * Override via `SpawnOptions.absoluteTimeoutMs` for tests / non-production
 * harnesses. NOT plumbed through `AgentTask` or `TeamMember` — we want
 * this to be a stable architectural cap, not a per-call knob.
 */
const DEFAULT_ABSOLUTE_TIMEOUT_MS = 1_800_000;
const SIGTERM_GRACE_MS = 2_000;
const FIRST_RETAINED_EVENT_COUNT = 50;
const LAST_RETAINED_EVENT_COUNT = 450;

export interface SpawnOptions extends BuildArgvOptions {
  /** Override pi binary (test fixtures point to a script). */
  piBinary?: string;
  /** Override heartbeat threshold. Default DEFAULT_HEARTBEAT_MS (300s). */
  heartbeatMs?: number;
  /**
   * Hard absolute timeout for total stdout silence; takes precedence over
   * the process-liveness probe. Default DEFAULT_ABSOLUTE_TIMEOUT_MS (30 min).
   * See {@link DEFAULT_ABSOLUTE_TIMEOUT_MS} for the rationale; tests use
   * small values to exercise the safety-net path without waiting 30 min.
   */
  absoluteTimeoutMs?: number;
  /**
   * Override / extend env passed to the child. Defaults to process.env.
   * Note: there is intentionally NO `scanner` override here. The centralized
   * secret scan in {@link spawnAgent} cannot be bypassed by callers — locked
   * plan decision #21. Test-only injection lives in the non-public
   * {@link _spawnAgentForTests} entry below.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Optional listener invoked on every captured AgentEvent (stdout-json,
   * stderr, tool_call, lifecycle). Used by the orchestrator to drive the TUI
   * widget; never used by spawnAgent's own decisions. Errors thrown by the
   * listener are swallowed so a buggy UI hook can't break the spawn.
   */
  onEvent?: (event: AgentEvent) => void;
  /**
   * When set, the spawned child's RAW stdout AND stderr are mirrored to
   * a `fs.createWriteStream(rawLogPath, { flags: "a" })` in addition to
   * the existing JSON-parse + heartbeat pipelines (which still consume
   * the same chunks via their own data listeners).
   *
   * Implementation MUST use explicit `data` event handlers — NOT
   * `stream.pipe` with default options — to avoid the write-after-end
   * race where whichever source ends first closes the destination and
   * crashes writes from the other source. The file is closed exactly
   * once, when BOTH stdout and stderr have ended.
   */
  rawLogPath?: string;
  /**
   * Lifecycle hook fired immediately after the child process is forked. The
   * steering control plane uses this to publish the PID while the agent is
   * still running, instead of waiting for the final AgentRun record.
   */
  onSpawn?: (info: { pid: number | undefined; startedAtMs: number }) => void;
}

/** Test-only override for the secret scanner. Not exported from the package index. */
export type SecretScanner = (payload: string) => { hits: { kind: string; preview: string; offset: number }[] };

/**
 * Spawn a single role-agent and wait for completion.
 *
 * Locked invariants enforced here:
 *   - Per-payload secret scan runs before exec on EVERY role spawn (planner,
 *     developer, reviewer). Refusal raises `SecretsInPayloadError`. The scan
 *     covers both `task.task` and `task.appendSystemPrompt`.
 *   - Reviewer argv profile (immutable in argv.ts) is what role="reviewer"
 *     uses; no caller can override.
 *   - Child runs in its own process group (`detached: true`) so `killTree`
 *     can SIGTERM the entire subtree on abort/stall.
 *   - Heartbeat watchdog flips state to `stalled` and triggers `killTree`.
 *   - AbortSignal triggers `killTree` immediately.
 */
export async function spawnAgent(member: TeamMember, task: AgentTask, opts: SpawnOptions = {}): Promise<AgentRun> {
  return _spawnAgentInternal(member, task, opts, scanForSecrets);
}

/**
 * Test-only entry that allows injecting a stub scanner. Not exported from the
 * package's public surface (see `src/index.ts` if/when one is added). Tests
 * import this directly from `src/runtime/spawn` to verify the gate behavior
 * without the production regex pack.
 */
export async function _spawnAgentForTests(
  member: TeamMember,
  task: AgentTask,
  opts: SpawnOptions,
  scanner: SecretScanner,
): Promise<AgentRun> {
  return _spawnAgentInternal(member, task, opts, scanner);
}

async function _spawnAgentInternal(
  member: TeamMember,
  task: AgentTask,
  opts: SpawnOptions,
  scanner: SecretScanner,
): Promise<AgentRun> {
  const metrics: AgentRunMetrics = { startedAtMs: Date.now() };
  // ---- 1) centralized secret scan (cannot be bypassed by `spawnAgent` callers)
  const combined = `${task.task}\n${task.appendSystemPrompt ?? ""}`;
  const report = scanner(combined);
  if (report.hits.length > 0) {
    throw new SecretsInPayloadError(member.role, report.hits);
  }

  // ---- 2) write optional system-prompt to a temp file ------------------------
  let appendSystemPromptPath: string | undefined;
  let tmpRoot: string | undefined;
  if (task.appendSystemPrompt && task.appendSystemPrompt.length > 0) {
    tmpRoot = await mkdtemp(path.join(tmpdir(), "ct-asp-"));
    appendSystemPromptPath = path.join(tmpRoot, "system-prompt.md");
    await writeFile(appendSystemPromptPath, task.appendSystemPrompt, "utf8");
  }

  // ---- 3) build role-dispatched argv ---------------------------------------
  const spawnCwd = task.cwd ?? process.cwd();
  const resolveSkill = opts.resolveSkill ?? ((name: string) => resolveSkillPath(name, { repoRoot: spawnCwd }));
  const argv = buildPiArgv(member, task.task, {
    appendSystemPromptPath,
    resolveSkill,
  });

  // ---- 4) spawn detached so the whole process tree is reachable -----------
  const piBinary = opts.piBinary ?? "pi";
  const child: ChildProcess = spawn(piBinary, argv, {
    cwd: spawnCwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: opts.env ?? process.env,
  });
  metrics.spawnedAtMs = Date.now();
  if (opts.onSpawn) {
    try {
      opts.onSpawn({ pid: child.pid, startedAtMs: metrics.spawnedAtMs });
    } catch {
      // Lifecycle observers must not break the agent spawn path.
    }
  }
  // Don't let the detached child leak the parent's controlling TTY.
  child.unref?.();

  const firstEvents: AgentEvent[] = [];
  const tailEvents: AgentEvent[] = [];
  const eventSummary: AgentEventSummary = {
    textDeltaCount: 0,
    thinkingDeltaCount: 0,
    compactedEventCount: 0,
  };
  const retainEvent = (event: AgentEvent): void => {
    if (firstEvents.length < FIRST_RETAINED_EVENT_COUNT) {
      firstEvents.push(event);
      return;
    }
    if (tailEvents.length >= LAST_RETAINED_EVENT_COUNT) {
      tailEvents.shift();
      eventSummary.compactedEventCount += 1;
    }
    tailEvents.push(event);
  };
  // Retain a bounded diagnostic event stream and notify the optional listener.
  // Errors thrown by the listener are swallowed so a buggy UI hook can't break
  // the spawn. High-volume text/thinking deltas are summarized before this
  // point and intentionally do not reach the widget listener.
  const recordEvent = (e: AgentEvent): void => {
    retainEvent(e);
    if (opts.onEvent) {
      try { opts.onEvent(e); } catch { /* swallow */ }
    }
  };
  const toolCalls: ToolCallObservation[] = [];
  const toolExecutions: ToolExecutionTiming[] = [];
  const activeToolExecutions = new Map<string, ToolExecutionTiming>();
  let latestUsage: AgentTokenUsage | undefined;
  let latestContextUsage: AgentContextUsage | undefined;
  const childPids = new Set<number>();
  // Sample child PIDs of the pi process for diagnostics. This uses pgrep/ps
  // via spawnSync, so keep the interval coarse; high-frequency polling added
  // noticeable local overhead during long, quiet reviewer reasoning passes.
  // Tool events trigger an extra sample below to still catch short-lived tool
  // grandchildren near the moment they are spawned.
  const sampleChildPids = (): void => {
    if (!child.pid) return;
    for (const pid of listChildPids(child.pid)) childPids.add(pid);
  };
  // Initial sample on next tick (after spawn fork actually populates pgrep).
  setTimeout(sampleChildPids, 50).unref?.();
  const childSamplerInterval: NodeJS.Timeout | undefined = child.pid
    ? setInterval(sampleChildPids, 2_000)
    : undefined;
  childSamplerInterval?.unref?.();
  let stdoutBuffer = "";
  let pendingKill: Promise<void> | undefined;
  const triggerKill = () => {
    if (!pendingKill) pendingKill = killTree(child);
    return pendingKill;
  };
  let stderrTail = "";
  let finalText = "";
  let lifecycleState: AgentRun["state"] | "running" = "running";
  let reason: string | undefined;

  const heartbeatThreshold =
    task.heartbeatMs ?? member.heartbeatMs ?? opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const absoluteTimeoutMs = opts.absoluteTimeoutMs ?? DEFAULT_ABSOLUTE_TIMEOUT_MS;
  /**
   * Liveness probe: returns true if the spawned child still has a
   * deliverable PID. `process.kill(pid, 0)` does NOT signal — it just
   * checks signal-deliverability. ESRCH means the kernel has reaped the
   * process; any other error (EPERM in restricted sandboxes, etc.) we
   * conservatively treat as alive so we don't kill prematurely.
   *
   * Intentionally checks process state ONLY, not socket / API progress —
   * see watchdog.ts for the rationale and the absolute-timeout safety net.
   */
  const livenessProbe = (): boolean => {
    if (child.pid === undefined) return false;
    try {
      process.kill(child.pid, 0);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
      // EPERM or other errors: process likely exists but we can't probe it.
      // Conservatively report alive.
      return true;
    }
  };
  const heartbeat = startHeartbeat(
    heartbeatThreshold,
    (lastEventAtMs) => {
      if (lifecycleState !== "running") return;
      lifecycleState = "stalled";
      reason = `no protocol event for >= heartbeat threshold (last at ${new Date(lastEventAtMs).toISOString()})`;
      recordEvent({ kind: "stalled", lastEventAtMs });
      triggerKill().catch(() => undefined);
    },
    {
      livenessProbe,
      absoluteTimeoutMs,
      onWarn: (silenceMs) => {
        if (lifecycleState !== "running") return;
        // Diagnostic-only: record that pi went silent but is still alive.
        // Does NOT trigger a kill. The watchdog will continue to poll and
        // either fire another warn (if silence persists with alive process)
        // or escalate to onStall (if probe later returns false OR
        // absoluteTimeoutMs is exceeded).
        recordEvent({ kind: "stall-warning", silenceMs, lastEventAtMs: Date.now() - silenceMs });
      },
    },
  );

  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");

  // Optional raw-stdout/stderr mirroring (M6). When `rawLogPath` is set,
  // every stdout AND stderr chunk is also appended to a file. The
  // existing JSON-parse + heartbeat pipelines still consume the same
  // chunks via their own data listeners; we layer a peer listener
  // here, NOT a `pipe()` (which would auto-end the destination on the
  // first source's `end` event and lose writes from the other source).
  // The file is closed exactly once when BOTH sources have ended.
  let rawLogClose: Promise<void> | undefined;
  if (opts.rawLogPath) {
    const file = createWriteStream(opts.rawLogPath, { flags: "a" });
    let openSources = 2;
    const finishPromise = new Promise<void>((resolve) => {
      const finish = (): void => {
        metrics.rawLogFinishedAtMs ??= Date.now();
        resolve();
      };
      file.once("finish", finish);
      file.once("error", finish); // never block teardown on a write error
    });
    const closeIfDone = (): void => {
      openSources -= 1;
      if (openSources === 0) file.end();
    };
    child.stdout?.on("data", (chunk: string) => {
      try { file.write(chunk); } catch { /* swallow */ }
    });
    child.stderr?.on("data", (chunk: string) => {
      try { file.write(chunk); } catch { /* swallow */ }
    });
    child.stdout?.on("end", closeIfDone);
    child.stderr?.on("end", closeIfDone);
    rawLogClose = finishPromise;
  }

  child.stdout?.on("data", (chunk: string) => {
    metrics.firstStdoutAtMs ??= Date.now();
    heartbeat.beat();
    stdoutBuffer += chunk;
    const parsed = parseLineDelimitedJson(stdoutBuffer);
    stdoutBuffer = parsed.remainder;
    for (const raw of parsed.events) {
      const classification = classifyRawEvent(raw);
      const usage = extractUsage(raw);
      if (usage) {
        latestUsage = usage;
        recordEvent({ kind: "usage", usage });
      }
      latestContextUsage = extractContextUsage(raw) ?? latestContextUsage;
      eventSummary.textDeltaCount += classification.textDeltaCount;
      eventSummary.thinkingDeltaCount += classification.thinkingDeltaCount;
      updateFirstDeltaMetrics(raw, metrics, classification);
      if (raw.type === "tool_execution_start") {
        sampleChildPids();
        recordToolExecutionStart(raw, activeToolExecutions, toolExecutions);
      }
      if (raw.type === "tool_execution_end") {
        recordToolExecutionEnd(raw, activeToolExecutions, toolExecutions);
      }
      if (classification.isHighVolumeStreamDelta) {
        eventSummary.compactedEventCount += 1;
      } else {
        recordEvent({ kind: "stdout-json", raw });
      }
      if (typeof raw.type === "string") {
        if (raw.type === "tool_call") {
          metrics.firstToolEventAtMs ??= Date.now();
          sampleChildPids();
          const toolName = typeof raw.toolName === "string" ? raw.toolName : "unknown";
          const obs: ToolCallObservation = { toolName, input: raw.input };
          toolCalls.push(obs);
          recordEvent({ kind: "tool_call", toolName, input: raw.input });
        }
        // Pi 0.70.6 may emit any of agent_end / message_end / turn_end with
        // assistant text; we take the last non-empty extraction so a
        // curtailed run that never reaches agent_end still surfaces text.
        if (raw.type === "agent_end" || raw.type === "message_end" || raw.type === "turn_end") {
          const extracted = extractFinalAssistantText(raw);
          if (extracted.length > 0) finalText = extracted;
        }
        // `agent_end` is pi's "the assistant turn is done" signal —
        // by this point we have everything the orchestrator needs
        // (finalText extracted above; toolCalls already recorded;
        // stderrTail captured live). Pi's post-event teardown
        // (transcript flush, telemetry, process cleanup) can take
        // minutes and our argv pins `--no-session` for every role,
        // so there is nothing for the orchestrator to wait on. Mark
        // the run as completed up-front and SIGTERM the subprocess
        // — `triggerKill`/`killTree` give pi up to 2s to exit
        // gracefully, then escalate to SIGKILL on the process group.
        // Without this, the next agent in the review loop spends
        // pi's entire shutdown window blocked on `await spawnAgent(...)`.
        if (raw.type === "agent_end" && lifecycleState === "running") {
          metrics.agentEndAtMs ??= Date.now();
          lifecycleState = "completed";
          triggerKill().catch(() => undefined);
        }
      }
    }
  });

  child.stderr?.on("data", (chunk: string) => {
    metrics.firstStderrAtMs ??= Date.now();
    // ANY output (stdout OR stderr) counts as a liveness signal — pi can
    // stay silent on stdout during long reasoning passes while still writing
    // diagnostic chunks to stderr. The original code only beat on stdout,
    // which falsely flagged a thinking reviewer as stalled.
    heartbeat.beat();
    stderrTail += chunk;
    if (stderrTail.length > 8192) stderrTail = stderrTail.slice(-8192);
    recordEvent({ kind: "stderr", text: chunk });
  });

  // AbortSignal -> killTree
  const onAbort = () => {
    if (lifecycleState !== "running") return;
    lifecycleState = "aborted";
    reason = "AbortSignal triggered";
    recordEvent({ kind: "aborted" });
    triggerKill().catch(() => undefined);
  };
  if (task.signal) {
    if (task.signal.aborted) onAbort();
    else task.signal.addEventListener("abort", onAbort, { once: true });
  }

  // Soft timeout (independent of heartbeat)
  let softTimer: NodeJS.Timeout | undefined;
  if (task.softTimeoutMs && task.softTimeoutMs > 0) {
    softTimer = setTimeout(() => {
      if (lifecycleState !== "running") return;
      lifecycleState = "stalled";
      reason = `soft timeout exceeded (${task.softTimeoutMs}ms)`;
      recordEvent({ kind: "stalled", lastEventAtMs: Date.now() });
      triggerKill().catch(() => undefined);
    }, task.softTimeoutMs);
    softTimer.unref?.();
  }

  // ---- 5) wait for exit ----------------------------------------------------
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", (err: Error) => {
      recordEvent({ kind: "error", message: err.message });
      reason = reason ?? err.message;
      // Symmetry with the heartbeat / abort / soft-timeout handlers:
      // do not relabel an already-resolved lifecycle. A late stdio or
      // EPIPE-class error firing AFTER `agent_end` set state to
      // `completed` (kill-on-agent_end path) must not turn a successful
      // run into a `failed` one.
      if (lifecycleState === "running") lifecycleState = "failed";
      reject(err);
    });
    child.once("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      metrics.closeAtMs ??= Date.now();
      recordEvent({ kind: "exit", exitCode, signal });
      resolve({ exitCode, signal });
    });
  }).catch((err) => {
    return { exitCode: null, signal: null as NodeJS.Signals | null, _err: err };
  });

  heartbeat.stop();
  if (softTimer) clearTimeout(softTimer);
  if (childSamplerInterval) clearInterval(childSamplerInterval);
  if (task.signal) task.signal.removeEventListener("abort", onAbort);

  // One last sample so the returned childPids reflect what was alive at exit.
  sampleChildPids();

  // Ensure any in-flight killTree (from abort/stall/timeout) actually completes
  // its SIGTERM-grace + SIGKILL phases before we return. Without this await,
  // a fast direct-child exit after SIGTERM could resolve spawnAgent before the
  // 2s SIGKILL on the process group is delivered, potentially leaking
  // grandchildren that ignored SIGTERM.
  if (pendingKill) {
    try {
      await pendingKill;
    } catch {
      // best-effort; killTree itself swallows ESRCH internally.
    }
  }

  // If raw-stdout mirroring was enabled, await the WriteStream's `finish`
  // event so callers (and tests) see the full file content after spawnAgent
  // resolves. Node WriteStream `end()` is asynchronous; reading the file
  // immediately after spawnAgent without this await can see partial bytes.
  if (rawLogClose) {
    try {
      await rawLogClose;
    } catch {
      // best-effort; a write error must not block the spawn return.
    }
  }
  // Determine final state if we haven't already decided (stalled/aborted set early).
  if (lifecycleState === "running") {
    if (result.exitCode === 0) lifecycleState = "completed";
    else {
      lifecycleState = "failed";
      reason = reason ?? `pi exited with code ${result.exitCode}`;
    }
  }

  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  deriveMetrics(metrics);
  const events = firstEvents.concat(tailEvents);
  const eventsCompacted = eventSummary.compactedEventCount > 0;

  return {
    state: lifecycleState as Exclude<AgentRun["state"], "running">,
    pid: child.pid,
    parentPid: process.pid,
    childPids: [...childPids],
    metrics,
    exitCode: result.exitCode,
    finalText,
    events,
    eventsCompacted,
    eventSummary,
    toolCalls,
    usage: latestUsage,
    contextUsage: latestContextUsage,
    toolExecutions: toolExecutions.concat([...activeToolExecutions.values()]),
    stderrTail,
    reason,
  };
}

function recordToolExecutionStart(
  raw: Record<string, unknown>,
  active: Map<string, ToolExecutionTiming>,
  completed: ToolExecutionTiming[],
): void {
  const id = toolExecutionId(raw);
  const entry: ToolExecutionTiming = {
    id,
    toolName: typeof raw.toolName === "string" ? raw.toolName : "unknown",
    command: extractToolCommand(raw),
    startedAtMs: Date.now(),
  };
  if (id) active.set(id, entry);
  else completed.push(entry);
}

function recordToolExecutionEnd(
  raw: Record<string, unknown>,
  active: Map<string, ToolExecutionTiming>,
  completed: ToolExecutionTiming[],
): void {
  const id = toolExecutionId(raw);
  const started = id ? active.get(id) : undefined;
  const finishedAtMs = Date.now();
  const entry: ToolExecutionTiming = {
    id,
    toolName: typeof raw.toolName === "string" ? raw.toolName : started?.toolName ?? "unknown",
    command: started?.command ?? extractToolCommand(raw),
    startedAtMs: started?.startedAtMs ?? finishedAtMs,
    finishedAtMs,
    durationMs: started ? Math.max(0, finishedAtMs - started.startedAtMs) : undefined,
    isError: typeof raw.isError === "boolean" ? raw.isError : undefined,
  };
  if (id) active.delete(id);
  completed.push(entry);
}

function toolExecutionId(raw: Record<string, unknown>): string | undefined {
  return typeof raw.toolCallId === "string" ? raw.toolCallId : undefined;
}

function extractToolCommand(raw: Record<string, unknown>): string | undefined {
  const args = raw.args;
  if (isRecord(args) && typeof args.command === "string") return args.command;
  const input = raw.input;
  if (isRecord(input) && typeof input.command === "string") return input.command;
  return undefined;
}

function extractUsage(raw: Record<string, unknown>): AgentTokenUsage | undefined {
  if (Array.isArray(raw.messages)) {
    const usages = raw.messages
      .filter(isRecord)
      .filter((message) => message.role === "assistant")
      .map((message) => usageFromUnknown(message.usage))
      .filter((usage): usage is AgentTokenUsage => usage !== undefined);
    if (usages.length > 0) return sumUsage(usages);
  }
  const message = raw.message;
  if (isRecord(message) && message.role === "assistant") return usageFromUnknown(message.usage);
  return usageFromUnknown(raw.usage);
}

function usageFromUnknown(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = numberProp(value, "input") ?? numberProp(value, "inputTokens") ?? 0;
  const output = numberProp(value, "output") ?? numberProp(value, "outputTokens") ?? 0;
  const cacheRead = numberProp(value, "cacheRead") ?? numberProp(value, "cacheReadTokens") ?? 0;
  const cacheWrite = numberProp(value, "cacheWrite") ?? numberProp(value, "cacheWriteTokens") ?? 0;
  const totalTokens = numberProp(value, "totalTokens") ?? input + output + cacheRead + cacheWrite;
  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && totalTokens === 0) return undefined;
  const cost = isRecord(value.cost) ? numberProp(value.cost, "total") : numberProp(value, "cost");
  return { input, output, cacheRead, cacheWrite, totalTokens, costTotal: cost };
}

function sumUsage(usages: AgentTokenUsage[]): AgentTokenUsage {
  return usages.reduce<AgentTokenUsage>((acc, usage) => ({
    input: acc.input + usage.input,
    output: acc.output + usage.output,
    cacheRead: acc.cacheRead + usage.cacheRead,
    cacheWrite: acc.cacheWrite + usage.cacheWrite,
    totalTokens: acc.totalTokens + usage.totalTokens,
    costTotal: (acc.costTotal ?? 0) + (usage.costTotal ?? 0),
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costTotal: 0 });
}

function extractContextUsage(raw: Record<string, unknown>): AgentContextUsage | undefined {
  const candidates = [raw.contextUsage, isRecord(raw.message) ? raw.message.contextUsage : undefined];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const tokens = nullableNumberProp(candidate, "tokens");
    const contextWindow = numberProp(candidate, "contextWindow");
    const percent = nullableNumberProp(candidate, "percent");
    if (tokens !== undefined || contextWindow !== undefined || percent !== undefined) {
      return { tokens, contextWindow, percent };
    }
  }
  return undefined;
}

function numberProp(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumberProp(obj: Record<string, unknown>, key: string): number | null | undefined {
  if (obj[key] === null) return null;
  return numberProp(obj, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function updateFirstDeltaMetrics(
  raw: Record<string, unknown>,
  metrics: AgentRunMetrics,
  classification: RawEventClassification = classifyRawEvent(raw),
): void {
  const now = Date.now();
  if (metrics.firstTextDeltaAtMs === undefined && classification.textDeltaCount > 0) {
    metrics.firstTextDeltaAtMs = now;
  }
  if (metrics.firstThinkingDeltaAtMs === undefined && classification.thinkingDeltaCount > 0) {
    metrics.firstThinkingDeltaAtMs = now;
  }
  if (
    metrics.firstToolEventAtMs === undefined
    && (raw.type === "tool_execution_start" || raw.type === "tool_execution_update")
  ) {
    metrics.firstToolEventAtMs = now;
  }
}

function deriveMetrics(metrics: AgentRunMetrics): void {
  const endAt = metrics.rawLogFinishedAtMs ?? metrics.closeAtMs ?? Date.now();
  metrics.totalDurationMs = Math.max(0, endAt - metrics.startedAtMs);
  if (metrics.firstStdoutAtMs !== undefined) {
    metrics.timeToFirstStdoutMs = Math.max(0, metrics.firstStdoutAtMs - metrics.startedAtMs);
  }
  if (metrics.firstTextDeltaAtMs !== undefined) {
    metrics.timeToFirstTextDeltaMs = Math.max(0, metrics.firstTextDeltaAtMs - metrics.startedAtMs);
  }
  if (metrics.agentEndAtMs !== undefined && metrics.closeAtMs !== undefined) {
    metrics.timeFromAgentEndToCloseMs = Math.max(0, metrics.closeAtMs - metrics.agentEndAtMs);
  }
}

/**
 * SIGTERM the entire detached process group, wait {@link SIGTERM_GRACE_MS},
 * then SIGKILL the group unconditionally — even if the direct child has
 * already exited, because grandchildren that ignored SIGTERM may still be
 * running. Uses negative-PID kill so the whole detached group dies together.
 *
 * Idempotent: a "no such process" error from the second signal is swallowed.
 */
export async function killTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const pid = child.pid;

  // Phase 1: SIGTERM the group (or the direct child if the group is gone).
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore — the child may already be dead, but grandchildren under the
      // group could still be alive, so we still issue the SIGKILL below.
    }
  }

  // Phase 2: wait only while the process group is still alive, then SIGKILL
  // anything that survived the grace window. The previous implementation
  // always slept the full 2s even when pi exited immediately after SIGTERM,
  // which added a hidden ~2s tax to EVERY successful agent handoff (especially
  // visible in reviewer loops). Polling the process group preserves the
  // leak-prevention guarantee for stubborn grandchildren without slowing the
  // common fast-exit path.
  const exitedDuringGrace = await waitForProcessGroupExit(pid, SIGTERM_GRACE_MS);
  if (exitedDuringGrace) return;

  // Phase 3: SIGKILL the group unconditionally. Even if `child.exitCode`
  // is set, grandchildren in the same process group may have ignored SIGTERM.
  // SIGKILL on a now-empty group raises ESRCH which we swallow.
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

/**
 * Best-effort enumeration of direct child PIDs of `parentPid`. Used purely for
 * surfacing diagnostic info on `AgentRun.childPids` — process group cleanup
 * does not depend on this list. Tries `pgrep -P` first (fast, single-syscall),
 * then falls back to parsing `ps -A -o pid=,ppid=` for sandboxes where pgrep
 * is unavailable or restricted.
 */
function listChildPids(parentPid: number): number[] {
  const viaPgrep = listChildPidsViaPgrep(parentPid);
  if (viaPgrep.length > 0) return viaPgrep;
  return listChildPidsViaPs(parentPid);
}

function listChildPidsViaPgrep(parentPid: number): number[] {
  const r = spawnSync("pgrep", ["-P", String(parentPid)], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .split("\n")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function listChildPidsViaPs(parentPid: number): number[] {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return [];
  const out: number[] = [];
  for (const line of r.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (Number.isFinite(pid) && Number.isFinite(ppid) && ppid === parentPid) {
      out.push(pid);
    }
  }
  return out;
}

async function waitForProcessGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pid)) return true;
    await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
  }
  return !processGroupExists(pid);
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") return false;
    // EPERM or other odd sandbox errors mean the process group likely exists
    // but cannot be probed by us. Treat as alive so SIGKILL is still attempted
    // after the grace window.
    return true;
  }
}

function sleep(ms: number): Promise<void> {
  // NOTE: do NOT unref here — callers (`killTree`) explicitly need the grace
  // timer to keep the event loop alive until cleanup has either observed the
  // process group exit or delivered the SIGKILL fallback.
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
