export type SteeringInstructionStatus =
  | "queued"
  | "analyzing"
  | "requires-user-confirmation"
  | "partially-applied"
  | "applied"
  | "rejected"
  | "failed";

export interface SteeringPauseState {
  /** "failure" when any instruction is failed; "confirmation" when an applied decision returned requires-user-confirmation. */
  kind: "failure" | "confirmation";
  /** Instructions that pushed the orchestrator into a paused state. */
  instructionIds: string[];
  /** Short human description (typically the first failed instruction's error message or the confirmation summary). */
  rationale: string;
  /** Optional shared id when a batch-validation failure produced multiple sibling failures. */
  batchErrorId?: string;
  /** ISO timestamp of when the latch was set. */
  latchedAt: string;
}

export type SteeringInstructionSource =
  | "tool"
  | "slash"
  | "interactive-input"
  | "resume"
  | "internal";

export interface SteeringInstruction {
  id: string;
  workflowId: string;
  planSlug?: string;
  receivedAt: string;
  source: SteeringInstructionSource;
  text: string;
  priority: "normal" | "urgent";
  status: SteeringInstructionStatus;
  targetHints?: {
    agentIds?: string[];
    roles?: string[];
    milestones?: string[];
    stories?: string[];
    files?: string[];
  };
  contextHash?: {
    milestonePlan?: string;
    storyTracker?: string;
    executionStrategy?: string;
  };
}

export type SteeringDrainReason =
  | "workflow-start"
  | "before-agent-spawn"
  | "child-active-tick"
  | "explicit-steer-wake"
  | "agent-ended"
  | "agent-aborted"
  | "agent-failed"
  | "before-worktree-merge"
  | "before-story-complete"
  | "before-milestone-complete"
  | "before-user-approval-pause"
  | "after-resume"
  | "before-final-completion";

export interface SteeringDrainResult {
  processedInstructionIds: string[];
  appliedDecisionIds: string[];
  pausedForConfirmation: boolean;
  errors: Array<{ instructionId: string; message: string }>;
}

export interface SteeringWorkflowSnapshot {
  workflowId: string;
  workflowKind: "plan" | "implement" | "auto" | "task" | "followup";
  activeAgentsVersion: number;
  referencedAgentStates: Record<string, ActiveAgentState>;
  referencedPlanHashes: Record<string, string>;
  activeAgents: ActiveAgentRecord[];
  currentMilestoneId?: string;
  currentStoryId?: string;
}

export interface SteeringAgentAction {
  id: string;
  instructionId: string;
  decisionId: string;
  actionKind: SteeringDecisionKind | "confirm" | "wake" | "noop";
  targetId?: string;
  startedAt: string;
  completedAt?: string;
  status: "started" | "completed" | "failed" | "skipped";
  summary: string;
}

export interface AppliedSteeringInstruction {
  instructionId: string;
  decisionId: string;
  appliedAt: string;
}

export interface RunningAgentControl {
  abort(reason: string): Promise<void>;
  restart(amendedPromptContext: string): Promise<void>;
  waitForExit(): Promise<void>;
  describe(): ActiveAgentRecord;
}

export type SteeringDecisionKind =
  | "apply-to-future"
  | "queue-for-safe-boundary"
  | "restart-running-agents"
  | "stop-running-agents"
  | "discard-running-agent-changes"
  | "amend-plan"
  | "backtrack-completed-work"
  | "ask-user"
  | "reject";

export type SteeringGuidanceScopeKind = "workflow" | "milestone" | "story" | "role";

export interface SteeringDecision {
  id: string;
  instructionId: string;
  decidedAt: string;
  kind: SteeringDecisionKind;
  summary: string;
  rationale: string;
  planPatchRequired: boolean;
  targetAgents: string[];
  abortAgents: string[];
  discardAgentChanges: string[];
  affectedMilestones: string[];
  affectedStories: string[];
  affectedFiles: string[];
  earliestReplayPoint?: {
    milestoneId?: string;
    storyId?: string;
    reason: string;
  };
  amendedUserFacingPlanText?: string;
  agentRestartInstructions?: Record<string, string>;
  operatorQuestion?: string;
  risks: string[];
  activeAgentsVersion: number;
  referencedAgentStates: Record<string, ActiveAgentState>;
  referencedPlanHashes: Record<string, string>;
  requiresConfirmation: boolean;
  /** Optional scope for apply-to-future guidance. Defaults to "workflow" when omitted by the decider. */
  scopeKind?: SteeringGuidanceScopeKind;
  /** Optional target for milestone/story/role scopes. Required by validateDecision when scopeKind is not "workflow". */
  scopeTarget?: string;
  /** Required by validateDecision when kind === "apply-to-future". The actual text injected into future agent prompts. */
  guidanceText?: string;
  /** Raw decider output captured at the spawn boundary; surfaced into the audit transcript so users can inspect what the model returned even when parsing succeeded. */
  rawOutput?: string;
}

export type SteeringGuidanceStatus = "pending-activation" | "active" | "expired";

export interface SteeringGuidanceScope {
  kind: SteeringGuidanceScopeKind;
  target?: string;
}

export interface SteeringGuidance {
  id: string;
  instructionId: string;
  workflowId: string;
  appendedAt: string;
  scope: SteeringGuidanceScope;
  text: string;
  source: SteeringInstructionSource;
  status: SteeringGuidanceStatus;
  /** Reason set when status === "expired". */
  expireReason?: string;
}

export type ActiveAgentState =
  | "starting"
  | "running"
  | "aborting"
  | "aborted"
  | "completed"
  | "failed";

export interface ActiveAgentRecord {
  id: string;
  role: string;
  label: string;
  workflowId: string;
  milestoneId?: string;
  storyId?: string;
  worktreePath?: string;
  branchName?: string;
  baseCommit?: string;
  startedAt: string;
  state: ActiveAgentState;
  promptSummary: string;
  promptHash: string;
  expectedWriteScope?: string[];
  lastEventAt?: string;
  pid?: number;
}
