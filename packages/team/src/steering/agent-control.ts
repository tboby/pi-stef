import { execFile as execFileCb } from "node:child_process";
import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { RESTART_TASK_CAP_BYTES, truncateWithTranscriptHint } from "../tools/shared";
import type { SteeringStore } from "./store";
import type {
  ActiveAgentRecord,
  RunningAgentControl,
  SteeringDecision,
  SteeringDecisionKind,
  SteeringInstruction,
} from "./types";

const execFile = promisify(execFileCb);

export interface AgentControlActionResult {
  actionKind: SteeringDecisionKind | "noop" | "confirm";
  targetId?: string;
  status: "completed" | "failed" | "skipped";
  summary: string;
}

export interface ApplyAgentControlDecisionInput {
  decision: SteeringDecision;
  instruction: SteeringInstruction;
  controls: Map<string, RunningAgentControl>;
  store: SteeringStore;
  repoRoot?: string;
  confirmDestructiveAction?: (summary: WorktreeDiscardSummary) => Promise<boolean>;
}

export interface ApplyAgentControlDecisionResult {
  status: "applied" | "rejected" | "requires-user-confirmation";
  pausedForConfirmation: boolean;
  actions: AgentControlActionResult[];
}

export interface RestartPromptInput {
  originalTaskSummary: string;
  originalTask?: string;
  steeringInstruction: string;
  priorPartialStatus: string;
}

export interface WorktreeDiscardSummary {
  agentId: string;
  role: string;
  worktreePath: string;
  gitStatus: string;
  diffStat: string;
  stagedDiffStat: string;
  trackedChanges: string[];
  untrackedFiles: string[];
  ignoredFiles: string[];
  confirmationMessage: string;
}

export interface DiscardWorktreeInput {
  agent: ActiveAgentRecord;
  repoRoot: string;
  confirm: (summary: WorktreeDiscardSummary) => Promise<boolean>;
  beforeDiscard?: () => Promise<void>;
}

export interface DiscardWorktreeResult {
  status: "discarded" | "rejected";
  summary: WorktreeDiscardSummary;
}

export function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const liveSignals = signals.filter((signal): signal is AbortSignal => !!signal);
  if (liveSignals.length === 0) return undefined;
  if (liveSignals.length === 1) return liveSignals[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(liveSignals);

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  const cleanup = (): void => {
    for (const entry of listeners) entry.signal.removeEventListener("abort", entry.listener);
    listeners.length = 0;
  };
  const abortFrom = (source: AbortSignal): void => {
    if (controller.signal.aborted) return;
    controller.abort(source.reason);
    cleanup();
  };

  for (const signal of liveSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      break;
    }
    const listener = (): void => abortFrom(signal);
    listeners.push({ signal, listener });
    signal.addEventListener("abort", listener, { once: true });
  }
  return controller.signal;
}

export function composeRestartPrompt(input: RestartPromptInput): string {
  const originalTask = input.originalTask?.trim();
  const cappedTask = originalTask
    ? truncateWithTranscriptHint(originalTask, RESTART_TASK_CAP_BYTES, `*original-task*`)
    : undefined;
  return [
    "Restart this agent run with amended steering context.",
    "",
    "Original task summary:",
    input.originalTaskSummary || "(no summary available)",
    ...(cappedTask
      ? [
          "",
          "Original task full context:",
          cappedTask,
        ]
      : []),
    "",
    "New steering instruction:",
    input.steeringInstruction,
    "",
    "Prior partial status:",
    input.priorPartialStatus || "(the prior run did not report partial status)",
    "",
    "Continue in the same workspace. Preserve unaffected work, follow the steering instruction exactly, and report what changed because of the restart.",
  ].join("\n");
}

export function destructiveConfirmationRequired(decision: SteeringDecision): boolean {
  return decision.kind === "discard-running-agent-changes" || decision.discardAgentChanges.length > 0;
}

export async function applyAgentControlDecision(
  input: ApplyAgentControlDecisionInput,
): Promise<ApplyAgentControlDecisionResult> {
  const actions: AgentControlActionResult[] = [];
  const records = await input.store.readActiveAgents();
  const recordById = new Map(records.map((record) => [record.id, record]));

  if (destructiveConfirmationRequired(input.decision)) {
    if (input.decision.kind !== "discard-running-agent-changes" && input.decision.discardAgentChanges.length === 0) {
      return {
        status: "requires-user-confirmation",
        pausedForConfirmation: true,
        actions: [{
          actionKind: "confirm",
          status: "skipped",
          summary: "Destructive steering decision requires an explicit user confirmation at a later milestone.",
        }],
      };
    }
    if (!input.repoRoot || !input.confirmDestructiveAction) {
      return {
        status: "requires-user-confirmation",
        pausedForConfirmation: true,
        actions: [{
          actionKind: "confirm",
          status: "skipped",
          summary: "Discarding active-agent changes requires an interactive confirmation callback.",
        }],
      };
    }
  } else if (input.decision.requiresConfirmation) {
    return {
      status: "requires-user-confirmation",
      pausedForConfirmation: true,
      actions: [{
        actionKind: "confirm",
        status: "skipped",
        summary: "Steering decision requested user confirmation.",
      }],
    };
  }

  for (const agentId of stopAgentIds(input.decision)) {
    const control = input.controls.get(agentId);
    if (!control) {
      actions.push({
        actionKind: "stop-running-agents",
        targetId: agentId,
        status: "skipped",
        summary: `No live control handle found for ${agentId}.`,
      });
      continue;
    }
    try {
      await control.abort(input.decision.summary);
      actions.push({
        actionKind: "stop-running-agents",
        targetId: agentId,
        status: "completed",
        summary: `Abort requested for ${agentId}.`,
      });
    } catch (err) {
      actions.push({
        actionKind: "stop-running-agents",
        targetId: agentId,
        status: "failed",
        summary: `Abort failed for ${agentId}: ${describeError(err)}`,
      });
    }
  }

  for (const agentId of restartAgentIds(input.decision)) {
    const control = input.controls.get(agentId);
    if (!control) {
      actions.push({
        actionKind: "restart-running-agents",
        targetId: agentId,
        status: "skipped",
        summary: `No live control handle found for ${agentId}.`,
      });
      continue;
    }
    try {
      await control.restart(
        input.decision.agentRestartInstructions?.[agentId]
          ?? input.decision.amendedUserFacingPlanText
          ?? input.instruction.text,
      );
      actions.push({
        actionKind: "restart-running-agents",
        targetId: agentId,
        status: "completed",
        summary: `Restart requested for ${agentId}.`,
      });
    } catch (err) {
      actions.push({
        actionKind: "restart-running-agents",
        targetId: agentId,
        status: "failed",
        summary: `Restart failed for ${agentId}: ${describeError(err)}`,
      });
    }
  }

  for (const agentId of discardAgentIds(input.decision)) {
    const record = input.controls.get(agentId)?.describe() ?? recordById.get(agentId);
    if (!record) {
      actions.push({
        actionKind: "discard-running-agent-changes",
        targetId: agentId,
        status: "skipped",
        summary: `No active-agent record found for ${agentId}.`,
      });
      continue;
    }
    try {
      const result = await discardIsolatedWorktreeChanges({
        agent: record,
        repoRoot: input.repoRoot as string,
        confirm: input.confirmDestructiveAction as (summary: WorktreeDiscardSummary) => Promise<boolean>,
        beforeDiscard: async () => {
          const control = input.controls.get(agentId);
          if (!control) return;
          await control.abort("Discarding isolated worktree changes after user confirmation.");
          await control.waitForExit();
        },
      });
      if (result.status === "rejected") {
        actions.push({
          actionKind: "discard-running-agent-changes",
          targetId: agentId,
          status: "skipped",
          summary: `User declined discard for ${agentId}.`,
        });
        return { status: "rejected", pausedForConfirmation: false, actions };
      }
      actions.push({
        actionKind: "discard-running-agent-changes",
        targetId: agentId,
        status: "completed",
        summary: `Discarded isolated worktree changes for ${agentId}.`,
      });
    } catch (err) {
      actions.push({
        actionKind: "discard-running-agent-changes",
        targetId: agentId,
        status: "failed",
        summary: `Discard failed for ${agentId}: ${describeError(err)}`,
      });
    }
  }

  if (actions.length === 0) {
    actions.push({
      actionKind: input.decision.kind === "queue-for-safe-boundary" ? "queue-for-safe-boundary" : "noop",
      status: "completed",
      summary: input.decision.summary || "No active-agent control action was required.",
    });
  }

  return { status: "applied", pausedForConfirmation: false, actions };
}

export async function discardIsolatedWorktreeChanges(input: DiscardWorktreeInput): Promise<DiscardWorktreeResult> {
  const summary = await captureWorktreeDiscardSummary(input.agent, input.repoRoot);
  const confirmed = await input.confirm(summary);
  if (!confirmed) return { status: "rejected", summary };

  await input.beforeDiscard?.();
  await git(summary.worktreePath, ["reset", "--hard", "HEAD"]);
  await git(summary.worktreePath, ["clean", "-fd"]);
  return { status: "discarded", summary };
}

export async function captureWorktreeDiscardSummary(agent: ActiveAgentRecord, repoRoot: string): Promise<WorktreeDiscardSummary> {
  const worktreePath = await assertSafeDiscardWorktree(agent, repoRoot);
  const gitStatus = await git(worktreePath, ["status", "--short", "--untracked-files=all"]);
  const ignoredStatus = await git(worktreePath, ["status", "--short", "--ignored", "--untracked-files=all"]);
  const diffStat = await git(worktreePath, ["diff", "--stat"]);
  const stagedDiffStat = await git(worktreePath, ["diff", "--cached", "--stat"]);
  const trackedChanges = parseStatus(gitStatus, "tracked");
  const untrackedFiles = parseStatus(gitStatus, "untracked");
  const ignoredFiles = parseStatus(ignoredStatus, "ignored");
  const summary: WorktreeDiscardSummary = {
    agentId: agent.id,
    role: agent.role,
    worktreePath,
    gitStatus,
    diffStat,
    stagedDiffStat,
    trackedChanges,
    untrackedFiles,
    ignoredFiles,
    confirmationMessage: "",
  };
  summary.confirmationMessage = composeDiscardConfirmationMessage(summary);
  return summary;
}

async function assertSafeDiscardWorktree(agent: ActiveAgentRecord, repoRoot: string): Promise<string> {
  if (!agent.worktreePath) throw new Error(`Agent ${agent.id} has no worktreePath; refusing discard`);
  const worktreePath = await realpath(path.resolve(agent.worktreePath));
  const resolvedRepoRoot = await realpath(path.resolve(repoRoot));
  const resolvedCwd = await realpath(process.cwd()).catch(() => path.resolve(process.cwd()));

  if (samePath(worktreePath, resolvedRepoRoot)) {
    throw new Error("Refusing to discard changes in the main repository worktree");
  }
  if (samePath(worktreePath, resolvedCwd)) {
    throw new Error("Refusing to discard changes in the current process worktree");
  }
  await access(worktreePath);

  const topLevel = await realpath((await git(worktreePath, ["rev-parse", "--show-toplevel"])).trim());
  if (!samePath(topLevel, worktreePath)) {
    throw new Error(`Refusing to discard ${worktreePath}; it is not the git worktree root`);
  }

  const worktreeList = await git(resolvedRepoRoot, ["worktree", "list", "--porcelain"]);
  const registered = parseWorktreeList(worktreeList);
  if (!registered.some((entry) => samePath(entry, worktreePath))) {
    throw new Error(`Refusing to discard ${worktreePath}; it is not registered as a git worktree for ${resolvedRepoRoot}`);
  }
  if (registered[0] && samePath(registered[0], worktreePath)) {
    throw new Error("Refusing to discard changes in the primary git worktree");
  }
  return worktreePath;
}

function stopAgentIds(decision: SteeringDecision): string[] {
  if (decision.kind !== "stop-running-agents") return [];
  // `abortAgents` is the canonical field; `targetAgents` is accepted for
  // lenient decider output that names targets but omits the abort mirror.
  return unique(decision.abortAgents.concat(decision.targetAgents));
}

function restartAgentIds(decision: SteeringDecision): string[] {
  if (decision.kind !== "restart-running-agents") return [];
  // `targetAgents` is the canonical field; `abortAgents` is accepted because
  // restart is implemented as abort plus replacement spawn.
  return unique(decision.targetAgents.concat(decision.abortAgents));
}

function discardAgentIds(decision: SteeringDecision): string[] {
  if (decision.kind === "discard-running-agent-changes") return unique(decision.discardAgentChanges.concat(decision.targetAgents));
  return unique(decision.discardAgentChanges);
}

function parseStatus(status: string, kind: "tracked" | "untracked" | "ignored"): string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => {
      if (kind === "untracked") return line.startsWith("?? ");
      if (kind === "ignored") return line.startsWith("!! ");
      return line.length > 0 && !line.startsWith("?? ") && !line.startsWith("!! ");
    })
    .slice(0, 50);
}

function composeDiscardConfirmationMessage(summary: WorktreeDiscardSummary): string {
  return [
    `Discard active-agent changes for ${summary.agentId} (${summary.role})?`,
    "",
    `Worktree: ${summary.worktreePath}`,
    "",
    "Tracked changes:",
    summary.trackedChanges.length > 0 ? summary.trackedChanges.join("\n") : "(none)",
    "",
    "Untracked files that will be removed:",
    summary.untrackedFiles.length > 0 ? summary.untrackedFiles.join("\n") : "(none)",
    "",
    "Ignored files that will be preserved:",
    summary.ignoredFiles.length > 0 ? summary.ignoredFiles.join("\n") : "(none)",
    "",
    "Diff stat:",
    summary.diffStat.trim() || "(none)",
    "",
    "Staged diff stat:",
    summary.stagedDiffStat.trim() || "(none)",
  ].join("\n");
}

function parseWorktreeList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => path.resolve(line.slice("worktree ".length).trim()));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
