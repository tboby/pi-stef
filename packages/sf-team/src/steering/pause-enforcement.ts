import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { PausedSteeringError, type SteeringOrchestratorContext } from "./drain";

export interface PauseEnforcementOptions {
  ui?: ExtensionUIContext;
  signal?: AbortSignal;
}

/**
 * Called at safe boundaries (between stories, before milestone complete,
 * before workflow finalization, etc.). Reads the latched pauseState; if
 * non-null, either:
 *   - prompts the operator (if `ui.confirm` is available) and clears the
 *     latch when they accept; or
 *   - throws PausedSteeringError so the workflow exits cleanly with the
 *     pauseState preserved in state.json for the next resume to read.
 *
 * Safe boundaries: tools/{implement,plan,task,auto,followup}.ts call
 * this immediately after every drain so the orchestrator never wanders
 * past a known-failed instruction without surfacing it.
 */
export async function enforcePauseAtSafeBoundary(
  ctx: SteeringOrchestratorContext,
  options: PauseEnforcementOptions = {},
): Promise<void> {
  const pauseState = await ctx.readPauseState();
  if (!pauseState) return;

  const kindLabel = pauseState.kind === "failure" ? "steering failure" : "steering confirmation";
  const summary = `${kindLabel}: ${pauseState.rationale} (instructions: ${pauseState.instructionIds.join(", ")})`;

  if (options.ui?.confirm) {
    let cont: boolean | undefined;
    try {
      cont = await options.ui.confirm(
        `Resolve ${kindLabel}?`,
        summary,
        { signal: options.signal },
      );
    } catch (uiErr) {
      // Treat any failure in the confirm prompt (user abort, signal, IO)
      // as a paused workflow, NOT a generic error: PausedSteeringError is
      // the third workflow-exit branch in orchestrator/run.ts that
      // preserves workflow-scoped guidance + the pauseState latch.
      // Without this, a UI exception would fall through the orchestrator's
      // "aborted" branch and incorrectly expire guidance.
      const err = new PausedSteeringError(pauseState);
      (err as { cause?: unknown }).cause = uiErr;
      throw err;
    }
    if (cont) {
      await ctx.clearPause();
      return;
    }
    // Operator declined → still throw so the caller stops the workflow.
    throw new PausedSteeringError(pauseState);
  }

  // Headless: no interactive UI available. The workflow exits cleanly;
  // state.json carries the pauseState; next resume reads it and either
  // prompts (UI present) or rethrows.
  throw new PausedSteeringError(pauseState);
}
