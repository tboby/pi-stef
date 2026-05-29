import type { SteeringDecisionKind, SteeringGuidanceScopeKind } from "../types";

export const DECISION_KINDS: ReadonlySet<SteeringDecisionKind> = new Set([
  "apply-to-future",
  "queue-for-safe-boundary",
  "restart-running-agents",
  "stop-running-agents",
  "discard-running-agent-changes",
  "amend-plan",
  "backtrack-completed-work",
  "ask-user",
  "reject",
]);

export const DECISION_ALIASES: Readonly<Record<string, SteeringDecisionKind>> = {
  "apply-to-future": "apply-to-future",
  "queue-for-safe-boundary": "queue-for-safe-boundary",
  "restart-running-agents": "restart-running-agents",
  "stop-running-agents": "stop-running-agents",
  "discard-running-agent-changes": "discard-running-agent-changes",
  "amend-plan": "amend-plan",
  "backtrack-completed-work": "backtrack-completed-work",
  "ask-user": "ask-user",
  "reject": "reject",
  "future": "apply-to-future",
  "note": "apply-to-future",
  "inject-note": "apply-to-future",
  "add-note": "apply-to-future",
  "workflow-note": "apply-to-future",
  "broadcast-note": "apply-to-future",
  "queue": "queue-for-safe-boundary",
  "question": "ask-user",
  "defer": "reject",
  "ignore": "reject",
  "none": "reject",
  "noop": "reject",
  "no-op": "reject",
  "no-change": "reject",
};

const SUPPORTED_ACTION_PLAN_TYPES: ReadonlySet<string> = new Set([
  "restart-agent",
  "restart-agents",
  "stop-agent",
  "stop-agents",
  "abort-agent",
  "abort-agents",
  "discard-agent-changes",
  "discard-changes",
  "amend-plan",
  "ask-user",
  "question",
  "note",
  "inject-note",
  "add-note",
  "workflow-note",
  "broadcast-note",
  "apply-to-future",
  "queue",
  "queue-for-safe-boundary",
  "reject",
  "defer",
  "ignore",
  "none",
  "noop",
  "no-op",
]);

const PLAN_GUIDANCE_ACTION_TYPES: ReadonlySet<string> = new Set([
  "amend-plan",
  "ask-user",
  "question",
  "note",
  "inject-note",
  "add-note",
  "workflow-note",
  "broadcast-note",
]);

const NO_OP_ACTION_TYPES: ReadonlySet<string> = new Set([
  "reject",
  "defer",
  "ignore",
  "none",
  "noop",
  "no-op",
]);

export interface NormalizedDecision {
  kind: SteeringDecisionKind;
  targetAgents: string[];
  abortAgents: string[];
  discardAgentChanges: string[];
  planPatchRequired: boolean;
  asksUser: boolean;
  summary?: string;
  rationale?: string;
  requiresConfirmation: boolean;
  amendedUserFacingPlanText?: string;
  agentRestartInstructions?: Record<string, string>;
  risks: string[];
  warnings: string[];
  scopeKind?: SteeringGuidanceScopeKind;
  scopeTarget?: string;
  guidanceText?: string;
}

const SCOPE_KINDS: ReadonlySet<SteeringGuidanceScopeKind> = new Set([
  "workflow",
  "milestone",
  "story",
  "role",
]);

function readScopeKind(value: unknown): SteeringGuidanceScopeKind | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = normalizeDecisionToken(value);
  return SCOPE_KINDS.has(normalized as SteeringGuidanceScopeKind)
    ? (normalized as SteeringGuidanceScopeKind)
    : undefined;
}

export class UnsupportedActionShapeError extends Error {
  readonly code = "STEER_UNKNOWN_ACTION_SHAPE";
  readonly rawDecision: unknown;
  constructor(message: string, rawDecision: unknown) {
    super(message);
    this.name = "UnsupportedActionShapeError";
    this.rawDecision = rawDecision;
  }
}

export function normalizeDeciderOutput(rawText: string): NormalizedDecision {
  const jsonText = extractJsonObject(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Unable to parse steering decision JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new UnsupportedActionShapeError(
      "STEER_UNKNOWN_ACTION_SHAPE: expected JSON object",
      parsed,
    );
  }

  const actionPlan = parseActionPlanShorthand(parsed);
  if (actionPlan) return actionPlan;

  const candidates = Array.isArray(parsed.decisions)
    ? parsed.decisions.filter(isRecord)
    : [parsed];
  for (const candidate of candidates) {
    const decision = parseShorthandDecisionObject(candidate);
    if (decision) return decision;
  }

  throw new UnsupportedActionShapeError(
    `STEER_UNKNOWN_ACTION_SHAPE: no recognizable steering decision shape in: ${truncateForError(jsonText)}`,
    parsed,
  );
}

function parseShorthandDecisionObject(parsed: Record<string, unknown>): NormalizedDecision | undefined {
  const rawDecisions = collectStrings(parsed.decision, parsed.action, parsed.kind);
  // The summary fallback also considers `guidanceText` / `guidance` so the
  // canonical tight apply-to-future shape (`{ kind: "apply-to-future",
  // guidanceText, scopeKind, requiresConfirmation }`) round-trips through
  // the normalize layer when strict-parse rejects it for missing the
  // SteeringDecision boilerplate (id, instructionId, decidedAt, etc.).
  // Without this, a well-formed contract response with no separate
  // `summary` field would propagate as STEER_UNKNOWN_ACTION_SHAPE.
  const summary = firstNonBlankString(
    parsed.summary,
    parsed.note,
    parsed.message,
    parsed.messageForAgents,
    parsed.reason,
    parsed.notes,
    parsed.details,
    parsed.rationale,
    parsed.guidanceText,
    parsed.guidance,
    parsed.text,
  );
  if (rawDecisions.length === 0 || !summary) return undefined;
  for (const rawDecision of rawDecisions) {
    const targetAgents = shorthandTargetAgents(parsed, rawDecision);
    const kind = resolveDecisionAlias(rawDecision, targetAgents.length > 0);
    if (!kind) continue;
    const amendedUserFacingPlanText = firstNonBlankString(
      parsed.messageForAgents,
      parsed.notes,
      parsed.details,
      parsed.note,
    );
    const rationale = firstNonBlankString(parsed.rationale, parsed.reason)
      ?? `The spawned steering decider returned shorthand decision "${rawDecision}".`;
    const guidanceText = kind === "apply-to-future"
      ? firstNonBlankString(
        parsed.guidanceText,
        parsed.guidance,
        parsed.note,
        parsed.message,
        parsed.text,
        amendedUserFacingPlanText,
        summary,
      )
      : undefined;
    return {
      kind,
      targetAgents,
      abortAgents: [],
      discardAgentChanges: [],
      planPatchRequired: kind === "amend-plan" || kind === "backtrack-completed-work",
      asksUser: kind === "ask-user",
      summary,
      rationale,
      requiresConfirmation: typeof parsed.requiresConfirmation === "boolean" ? parsed.requiresConfirmation : false,
      amendedUserFacingPlanText,
      risks: collectStrings(parsed.confirmationReason, parsed.risks),
      warnings: [],
      scopeKind: readScopeKind(parsed.scopeKind ?? parsed.scope),
      scopeTarget: firstNonBlankString(parsed.scopeTarget, parsed.scope_target, parsed.target),
      guidanceText,
    };
  }
  return undefined;
}

function parseActionPlanShorthand(parsed: Record<string, unknown>): NormalizedDecision | undefined {
  if (!Array.isArray(parsed.actions)) return undefined;
  const actions = parsed.actions.filter(isRecord);
  if (actions.length === 0) return undefined;

  const unsupportedTypes = unsupportedActionTypes(actions);
  if (unsupportedTypes.length > 0) {
    throw new UnsupportedActionShapeError(
      `STEER_UNKNOWN_ACTION_SHAPE: unsupported actions[] type(s): ${unsupportedTypes.join(", ")}`,
      parsed,
    );
  }

  const targetAgents = collectActionTargets(actions, ["restart-agent", "restart-agents"]);
  const abortAgents = collectActionTargets(actions, [
    "stop-agent",
    "stop-agents",
    "abort-agent",
    "abort-agents",
  ]);
  const discardAgentChanges = collectActionTargets(actions, [
    "discard-agent-changes",
    "discard-changes",
  ]);
  const planPatchRequired = actions.some((action) => actionType(action) === "amend-plan");
  const asksUser = actions.some(
    (action) => actionType(action) === "ask-user" || actionType(action) === "question",
  );
  const onlyNoOps = actions.every((action) => NO_OP_ACTION_TYPES.has(actionType(action)));
  const agentRestartInstructions = collectAgentRestartInstructions(actions);

  const kind: SteeringDecisionKind = targetAgents.length > 0
    ? "restart-running-agents"
    : abortAgents.length > 0
      ? "stop-running-agents"
      : discardAgentChanges.length > 0
        ? "discard-running-agent-changes"
        : planPatchRequired
          ? "amend-plan"
          : asksUser
            ? "ask-user"
            : onlyNoOps
              ? "reject"
              : "apply-to-future";

  const amendedUserFacingPlanText = [
    firstNonBlankString(parsed.amendedUserFacingPlanText, parsed.messageForAgents, parsed.notes),
    ...actions
      .filter((action) => PLAN_GUIDANCE_ACTION_TYPES.has(actionType(action)))
      .map((action) => {
        const guidance = firstNonBlankString(
          action.guidance,
          action.message,
          action.note,
          action.text,
          action.summary,
          action.details,
        );
        if (!guidance) return undefined;
        const target = firstNonBlankString(action.target, action.targetAgentId);
        return target ? `${actionType(action)} ${target}: ${guidance}` : `${actionType(action)}: ${guidance}`;
      })
      .filter((line): line is string => line !== undefined),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const planNoteAction = actions.find((action) =>
    PLAN_GUIDANCE_ACTION_TYPES.has(actionType(action)),
  );
  const guidanceText = kind === "apply-to-future"
    ? firstNonBlankString(
      parsed.guidanceText,
      parsed.guidance,
      parsed.note,
      parsed.message,
      planNoteAction?.guidance,
      planNoteAction?.message,
      planNoteAction?.note,
      planNoteAction?.text,
      planNoteAction?.details,
      amendedUserFacingPlanText.length > 0 ? amendedUserFacingPlanText : undefined,
    )
    : undefined;

  return {
    kind,
    targetAgents,
    abortAgents,
    discardAgentChanges,
    planPatchRequired,
    asksUser,
    summary: firstNonBlankString(parsed.summary, parsed.message, parsed.reason),
    rationale: firstNonBlankString(parsed.rationale, parsed.reason, parsed.confirmationReason),
    requiresConfirmation: typeof parsed.requiresConfirmation === "boolean" ? parsed.requiresConfirmation : false,
    amendedUserFacingPlanText: amendedUserFacingPlanText.length > 0 ? amendedUserFacingPlanText : undefined,
    agentRestartInstructions: Object.keys(agentRestartInstructions).length > 0 ? agentRestartInstructions : undefined,
    risks: collectStrings(parsed.confirmationReason, parsed.risks),
    warnings: [],
    scopeKind: readScopeKind(parsed.scopeKind ?? parsed.scope),
    scopeTarget: firstNonBlankString(parsed.scopeTarget, parsed.scope_target),
    guidanceText,
  };
}

function unsupportedActionTypes(actions: Array<Record<string, unknown>>): string[] {
  return [
    ...new Set(
      actions
        .map(actionType)
        .filter((type) => !SUPPORTED_ACTION_PLAN_TYPES.has(type)),
    ),
  ];
}

function collectAgentRestartInstructions(
  actions: Array<Record<string, unknown>>,
): Record<string, string> {
  const byAgent = new Map<string, string[]>();
  for (const action of actions) {
    if (!["restart-agent", "restart-agents"].includes(actionType(action))) continue;
    const guidance = firstNonBlankString(
      action.guidance,
      action.message,
      action.note,
      action.text,
      action.summary,
      action.details,
    );
    if (!guidance) continue;
    for (const agentId of collectStrings(...actionTargets(action))) {
      const entries = byAgent.get(agentId) ?? [];
      entries.push(guidance);
      byAgent.set(agentId, entries);
    }
  }
  return Object.fromEntries(
    [...byAgent.entries()].map(([agentId, entries]) => [agentId, entries.join("\n")]),
  );
}

function collectActionTargets(
  actions: Array<Record<string, unknown>>,
  matchingTypes: string[],
): string[] {
  const matching = new Set(matchingTypes);
  return collectStrings(
    ...actions
      .filter((action) => matching.has(actionType(action)))
      .flatMap(actionTargets),
  );
}

function actionTargets(action: Record<string, unknown>): unknown[] {
  return [
    action.target,
    action.targetAgentId,
    action.targetAgentIds,
    action.targetAgents,
    action.agentId,
    action.agentIds,
    action.agents,
  ];
}

function actionType(action: Record<string, unknown>): string {
  return normalizeDecisionToken(
    firstNonBlankString(action.type, action.action, action.kind) ?? "action",
  );
}

export function resolveDecisionAlias(
  rawDecision: string,
  hasTargets = false,
): SteeringDecisionKind | undefined {
  const normalized = normalizeDecisionToken(rawDecision);
  const direct = DECISION_ALIASES[normalized];
  if (direct) return direct;
  if (normalized.startsWith("forward-to-")) return "restart-running-agents";
  if (normalized === "forward" || normalized === "route") {
    return hasTargets ? "restart-running-agents" : "apply-to-future";
  }
  return undefined;
}

function shorthandTargetAgents(value: Record<string, unknown>, rawDecision: string): string[] {
  const explicit = collectStrings(
    value.target,
    value.targetAgentId,
    value.targetAgentIds,
    value.targetAgents,
    value.agentId,
    value.agentIds,
    value.agents,
    value.broadcastToAgents,
  );
  if (explicit.length > 0) return explicit;

  const normalized = normalizeDecisionToken(rawDecision);
  const forwardPrefix = "forward-to-";
  if (!normalized.startsWith(forwardPrefix)) return [];
  const suffix = normalized.slice(forwardPrefix.length);
  return suffix.length > 0 ? [suffix] : [];
}

export function normalizeDecisionToken(value: string): string {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function collectStrings(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      out.push(value.trim());
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.trim().length > 0) out.push(item.trim());
      }
    }
  }
  return [...new Set(out)];
}

export function firstNonBlankString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  throw new Error("Unable to parse steering decision JSON: no JSON object found");
}

function truncateForError(text: string, maxLen = 240): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…[truncated]`;
}
