import type { AgentEvent } from "../runtime/types";
import type { WidgetState, AgentState, AgentCard } from "./state";
import { setLockState, setMilestones, setResume, updateAgent, upsertAgent } from "./state";
import { parseTrackerText, type ParsedTracker } from "../plan/tracker";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

/**
 * Apply a single AgentEvent (from spawnAgent's event stream) to the widget
 * state. Returns the new state. Pure data — does not perform IO.
 *
 * If this starts reacting to new event kinds or stdout-json types, update
 * runtime/events.ts:eventAffectsWidget so the orchestrator does not filter
 * those events out before they reach this reducer.
 */
export function applyAgentEvent(state: WidgetState, agentId: string, event: AgentEvent): WidgetState {
  switch (event.kind) {
    case "stdout-json": {
      // Pi event stream → activity hint. Map common types.
      const t = typeof event.raw.type === "string" ? event.raw.type : undefined;
      if (t === "agent_start") return updateAgent(state, agentId, { state: "running", startedAtMs: Date.now() });
      // Terminal: stamp endedAtMs so the renderer freezes the elapsed timer.
      if (t === "agent_end") return updateAgent(state, agentId, { state: "completed", endedAtMs: Date.now() });
      return state;
    }
    case "usage":
      return state;
    case "tool_call":
      return updateAgent(state, agentId, { activity: `tool: ${event.toolName}` });
    case "stalled":
      return updateAgent(state, agentId, { state: "stalled", endedAtMs: Date.now() });
    case "aborted":
      return updateAgent(state, agentId, { state: "aborted", endedAtMs: Date.now() });
    case "exit": {
      // Preserve ANY terminal state already set on the card. The first
      // terminal-signaling event we observe authoritatively decides the
      // card's final state — `agent_end` → completed, `error` → failed,
      // `stalled` / `aborted` via their own AgentEvent kinds. The
      // trailing `exit` event is informational and must not relabel a
      // card that's already terminal.
      //
      // Critical for the kill-on-agent_end path: spawnAgent now SIGTERMs
      // pi on `agent_end` so the next agent can spawn quickly. The
      // subprocess then exits via signal (`exitCode: null`), and without
      // preserving the existing `completed` here, this branch would
      // relabel every successful run to `failed` — every researcher /
      // planner / reviewer / developer card would render ✗.
      const current = state.agents.find((a) => a.id === agentId)?.state;
      if (current === "completed" || current === "failed" || current === "aborted" || current === "stalled") {
        return state;
      }
      const next: AgentState = event.exitCode === 0 ? "completed" : "failed";
      return updateAgent(state, agentId, { state: next, endedAtMs: Date.now() });
    }
    case "error":
      return updateAgent(state, agentId, { state: "failed", activity: event.message, endedAtMs: Date.now() });
    case "stderr":
      return state; // visible noise; widget shows tool calls instead
    case "stall-warning":
      // Diagnostic-only event from the watchdog: pi was silent past the
      // heartbeat threshold but still alive. The card should keep its
      // current state (running/whatever) — the widget intentionally
      // doesn't surface this to avoid alarming the user about a normal
      // long-inference gap. The event is preserved in `AgentRun.events`
      // for diagnostics, so a true hang's history is still inspectable.
      return state;
  }
}

/**
 * Watch a story-tracker.md file for changes and call `onUpdate(newState)`
 * each time the file changes. The returned function unsubscribes the watcher.
 *
 * IMPORTANT: watches the PARENT DIRECTORY, not the file directly. The
 * production updater (`src/plan/tracker.ts:updateStoryTracker`) writes to
 * `story-tracker.md.tmp` and atomically renames it onto the target — this
 * replaces the file's inode. A direct `fs.watch(filePath, ...)` watcher can
 * remain attached to the dead inode and miss subsequent updates. Watching
 * the directory and filtering by basename catches every rename event.
 */
export function watchTrackerFile(
  filePath: string,
  initialState: WidgetState,
  onUpdate: (next: WidgetState) => void,
  opts: { pollIntervalMs?: number } = {},
): () => void {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  let current = initialState;
  let pending = false;
  let stopped = false;
  const pollMs = opts.pollIntervalMs ?? 750;

  const refresh = async () => {
    if (stopped || pending) return;
    pending = true;
    try {
      const next = await applyTrackerFile(current, filePath);
      current = next;
      if (!stopped) onUpdate(next);
    } finally {
      pending = false;
    }
  };

  // Fire an initial projection so callers don't wait for the first event.
  void refresh();

  // Try fs.watch on the parent directory first. fs.watch can throw EMFILE or
  // similar on resource-limited hosts; in that case we fall back to a poll
  // loop. We also install an `error` handler on the watcher to switch to
  // polling if the kernel notifier dies mid-run.
  let watcher: ReturnType<typeof watch> | undefined;
  let pollTimer: NodeJS.Timeout | undefined;

  const startPolling = () => {
    if (pollTimer || stopped) return;
    pollTimer = setInterval(() => void refresh(), pollMs);
    pollTimer.unref?.();
  };

  try {
    watcher = watch(dir, { persistent: false }, (_event, name) => {
      if (name == null || name === baseName) void refresh();
    });
    watcher.on("error", () => {
      // Kernel notifier died (EMFILE, ENOSPC, etc). Drop the watcher and poll.
      try {
        watcher?.close();
      } catch (_err) {
        // ignore
      }
      watcher = undefined;
      startPolling();
    });
  } catch (_err) {
    // Couldn't start fs.watch at all — go straight to polling.
    startPolling();
  }

  return () => {
    stopped = true;
    try {
      watcher?.close();
    } catch (_err) {
      // already closed
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  };
}

/**
 * Project a parsed story-tracker into the milestone-strip's data model.
 */
export function projectTracker(parsed: ParsedTracker): WidgetState["milestones"] {
  return parsed.milestones.map((m) => {
    const total = m.stories.length;
    const completed = m.stories.filter((s) => s.status === "completed").length;
    const inDev = m.stories.filter((s) => s.status === "in-dev").length;
    return {
      id: m.id,
      title: m.title,
      total,
      completed,
      inDev,
      approvalStatus: m.approvalStatus,
    };
  });
}

/**
 * Read a story-tracker.md file and apply it onto the widget state. Used
 * directly OR triggered by an `fs.watch` notification (S-807).
 */
export async function applyTrackerFile(state: WidgetState, path: string): Promise<WidgetState> {
  const raw = await readFile(path, "utf8").catch(() => undefined);
  if (raw === undefined) return state;
  const parsed = parseTrackerText(raw);
  return setMilestones(state, projectTracker(parsed));
}

/** Re-export the small utility setters so the orchestrator can mutate state. */
export { upsertAgent, updateAgent, setMilestones, setResume, setLockState };

/** Build a typical `AgentCard` for a freshly-spawned member. Convenience. */
export function newAgentCard(opts: {
  id: string;
  role: AgentCard["role"];
  model: string;
  parentId?: string;
}): AgentCard {
  return {
    id: opts.id,
    role: opts.role,
    model: opts.model,
    parentId: opts.parentId,
    state: "running",
    startedAtMs: Date.now(),
  };
}
