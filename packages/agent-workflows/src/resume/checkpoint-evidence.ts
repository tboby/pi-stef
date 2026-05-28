import { readFile } from "node:fs/promises";
import path from "node:path";

import { CHECKPOINTS_FILE, WORKFLOW_FOLDER_NAME } from "../artifacts/paths";
import { parseCheckpointStore, type WorkflowCheckpointStore } from "../state/checkpoint-store";

export interface CheckpointEvidence {
  hasPlanPhaseCheckpoint: boolean;
  hasImplementationPhaseCheckpoint: boolean;
}

export const PLAN_PHASE_CHECKPOINT_RE = /^spawnText:planner:\d+$/;
export const IMPLEMENTATION_PHASE_CHECKPOINT_RE = /^spawnText:(developer|reviewer)-M[^:]+:\d+$/;

export function checkpointEvidenceFromStore(store: WorkflowCheckpointStore | undefined): CheckpointEvidence {
  const stepIds = Object.keys(store?.checkpoints ?? {});
  return {
    hasPlanPhaseCheckpoint: stepIds.some((stepId) => PLAN_PHASE_CHECKPOINT_RE.test(stepId)),
    hasImplementationPhaseCheckpoint: stepIds.some((stepId) => IMPLEMENTATION_PHASE_CHECKPOINT_RE.test(stepId)),
  };
}

export async function readCheckpointEvidenceFromFolder(folderPath: string): Promise<CheckpointEvidence> {
  const checkpointPath = path.join(folderPath, WORKFLOW_FOLDER_NAME, CHECKPOINTS_FILE);
  try {
    const raw = await readFile(checkpointPath, "utf8");
    return checkpointEvidenceFromStore(parseCheckpointStore(JSON.parse(raw)));
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") {
      return checkpointEvidenceFromStore(undefined);
    }
    throw err;
  }
}
