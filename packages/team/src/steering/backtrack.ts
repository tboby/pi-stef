import { execFile as execFileCb } from "node:child_process";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { buildSequentialExecutionStrategyArtifact, loadExecutionStrategyForPlanFolder } from "../plan/execution-strategy";
import { PLAN_FOLDER_ROOT, planFolderPathFromRoot } from "../plan/paths";
import { parseStoryTracker, parseTrackerText } from "../plan/tracker";
import type { TeamMember } from "../runtime/types";
import { revisePlanWithPatchOrFallback } from "../tools/plan-revision";
import type { SpawnAgentReturning } from "../tools/shared";
import type { TranscriptHandle } from "../orchestrator/transcript";
import { analyzePlanImpact, type PlanImpact } from "./plan-impact";
import type { SteeringDecision, SteeringInstruction } from "./types";

const execFile = promisify(execFileCb);

export interface CommitLedgerEntry {
  workflowId: string;
  storyId?: string;
  milestoneId?: string;
  commitSha: string;
  baseSha: string;
  headSha: string;
  writeScope: string[];
}

export interface CommitRevertPlan {
  ownedCommits: string[];
  revertCommits: string[];
  uncertain: Array<{ commitSha: string; reason: string }>;
  question?: string;
}

export interface SteeringBacktrackOptions {
  repoRoot: string;
  slug: string;
  instruction: SteeringInstruction;
  decision: SteeringDecision;
  workflowId: string;
  confirmCompletedWork?: (summary: BacktrackConfirmationSummary) => Promise<boolean>;
  planner?: TeamMember;
  sp?: SpawnAgentReturning;
  transcript?: TranscriptHandle;
  signal?: AbortSignal;
  commitLedger?: CommitLedgerEntry[];
  executeConfirmedReverts?: boolean;
}

export interface BacktrackConfirmationSummary {
  instructionId: string;
  decisionId: string;
  replayMilestones: string[];
  replayStories: string[];
  affectedFiles: string[];
  revertCommits: string[];
  uncertainCommits: Array<{ commitSha: string; reason: string }>;
  message: string;
}

export interface SteeringBacktrackResult {
  status: "applied" | "rejected" | "requires-user-confirmation";
  impact: PlanImpact;
  trackerChanged: boolean;
  planChanged: boolean;
  executionStrategyChanged: boolean;
  revertPlan: CommitRevertPlan;
  summary: string;
}

export async function applySteeringBacktrack(options: SteeringBacktrackOptions): Promise<SteeringBacktrackResult> {
  const planRoot = planFolderPathFromRoot(path.join(options.repoRoot, PLAN_FOLDER_ROOT), options.slug); // migration-allowed: legacy
  const tracker = await parseStoryTracker(options.repoRoot, options.slug);
  const executionStrategy = await loadExecutionStrategyForPlanFolder(options.repoRoot, options.slug).catch(() => undefined);
  const impact = analyzePlanImpact({
    tracker,
    decision: options.decision,
    instruction: options.instruction,
    executionStrategy,
  });
  const revertPlan = await planCommitReverts({
    repoRoot: options.repoRoot,
    workflowId: options.workflowId,
    entries: options.commitLedger ?? [],
    storyIds: impact.replayStories,
    milestoneIds: impact.replayMilestones,
  });

  if (impact.requiresCompletedWorkConfirmation || revertPlan.ownedCommits.length > 0 || revertPlan.uncertain.length > 0) {
    const summary = buildBacktrackConfirmationSummary(options, impact, revertPlan);
    if (!options.confirmCompletedWork) {
      return { status: "requires-user-confirmation", impact, trackerChanged: false, planChanged: false, executionStrategyChanged: false, revertPlan, summary: summary.message };
    }
    const confirmed = await options.confirmCompletedWork(summary);
    if (!confirmed) {
      return { status: "rejected", impact, trackerChanged: false, planChanged: false, executionStrategyChanged: false, revertPlan, summary: "User declined completed-work backtracking." };
    }
    if (revertPlan.uncertain.length > 0) {
      return { status: "requires-user-confirmation", impact, trackerChanged: false, planChanged: false, executionStrategyChanged: false, revertPlan, summary: revertPlan.question ?? "Commit ownership is uncertain." };
    }
  }

  const willMutatePlanFolder =
    options.decision.planPatchRequired
    || options.decision.amendedUserFacingPlanText !== undefined
    || impact.replayStories.length > 0
    || impact.replayMilestones.length > 0
    || impact.planStructureChanged;
  if (willMutatePlanFolder) {
    await appendBacktrackRecoveryHint(planRoot, options, impact, revertPlan);
  }

  let planChanged = false;
  if (options.decision.planPatchRequired || options.decision.amendedUserFacingPlanText !== undefined) {
    planChanged = await amendMilestonePlan(options);
  }

  let trackerRaw = tracker.raw;
  let trackerChanged = false;
  if (planChanged) {
    const planText = await readFile(path.join(planRoot, "milestone-plan.md"), "utf8");
    trackerRaw = mergeDerivedTrackerWithExisting(deriveStoryTrackerFromPlan(planText), tracker.raw);
    if (trackerRaw !== tracker.raw) {
      await atomicWrite(path.join(planRoot, "story-tracker.md"), trackerRaw);
      trackerChanged = true;
    }
  }
  if (impact.replayStories.length > 0 || impact.replayMilestones.length > 0) {
    const trackerPath = path.join(planRoot, "story-tracker.md");
    const prior = trackerChanged ? trackerRaw : await readFile(trackerPath, "utf8");
    const next = updateTrackerForReplay(prior, impact, options.decision);
    if (next !== prior) {
      await atomicWrite(trackerPath, next);
      trackerChanged = true;
    }
  }

  let executionStrategyChanged = false;
  if (impact.planStructureChanged) {
    const updatedTracker = trackerChanged ? parseTrackerText(await readFile(path.join(planRoot, "story-tracker.md"), "utf8")) : tracker;
    await atomicWrite(
      path.join(planRoot, "execution-strategy.json"),
      `${JSON.stringify(buildSequentialExecutionStrategyArtifact(updatedTracker), null, 2)}\n`,
    );
    executionStrategyChanged = true;
  }

  if (options.executeConfirmedReverts && revertPlan.revertCommits.length > 0) {
    for (const commit of revertPlan.revertCommits) await git(options.repoRoot, ["revert", "--no-edit", commit]);
  }

  if (planChanged || trackerChanged || executionStrategyChanged || revertPlan.revertCommits.length > 0) {
    await appendSteeringTranscript(planRoot, options, impact, revertPlan);
  }
  await options.transcript?.record({
    role: "system",
    label: "steering-backtrack",
    status: "OK",
    body: JSON.stringify({ instruction: options.instruction, decision: options.decision, impact, revertPlan }, null, 2),
    meta: { instructionId: options.instruction.id, decisionId: options.decision.id },
  });

  return {
    status: "applied",
    impact,
    trackerChanged,
    planChanged,
    executionStrategyChanged,
    revertPlan,
    summary: `Applied steering backtrack for ${impact.replayStories.length} stories and ${impact.replayMilestones.length} milestones.`,
  };
}

function deriveStoryTrackerFromPlan(plan: string): string {
  const milestones: Array<{ id: string; title: string; stories: Array<{ id: string; description: string }> }> = [];
  const lines = plan.split(/\r?\n/);
  let current: { id: string; title: string; stories: Array<{ id: string; description: string }> } | undefined;
  for (const line of lines) {
    const milestone = line.match(/^#{2,4}\s+(M\d+)\s*[:.\-]?\s*(.*)$/);
    if (milestone) {
      current = { id: milestone[1], title: milestone[2].trim() || milestone[1], stories: [] };
      milestones.push(current);
      continue;
    }
    if (!current) continue;
    const story = line.match(/^\s*(?:[-*+]|\d+\.)\s+\*\*(S-[A-Za-z0-9]+)\s*[—-]\s*([^*]+)\*\*/);
    if (story) current.stories.push({ id: story[1], description: story[2].trim() });
  }
  if (milestones.length === 0) milestones.push({ id: "M0", title: "Initial milestone", stories: [{ id: "S-001", description: "Initial story" }] });
  for (const milestone of milestones) {
    if (milestone.stories.length === 0) milestone.stories.push({ id: `S-${milestone.id.slice(1)}01`, description: milestone.title });
  }
  const out = ["# Story Tracker\n", "## Milestones\n"];
  for (const milestone of milestones) {
    out.push(`### ${milestone.id}: ${milestone.title}\n`);
    out.push("| Story | Description | Status | Notes |");
    out.push("|-------|-------------|--------|-------|");
    for (const story of milestone.stories) out.push(`| ${story.id} | ${story.description.replace(/\|/g, "\\|")} | pending | |`);
    out.push("");
    out.push("**Approval Status:** pending\n");
  }
  return out.join("\n");
}

export function mergeDerivedTrackerWithExisting(derivedRaw: string, existingRaw: string): string {
  const existing = parseTrackerText(existingRaw);
  const storyState = new Map<string, { status: string; notes: string }>();
  const approvals = new Map<string, string>();
  for (const milestone of existing.milestones) {
    if (milestone.approvalStatus) approvals.set(milestone.id, milestone.approvalStatus);
    for (const story of milestone.stories) storyState.set(story.id, { status: story.status, notes: story.notes });
  }

  const lines = derivedRaw.split("\n");
  let currentMilestone: string | undefined;
  let inTable = false;
  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^###\s+(M\d+):/);
    if (header) {
      currentMilestone = header[1];
      inTable = false;
      continue;
    }
    if (currentMilestone && /^\*\*Approval Status:\*\*/.test(lines[i])) {
      const prior = approvals.get(currentMilestone);
      if (prior) lines[i] = `**Approval Status:** ${prior}`;
      continue;
    }
    if (lines[i].trim().startsWith("|") && /\|\s*Story\s*\|/i.test(lines[i])) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (lines[i].trim().length === 0 || !lines[i].trim().startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\s*\|\s*-/.test(lines[i])) continue;
    const cells = lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 4) continue;
    const prior = storyState.get(cells[0]);
    if (!prior) continue;
    lines[i] = `| ${cells[0]} | ${cells[1]} | ${prior.status} | ${prior.notes} |`;
  }
  return lines.join("\n");
}

export async function planCommitReverts(input: {
  repoRoot: string;
  workflowId: string;
  entries: CommitLedgerEntry[];
  storyIds?: string[];
  milestoneIds?: string[];
}): Promise<CommitRevertPlan> {
  const stories = new Set(input.storyIds ?? []);
  const milestones = new Set(input.milestoneIds ?? []);
  const relevant = input.entries.filter((entry) =>
    (entry.storyId && stories.has(entry.storyId)) || (entry.milestoneId && milestones.has(entry.milestoneId))
  );
  const ownedCommits: string[] = [];
  const uncertain: Array<{ commitSha: string; reason: string }> = [];
  for (const entry of relevant) {
    const reason = await commitOwnershipFailure(input.repoRoot, input.workflowId, entry, relevant);
    if (reason) uncertain.push({ commitSha: entry.commitSha, reason });
    else ownedCommits.push(entry.commitSha);
  }
  return {
    ownedCommits,
    revertCommits: [...ownedCommits].reverse(),
    uncertain,
    question: uncertain.length > 0
      ? `Commit ownership is uncertain for ${uncertain.map((item) => `${item.commitSha}: ${item.reason}`).join("; ")}. Confirm manually before reverting.`
      : undefined,
  };
}

async function appendBacktrackRecoveryHint(
  planRoot: string,
  options: SteeringBacktrackOptions,
  impact: PlanImpact,
  revertPlan: CommitRevertPlan,
): Promise<void> {
  const section = [
    "",
    `## Steering Backtrack Recovery Hint ${new Date().toISOString()}`,
    "",
    `Instruction: ${options.instruction.id}`,
    `Decision: ${options.decision.id}`,
    "",
    "The steering engine is about to update canonical plan artifacts. If the run fails mid-update, compare the following intended impact against milestone-plan.md, story-tracker.md, and execution-strategy.json before resuming.",
    "",
    JSON.stringify({ impact, revertPlan }, null, 2),
    "",
  ].join("\n");
  await appendFile(path.join(planRoot, "final-transcript.md"), section, "utf8").catch(() => undefined);
}

export function updateTrackerForReplay(raw: string, impact: PlanImpact, decision: SteeringDecision): string {
  const replayStories = new Set(impact.replayStories);
  const replayMilestones = new Set(impact.replayMilestones);
  const lines = raw.split("\n");
  let currentMilestone: string | undefined;
  let inTable = false;

  for (let i = 0; i < lines.length; i += 1) {
    const header = lines[i].match(/^###\s+(M\d+):/);
    if (header) {
      currentMilestone = header[1];
      inTable = false;
      continue;
    }
    if (currentMilestone && replayMilestones.has(currentMilestone) && /^\*\*Approval Status:\*\*/.test(lines[i])) {
      if (/approved/i.test(lines[i])) {
        lines[i] = `**Approval Status:** needs-rework (superseded by steering ${decision.id})`;
      }
      continue;
    }
    if (lines[i].trim().startsWith("|") && /\|\s*Story\s*\|/i.test(lines[i])) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (lines[i].trim().length === 0 || !lines[i].trim().startsWith("|")) {
      inTable = false;
      continue;
    }
    if (/^\s*\|\s*-/.test(lines[i])) continue;
    const cells = lines[i].trim().slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !replayStories.has(cells[0])) continue;
    const priorStatus = cells[2];
    const priorNotes = cells.slice(3).join(" | ").trim();
    const nextStatus = /^completed$/i.test(priorStatus) ? "needs-rework" : "pending";
    const notes = priorNotes
      ? `Superseded By Steering ${decision.id}: prior ${priorStatus} (${priorNotes})`
      : `Superseded By Steering ${decision.id}: prior ${priorStatus}`;
    lines[i] = `| ${cells[0]} | ${cells[1]} | ${nextStatus} | ${notes} |`;
  }
  return lines.join("\n");
}

function buildBacktrackConfirmationSummary(
  options: SteeringBacktrackOptions,
  impact: PlanImpact,
  revertPlan: CommitRevertPlan,
): BacktrackConfirmationSummary {
  const message = [
    "Apply steering backtrack to completed work?",
    "",
    `Instruction: ${options.instruction.text}`,
    `Decision: ${options.decision.summary}`,
    "",
    `Replay milestones: ${impact.replayMilestones.join(", ") || "(none)"}`,
    `Replay stories: ${impact.replayStories.join(", ") || "(none)"}`,
    `Affected files: ${options.decision.affectedFiles.join(", ") || "(none)"}`,
    `Revert commits: ${revertPlan.revertCommits.join(", ") || "(none)"}`,
    `Uncertain commits: ${revertPlan.uncertain.map((item) => `${item.commitSha} (${item.reason})`).join(", ") || "(none)"}`,
  ].join("\n");
  return {
    instructionId: options.instruction.id,
    decisionId: options.decision.id,
    replayMilestones: impact.replayMilestones,
    replayStories: impact.replayStories,
    affectedFiles: options.decision.affectedFiles,
    revertCommits: revertPlan.revertCommits,
    uncertainCommits: revertPlan.uncertain,
    message,
  };
}

async function amendMilestonePlan(options: SteeringBacktrackOptions): Promise<boolean> {
  const planPath = path.join(planFolderPathFromRoot(path.join(options.repoRoot, PLAN_FOLDER_ROOT), options.slug), "milestone-plan.md"); // migration-allowed: legacy
  const prior = await readFile(planPath, "utf8");
  let next = prior;
  if (options.sp && options.planner && options.transcript) {
    const revision = await revisePlanWithPatchOrFallback({
      mode: "patch",
      priorPlan: prior,
      findings: {
        findings: {
          P0: [],
          P1: [],
          P2: [`Apply steering instruction ${options.instruction.id}: ${options.instruction.text}`],
          P3: [],
        },
      },
      planner: options.planner,
      sp: options.sp,
      signal: options.signal,
      transcript: options.transcript,
      round: 1,
      label: "steering milestone plan amendment",
      errorPrefix: "steering plan amendment failed",
      composeFullPrompt: () => [
        "Rewrite the milestone plan to incorporate this steering instruction.",
        "",
        "Instruction:",
        options.instruction.text,
        "",
        "Prior plan:",
        prior,
      ].join("\n"),
      extraContext: "This is a steering-driven amendment. Update only canonical plan content needed for the instruction.",
    });
    next = revision.plan;
  } else if (options.decision.amendedUserFacingPlanText) {
    next = appendPlanAmendment(prior, options);
  }
  if (next === prior) return false;
  await atomicWrite(planPath, next);
  return true;
}

function appendPlanAmendment(prior: string, options: SteeringBacktrackOptions): string {
  return [
    prior.trimEnd(),
    "",
    `## Steering Amendment ${options.decision.id}`,
    "",
    `Instruction ${options.instruction.id}: ${options.instruction.text}`,
    "",
    options.decision.amendedUserFacingPlanText ?? options.decision.summary,
    "",
  ].join("\n");
}

async function appendSteeringTranscript(
  planRoot: string,
  options: SteeringBacktrackOptions,
  impact: PlanImpact,
  revertPlan: CommitRevertPlan,
): Promise<void> {
  const section = [
    "",
    `## Steering Amendment ${new Date().toISOString()}`,
    "",
    `Instruction: ${options.instruction.id}`,
    "",
    options.instruction.text,
    "",
    `Decision: ${options.decision.id}`,
    "",
    options.decision.summary,
    "",
    "Impact:",
    JSON.stringify({ impact, revertPlan }, null, 2),
    "",
  ].join("\n");
  await appendFile(path.join(planRoot, "final-transcript.md"), section, "utf8").catch(() => undefined);
}

async function commitOwnershipFailure(
  repoRoot: string,
  workflowId: string,
  entry: CommitLedgerEntry,
  relevantEntries: CommitLedgerEntry[],
): Promise<string | undefined> {
  if (entry.workflowId !== workflowId) return "commit was not created by this workflow";
  if (!entry.writeScope || entry.writeScope.length === 0) return "missing recorded write scope";
  const revList = (await git(repoRoot, ["rev-list", "--reverse", `${entry.baseSha}..${entry.headSha}`])).trim().split(/\r?\n/).filter(Boolean);
  if (!revList.includes(entry.commitSha)) return "recorded base/head pair does not contain commit";
  const relevantCommits = new Set(relevantEntries.map((item) => item.commitSha));
  const interleaved = revList.filter((commit) => !relevantCommits.has(commit));
  if (interleaved.length > 0) return `unrecorded commit(s) interleaved: ${interleaved.join(", ")}`;
  const changedFiles = (await git(repoRoot, ["diff-tree", "--no-commit-id", "--name-only", "-r", entry.commitSha])).trim().split(/\r?\n/).filter(Boolean);
  const outside = changedFiles.filter((file) => !entry.writeScope.some((scope) => file === scope || file.startsWith(`${scope.replace(/\/$/, "")}/`)));
  if (outside.length > 0) return `changed files outside write scope: ${outside.join(", ")}`;
  return undefined;
}

async function atomicWrite(filePath: string, body: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, filePath);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}
