import type { WorkflowMetadata, WorkflowToolName } from "../state/workflow-metadata";
import { assertResumeOwnership, type ResumeOwnership } from "./resume-policy";
import { resolvePlanTarget, type ResolvedPlanTarget } from "./resolve-plan-target";

export interface AnalyzeResumeTargetInput {
  repoRoot: string;
  target: string;
  invokedTool: WorkflowToolName;
  cwd?: string;
  /** Forwarded to resolvePlanTarget for the slug cascade. */
  candidatePlanRoots?: string[];
}

export interface ResumeAnalysis {
  target: ResolvedPlanTarget;
  ownership: ResumeOwnership;
  metadata?: WorkflowMetadata;
  legacy: boolean;
  phase?: string;
  currentStepId?: string;
  lastCompletedStepId?: string;
}

export async function analyzeResumeTarget(input: AnalyzeResumeTargetInput): Promise<ResumeAnalysis> {
  const target = await resolvePlanTarget({
    repoRoot: input.repoRoot,
    target: input.target,
    cwd: input.cwd,
    candidatePlanRoots: input.candidatePlanRoots,
  });
  const ownership = await assertResumeOwnership({
    repoRoot: input.repoRoot,
    target,
    invokedTool: input.invokedTool,
  });
  return {
    target,
    ownership,
    metadata: ownership.metadata,
    legacy: false,
    phase: ownership.metadata.phase,
    currentStepId: ownership.metadata.currentStepId,
    lastCompletedStepId: ownership.metadata.lastCompletedStepId,
  };
}
