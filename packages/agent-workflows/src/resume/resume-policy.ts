import { readFile } from "node:fs/promises";
import path from "node:path";

import { WORKFLOW_FOLDER_NAME, WORKFLOW_METADATA_FILE } from "../artifacts/paths";
import { parseWorkflowMetadata, type WorkflowMetadata, type WorkflowToolName } from "../state/workflow-metadata";
import type { ResolvedPlanTarget } from "./resolve-plan-target";

export type ResumeOwnership = { kind: "metadata"; metadata: WorkflowMetadata };

export interface AssertResumeOwnershipInput {
  repoRoot: string;
  target: ResolvedPlanTarget;
  invokedTool: WorkflowToolName;
}

export async function assertResumeOwnership(input: AssertResumeOwnershipInput): Promise<ResumeOwnership> {
  const metadata = await readWorkflowMetadataFromFolder(input.target.folderPath);
  if (!metadata) {
    throw new Error(
      `workflow metadata not found for ${input.target.slug}; cannot verify resume ownership.`,
    );
  }
  return { kind: "metadata", metadata };
}

export async function readWorkflowMetadataFromFolder(folderPath: string): Promise<WorkflowMetadata | undefined> {
  const metadataPath = path.join(folderPath, WORKFLOW_FOLDER_NAME, WORKFLOW_METADATA_FILE);
  try {
    const raw = await readFile(metadataPath, "utf8");
    return parseWorkflowMetadata(JSON.parse(raw));
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
}
