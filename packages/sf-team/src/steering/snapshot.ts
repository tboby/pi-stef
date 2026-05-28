import type { SteeringStore } from "./store";
import type { ActiveAgentState, SteeringWorkflowSnapshot } from "./types";
import type { SteeringWorkflowKind } from "./path-safety";

export interface BuildSteeringSnapshotInput {
  workflowId: string;
  workflowKind: SteeringWorkflowKind;
  store: SteeringStore;
  currentMilestoneId?: string;
  currentStoryId?: string;
  referencedPlanHashes?: Record<string, string>;
}

export async function buildSteeringSnapshot(input: BuildSteeringSnapshotInput): Promise<SteeringWorkflowSnapshot> {
  const active = await input.store.readActiveAgentsState();
  const referencedAgentStates: Record<string, ActiveAgentState> = {};
  for (const agent of active.records) referencedAgentStates[agent.id] = agent.state;
  return {
    workflowId: input.workflowId,
    workflowKind: input.workflowKind,
    activeAgentsVersion: active.version,
    referencedAgentStates,
    referencedPlanHashes: input.referencedPlanHashes ?? {},
    activeAgents: active.records,
    currentMilestoneId: input.currentMilestoneId,
    currentStoryId: input.currentStoryId,
  };
}
