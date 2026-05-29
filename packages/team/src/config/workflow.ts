import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { DEFAULT_CONFIG, type ResolvedDefaults, type WorkflowProfile } from "./schema";
import type { TmuxManager } from "../tmux/manager";

export function workflowProfile(defaults: ResolvedDefaults | undefined): WorkflowProfile {
  return defaults?.workflow.profile ?? DEFAULT_CONFIG.workflow.profile;
}

export function isHeadlessWorkflow(defaults: ResolvedDefaults | undefined): boolean {
  return workflowProfile(defaults) === "headless";
}

export function effectiveUi<T extends ExtensionUIContext | undefined>(
  ui: T,
  defaults: ResolvedDefaults | undefined,
): T | undefined {
  return isHeadlessWorkflow(defaults) ? undefined : ui;
}

export function effectiveTmuxManager<T extends TmuxManager | null | undefined>(
  tmuxManager: T,
  defaults: ResolvedDefaults | undefined,
): T | null {
  return isHeadlessWorkflow(defaults) ? null : tmuxManager;
}

export function planReviewMaxRounds(inputMaxRounds: number | undefined, defaults: ResolvedDefaults | undefined): number {
  return inputMaxRounds ?? defaults?.review.plan_max_rounds ?? defaults?.review.max_rounds ?? DEFAULT_CONFIG.review.plan_max_rounds;
}

export function implementationReviewMaxRounds(inputMaxRounds: number | undefined, defaults: ResolvedDefaults | undefined): number {
  return inputMaxRounds
    ?? defaults?.review.implementation_max_rounds
    ?? defaults?.review.max_rounds
    ?? DEFAULT_CONFIG.review.implementation_max_rounds;
}
