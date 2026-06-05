import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

import { SfTeamToolError } from "../errors";
import { createSfTeamPlan, type AgentSettingsDetails, type SfTeamPlanInput, type ResearcherDecision } from "./plan";
import { createSfTeamImplement, type SfTeamImplementInput, type SfTeamImplementResult } from "./implement";
import { DEFAULT_CONFIG } from "../config/schema";
import { effectiveUi, isHeadlessWorkflow } from "../config/workflow";
import { getActiveSession, TmuxManager } from "../tmux/manager";
import { requireGitOrSkip } from "../worktree/validate";
import { normalOrResumeValue, resolveToolResume } from "./resume";
import { defaultDeps, type ToolDeps } from "./shared";
import { verificationDefaultsForAutoImplement, verificationDefaultsForPlanPhase, type SfTeamVerificationConfigInput } from "./verification-stage";
import type { CostSummary } from "../orchestrator/cost";

/**
 * Probe tmux ONCE for the next-available `sf_team_auto-N` alias. Used
 * by `sf_team_auto` so its plan + implement nested orchestrator runs
 * land on the same session instead of fighting over `sf_team_plan-1`
 * vs `sf_team_implement-1`. Returns `undefined` outside of tmux or
 * when probing fails (the orchestrator will then fall back to its
 * per-tool default).
 */
function resolveAutoSessionAlias(): string | undefined {
  try {
    if (!getActiveSession()) return undefined;
    return new TmuxManager().nextSessionAlias("sf_team_auto");
  } catch (err) {
    console.debug("[team]", err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

export interface SfTeamAutoInput {
  /** Title for the new plan + brief for the planner. */
  title?: string;
  resume?: string;
  brief?: string;
  maxRounds?: number;
  /** Override implement-phase verifyCommand (false skips). */
  verifyCommand?: SfTeamImplementInput["verifyCommand"];
  verification?: SfTeamVerificationConfigInput;
  /** Branch prefix for the new branch (default 'auto/'). */
  branchPrefix?: string;
  /**
   * Inter-milestone pause. Defaults to `ctx.configDefaults?.auto.pause_between_milestones`
   * (which itself defaults to `false` so end-to-end auto runs do not stop).
   * Set to `true` to make the auto run prompt between milestones.
   */
  pauseBetweenMilestones?: boolean;
}

export interface SfTeamAutoResult {
  slug: string;
  planRounds: number;
  implement: SfTeamImplementResult;
  agentSettings: AgentSettingsDetails;
  researcherDecision: ResearcherDecision;
  performanceReportPaths: string[];
  costSummary?: CostSummary;
}

/**
 * sf_team_auto: chains sf_team_plan and sf_team_implement (D2 default).
 * No human gates between — runs end-to-end. Still asks before push (the
 * implement tool's pr-description doesn't push).
 */
export function createSfTeamAuto(rawDeps: Partial<ToolDeps> = {}) {
  const deps: ToolDeps = { ...defaultDeps, ...rawDeps };
  const planTool = createSfTeamPlan(deps);
  const implementTool = createSfTeamImplement(deps);

  return async function sfTeamAuto(
    input: SfTeamAutoInput,
    ctx: {
      repoRoot: string;
      signal?: AbortSignal;
      ui?: ExtensionUIContext;
      configDefaults?: import("../config/schema").ResolvedDefaults;
      /**
       * Pi tool name (`sf_team_auto`) fronting
       * this run. Used by typed errors so the `FAILED:` envelope names
       * the auto surface, not the inner implement surface, when
       * implement-side errors propagate up.
       */
      toolName?: string;
      /** When 'off', skip all git operations (no worktree, no commit, no PR). */
      gitMode?: "on" | "off";
      tddMode?: "on" | "off" | "auto";
      /** Resolved planRoot for resume discovery cascade. */
      planRoot?: string;
      /** Raw prompt value for gitMode before runtime resolution; used for resume precedence. */
      rawGitMode?: "auto" | "on" | "off";
      /** Raw prompt value for tddMode before runtime resolution; used for resume precedence. */
      rawTddMode?: "auto" | "on" | "off";
    },
  ): Promise<SfTeamAutoResult> {
    const autoToolName = ctx.toolName ?? "sf_team_auto";
    const autoResumeTool = "sf_team_resume";
    // Preflight: auto chains plan + implement; the implement phase WILL
    // create a worktree and commit in git mode. Fail fast here BEFORE
    // the planner runs so the user doesn't burn a full plan-review loop
    // against a non-git folder. In no-git mode, skip this check.
    const resume = await resolveToolResume({
      repoRoot: ctx.repoRoot,
      toolName: "sf_team_auto",
      input,
      normalField: "title",
      candidatePlanRoots: ctx.planRoot ? [ctx.planRoot] : undefined,
    });
    // Resume precedence: persisted gitMode/tddMode wins over auto-detected values.
    const effectiveGitMode: "on" | "off" =
      resume?.metadata?.gitMode != null && (ctx.rawGitMode === undefined || ctx.rawGitMode === "auto")
        ? resume.metadata.gitMode
        : (ctx.gitMode ?? "on");
    const effectiveTddMode: "on" | "off" | "auto" =
      resume?.metadata?.tddMode != null && (ctx.rawTddMode === undefined || ctx.rawTddMode === "auto")
        ? resume.metadata.tddMode
        : (ctx.tddMode ?? "auto");
    // effectivePlanRoot: prefer resume metadata's planRootPath (set when plan found via
    // global index or external candidatePlanRoots) over the prompt-resolved ctx.planRoot.
    const effectivePlanRoot = resume?.metadata?.planRootPath ?? ctx.planRoot;
    // Preflight git check after effective mode resolution so a slug-only resume
    // from a non-git cwd of a no-git workflow uses the persisted gitMode='off'.
    requireGitOrSkip({ repoRoot: ctx.repoRoot, gitMode: effectiveGitMode }, "sf_team_auto");
    const title = normalOrResumeValue(input, "title", resume);
    // Resolve a shared `sf_team_auto-N` alias up front so the plan and
    // implement phases decorate the SAME tmux session. Without this,
    // each phase would alias the launcher session under its own
    // toolName (`sf_team_plan-1`, `sf_team_implement-1`), and the
    // implement phase would fail to find the session it inherited
    // from the plan phase.
    const tmuxSessionAliasOverride = isHeadlessWorkflow(ctx.configDefaults) ? undefined : resolveAutoSessionAlias();
    const innerCtx = {
      ...ctx,
      ui: effectiveUi(ctx.ui, ctx.configDefaults),
      tmuxSessionAliasOverride,
      resumeOwnerTool: "sf_team_auto" as const,
      gitMode: effectiveGitMode,
      tddMode: effectiveTddMode,
      planRoot: effectivePlanRoot,
    };
    const baseDefaults = ctx.configDefaults ?? DEFAULT_CONFIG;

    const planInput: SfTeamPlanInput = resume
      ? { resume: resume.target.slug, maxRounds: input.maxRounds, writeFolder: false }
      : { title, brief: input.brief, maxRounds: input.maxRounds };
    const plan = await planTool(planInput, {
        ...innerCtx,
        configDefaults: verificationDefaultsForPlanPhase(baseDefaults, { invokedByAuto: true }),
        suppressPlanVerification: true,
      });
    const implementInput: Pick<SfTeamImplementInput, "resume" | "slug"> = resume
      ? { resume: plan.slug }
      : { slug: plan.slug };
    let implement: SfTeamImplementResult;
    try {
      implement = await implementTool(
        {
          ...implementInput,
          maxRounds: input.maxRounds,
          mode: ctx.configDefaults?.auto.mode ?? "all-milestones",
          branchPrefix: input.branchPrefix ?? ctx.configDefaults?.auto.branch_prefix ?? "auto/",
          useWorktree: ctx.configDefaults?.auto.use_worktree,
          // For sf_team_auto we resolve from `auto.*` rather than `implement.*`.
          // Falling through to `auto`'s default (false) keeps the headless
          // "run end-to-end" behavior unless the user explicitly opts in.
          // Explicit final fallback to DEFAULT_CONFIG.auto.* so that callers
          // without a configDefaults object still get the auto default
          // (false) and don't accidentally inherit implement's default (true).
          pauseBetweenMilestones:
            input.pauseBetweenMilestones
              ?? ctx.configDefaults?.auto.pause_between_milestones
              ?? DEFAULT_CONFIG.auto.pause_between_milestones,
          verifyCommand: input.verifyCommand,
          verification: input.verification,
        },
        {
          ...innerCtx,
          configDefaults: verificationDefaultsForAutoImplement(baseDefaults, input.verification),
          // The implement surface is always `sf_team_implement` (the
          // bare base name; the historical `_start` suffix was dropped
          // in the M1-collapse follow-up). Auto's outer try/catch
          // rewraps any SfTeamToolError via `withTool(...)` so the
          // user-facing FAILED:/RESUME: line names the auto surface and
          // points at `sf_team_resume`. (R3 P2: no post-throw
          // mutation of `Error.message`.)
          toolName: "sf_team_implement",
        },
      );
    } catch (err) {
      if (err instanceof SfTeamToolError) {
        throw err.withTool(autoToolName, autoResumeTool, { autoSlug: plan.slug, slug: plan.slug });
      }
      throw err;
    }
    return {
      slug: plan.slug,
      planRounds: plan.rounds,
      implement,
      agentSettings: plan.agentSettings,
      researcherDecision: plan.researcherDecision,
      performanceReportPaths: [plan.performanceReportPath, implement.performanceReportPath]
        .filter((value): value is string => !!value),
      costSummary: implement.costSummary ?? plan.costSummary,
    };
  };
}


