export interface PlanRevisionMetrics {
  mode: "patch" | "full";
  patchAttempted: boolean;
  patchApplied: boolean;
  fallbackUsed: boolean;
  plannerOutputBytes: number;
  patchOutputBytes?: number;
  priorPlanBytes: number;
  finalPlanBytes: number;
  applyDurationMs?: number;
  operationCount?: number;
}
