import { describe, expect, it } from "vitest";

import {
  DECISION_ALIASES,
  DECISION_KINDS,
  normalizeDecisionToken,
  normalizeDeciderOutput,
  resolveDecisionAlias,
  UnsupportedActionShapeError,
} from "../src/steering/decider/normalize";
import type { SteeringDecisionKind } from "../src/steering/types";

describe("DECISION_ALIASES table", () => {
  const canonicalKinds: SteeringDecisionKind[] = [
    "apply-to-future",
    "queue-for-safe-boundary",
    "restart-running-agents",
    "stop-running-agents",
    "discard-running-agent-changes",
    "amend-plan",
    "backtrack-completed-work",
    "ask-user",
    "reject",
  ];

  it.each(canonicalKinds)("canonical kind %s round-trips through alias table", (kind) => {
    expect(DECISION_ALIASES[kind]).toBe(kind);
    expect(DECISION_KINDS.has(kind)).toBe(true);
  });

  it("known aliases resolve to canonical kinds", () => {
    expect(resolveDecisionAlias("future")).toBe("apply-to-future");
    expect(resolveDecisionAlias("note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("inject-note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("inject_note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("injectNote")).toBe("apply-to-future");
    expect(resolveDecisionAlias("add-note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("workflow-note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("broadcast-note")).toBe("apply-to-future");
    expect(resolveDecisionAlias("queue")).toBe("queue-for-safe-boundary");
    expect(resolveDecisionAlias("question")).toBe("ask-user");
    expect(resolveDecisionAlias("defer")).toBe("reject");
    expect(resolveDecisionAlias("ignore")).toBe("reject");
    expect(resolveDecisionAlias("none")).toBe("reject");
    expect(resolveDecisionAlias("noop")).toBe("reject");
    expect(resolveDecisionAlias("no-op")).toBe("reject");
    expect(resolveDecisionAlias("no_change")).toBe("reject");
  });

  it("forward-to-<role> prefix returns restart-running-agents", () => {
    expect(resolveDecisionAlias("forward-to-planner")).toBe("restart-running-agents");
    expect(resolveDecisionAlias("forward_to_developer")).toBe("restart-running-agents");
    expect(resolveDecisionAlias("forwardToReviewer")).toBe("restart-running-agents");
  });

  it("forward/route resolves with target context", () => {
    expect(resolveDecisionAlias("forward", true)).toBe("restart-running-agents");
    expect(resolveDecisionAlias("forward", false)).toBe("apply-to-future");
    expect(resolveDecisionAlias("route", true)).toBe("restart-running-agents");
    expect(resolveDecisionAlias("route", false)).toBe("apply-to-future");
  });

  it("unknown raw decision returns undefined", () => {
    expect(resolveDecisionAlias("totally-made-up")).toBeUndefined();
  });
});

describe("normalizeDecisionToken", () => {
  it("normalizes camelCase, snake_case, space-separated, mixed casing", () => {
    expect(normalizeDecisionToken("InjectNote")).toBe("inject-note");
    expect(normalizeDecisionToken("inject_note")).toBe("inject-note");
    expect(normalizeDecisionToken("Inject Note")).toBe("inject-note");
    expect(normalizeDecisionToken("INJECT-NOTE")).toBe("inject-note");
    expect(normalizeDecisionToken("  forward_to_planner  ")).toBe("forward-to-planner");
  });
});

describe("normalizeDeciderOutput regression suite — prior shorthand commits", () => {
  it("[9636bf9] decision-array shorthand with action=forward + targetAgentId", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      decisions: [{
        action: "forward",
        targetAgentId: "developer-M1-S101",
        message: "User guidance: backend not ready, mock API calls.",
        priority: "normal",
      }],
    }));
    expect(out.kind).toBe("restart-running-agents");
    expect(out.targetAgents).toEqual(["developer-M1-S101"]);
  });

  it("[37a931f] decisions-array forwardToAgent with agentId", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      decisions: [{
        action: "forwardToAgent",
        agentId: "researcher",
        message: "Add full code documentation to plan scope.",
        reason: "User scope change.",
      }],
    }));
    expect(out.kind).toBe("restart-running-agents");
    expect(out.targetAgents).toEqual(["researcher"]);
  });

  it("[33dd20f] multi-action plan with restart/note/amend mix", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      summary: "Mock backend constraint",
      actions: [
        { type: "amend_plan", target: "planner", guidance: "Update plan: backend APIs not ready" },
        { type: "restart_agent", target: "developer-M1-S102", guidance: "Restart after plan amend" },
        { type: "note", target: "orchestrator", guidance: "Re-eval completed stories after amend" },
      ],
      requiresConfirmation: true,
    }));
    expect(out.kind).toBe("restart-running-agents");
    expect(out.targetAgents).toEqual(["developer-M1-S102"]);
    expect(out.planPatchRequired).toBe(true);
    expect(out.requiresConfirmation).toBe(true);
    expect(out.amendedUserFacingPlanText).toContain("Update plan: backend APIs not ready");
    expect(out.amendedUserFacingPlanText).toContain("Re-eval completed stories");
    expect(out.amendedUserFacingPlanText).not.toContain("Restart after plan amend");
    expect(out.agentRestartInstructions).toEqual({
      "developer-M1-S102": "Restart after plan amend",
    });
  });

  it("[33887ca] unknown actions[] type throws UnsupportedActionShapeError with normalized type", () => {
    expect(() => normalizeDeciderOutput(JSON.stringify({
      actions: [{ type: "rewrite_plan", guidance: "Rewrite plan around new strategy" }],
    }))).toThrow(UnsupportedActionShapeError);
    try {
      normalizeDeciderOutput(JSON.stringify({
        actions: [{ type: "rewrite_plan", guidance: "Rewrite plan around new strategy" }],
      }));
    } catch (err) {
      expect((err as UnsupportedActionShapeError).code).toBe("STEER_UNKNOWN_ACTION_SHAPE");
      expect((err as Error).message).toContain("rewrite-plan");
    }
  });

  it("[487a10e] multi-action no-op-only plan downgrades to reject (not apply-to-future)", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      actions: [
        { type: "noop", target: "planner" },
        { type: "defer" },
      ],
    }));
    expect(out.kind).toBe("reject");
  });

  it("[e426702] rationale-only output with action=noop normalizes to reject with rationale-as-summary", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      decision: "accept_fallback",
      action: "noop",
      target: "planner",
      rationale: "The orchestrator already wrote a sequential fallback; no active agent needs interruption.",
      requiresConfirmation: false,
    }));
    expect(out.kind).toBe("reject");
    expect(out.summary).toContain("orchestrator already wrote");
    expect(out.targetAgents).toEqual(["planner"]);
  });

  it("[f31770c] decisions-array shorthand: first supported item wins when decision/action token aliases to no-op", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      decisions: [{
        action: "noop",
        summary: "All clear, no change needed.",
        details: "Skipping; no impact.",
        requiresConfirmation: false,
      }],
    }));
    expect(out.kind).toBe("reject");
    expect(out.summary).toBe("All clear, no change needed.");
  });

  it("[d1c5771] top-level note action with notes/details preserves guidance as amendedUserFacingPlanText", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      action: "note",
      summary: "Acknowledge mock-backend guidance.",
      notes: "Developers should use mock implementations rather than real API calls.",
      requiresConfirmation: false,
    }));
    expect(out.kind).toBe("apply-to-future");
    expect(out.summary).toBe("Acknowledge mock-backend guidance.");
    expect(out.amendedUserFacingPlanText).toBe(
      "Developers should use mock implementations rather than real API calls.",
    );
  });

  it("[digeng-16202] tight apply-to-future shape: {kind, guidanceText, scopeKind, requiresConfirmation} alone is recognized", () => {
    // Reproduces the failure observed in
    // ai_plan/2026-05-19-digeng-16202/transcript/planning/0005-...: the
    // model emitted only the canonical contract fields (kind +
    // guidanceText + scopeKind + requiresConfirmation), without a
    // separate `summary` / `note` / `rationale` field. Strict-parse
    // rejects it (missing required SteeringDecision boilerplate), and
    // before this fix normalize's `parseShorthandDecisionObject`
    // ALSO rejected it because `summary` was undefined. The fallback
    // chain now considers `guidanceText` so the tight contract shape
    // round-trips through the normalize layer.
    const out = normalizeDeciderOutput(JSON.stringify({
      kind: "apply-to-future",
      guidanceText: "Include comprehensive code documentation: inline comments for non-obvious logic, JSDoc/TSDoc on public APIs, README updates.",
      scopeKind: "workflow",
      requiresConfirmation: false,
    }));
    expect(out.kind).toBe("apply-to-future");
    expect(out.scopeKind).toBe("workflow");
    expect(out.guidanceText).toContain("comprehensive code documentation");
    // The summary fallback should land on the guidanceText so downstream
    // SteeringDecision construction has a non-empty summary.
    expect(out.summary).toContain("comprehensive code documentation");
  });

  it("[digeng-16202] tight shape minus requiresConfirmation still normalizes (requiresConfirmation defaults false)", () => {
    const out = normalizeDeciderOutput(JSON.stringify({
      kind: "apply-to-future",
      guidanceText: "Use mocked APIs until backend lands.",
    }));
    expect(out.kind).toBe("apply-to-future");
    expect(out.requiresConfirmation).toBe(false);
    expect(out.guidanceText).toBe("Use mocked APIs until backend lands.");
  });
});

describe("normalizeDeciderOutput error cases", () => {
  it("throws plain Error on malformed JSON", () => {
    expect(() => normalizeDeciderOutput("{ not json")).toThrow(/Unable to parse steering decision/);
  });

  it("throws UnsupportedActionShapeError when neither shorthand path matches", () => {
    expect(() => normalizeDeciderOutput(JSON.stringify({
      foo: "bar",
    }))).toThrow(UnsupportedActionShapeError);
  });

  it("UnsupportedActionShapeError carries rawDecision payload", () => {
    try {
      normalizeDeciderOutput(JSON.stringify({ actions: [{ type: "nuke_everything" }] }));
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnsupportedActionShapeError);
      expect((err as UnsupportedActionShapeError).code).toBe("STEER_UNKNOWN_ACTION_SHAPE");
      expect((err as UnsupportedActionShapeError).rawDecision).toMatchObject({
        actions: [{ type: "nuke_everything" }],
      });
    }
  });
});
