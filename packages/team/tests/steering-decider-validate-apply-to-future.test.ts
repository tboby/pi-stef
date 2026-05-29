import { describe, expect, it } from "vitest";

import { parseSteeringDecision } from "../src/steering/decider";

const baseDecision = {
  id: "dec-1",
  instructionId: "inst-1",
  decidedAt: "2026-05-19T00:00:00.000Z",
  kind: "apply-to-future",
  summary: "Apply to future",
  rationale: "Non-destructive.",
  planPatchRequired: false,
  targetAgents: [],
  abortAgents: [],
  discardAgentChanges: [],
  affectedMilestones: [],
  affectedStories: [],
  affectedFiles: [],
  risks: [],
  activeAgentsVersion: 0,
  referencedAgentStates: {},
  referencedPlanHashes: {},
  requiresConfirmation: false,
};

describe("validateDecision apply-to-future contract", () => {
  it("STEER_MISSING_GUIDANCE_TEXT when guidanceText absent", () => {
    expect(() => parseSteeringDecision(JSON.stringify(baseDecision))).toThrow(/STEER_MISSING_GUIDANCE_TEXT/);
  });

  it("defaults scopeKind to workflow when omitted", () => {
    const dec = parseSteeringDecision(JSON.stringify({ ...baseDecision, guidanceText: "x" }));
    expect(dec.scopeKind).toBe("workflow");
  });

  it("accepts explicit scopeKind: workflow without scopeTarget", () => {
    const dec = parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "workflow",
    }));
    expect(dec.scopeKind).toBe("workflow");
  });

  it("STEER_MISSING_SCOPE_TARGET when scopeKind is milestone but no scopeTarget", () => {
    expect(() => parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "milestone",
    }))).toThrow(/STEER_MISSING_SCOPE_TARGET/);
  });

  it("STEER_MISSING_SCOPE_TARGET when scopeKind is story but no scopeTarget", () => {
    expect(() => parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "story",
    }))).toThrow(/STEER_MISSING_SCOPE_TARGET/);
  });

  it("STEER_MISSING_SCOPE_TARGET when scopeKind is role but no scopeTarget", () => {
    expect(() => parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "role",
    }))).toThrow(/STEER_MISSING_SCOPE_TARGET/);
  });

  it("STEER_INVALID_SCOPE_KIND when scopeKind is unknown", () => {
    expect(() => parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "totally-made-up",
    }))).toThrow(/STEER_INVALID_SCOPE_KIND/);
  });

  it("accepts scopeKind milestone + scopeTarget", () => {
    const dec = parseSteeringDecision(JSON.stringify({
      ...baseDecision, guidanceText: "x", scopeKind: "milestone", scopeTarget: "M2",
    }));
    expect(dec.scopeKind).toBe("milestone");
    expect(dec.scopeTarget).toBe("M2");
  });

  it("non-apply-to-future kinds do not require guidanceText", () => {
    expect(() => parseSteeringDecision(JSON.stringify({
      ...baseDecision, kind: "reject",
    }))).not.toThrow();
  });
});

import { decideSteeringInstruction } from "../src/steering/decider";
import type { SteeringInstruction, SteeringWorkflowSnapshot } from "../src/steering/types";

const snapshot: SteeringWorkflowSnapshot = {
  workflowId: "workflow-1",
  workflowKind: "implement",
  activeAgentsVersion: 3,
  referencedAgentStates: {},
  referencedPlanHashes: {},
  activeAgents: [],
};

const instruction: SteeringInstruction = {
  id: "instruction-1",
  workflowId: "workflow-1",
  receivedAt: "2026-05-19T00:00:00.000Z",
  source: "tool",
  text: "Mock the backend API calls.",
  priority: "normal",
  status: "queued",
};

describe("decideSteeringInstruction: strict-parse failure → normalize fallback", () => {
  it("does NOT fall back when strict-parse rejects with STEER_MISSING_GUIDANCE_TEXT", async () => {
    // Strict-parse JSON has all required SteeringDecision fields but
    // omits guidanceText on apply-to-future. The contract error must
    // propagate, not be swallowed by the normalize fallback.
    const strictNoGuidance = {
      id: "decision-x",
      instructionId: instruction.id,
      decidedAt: "2026-05-19T00:00:00.000Z",
      kind: "apply-to-future",
      summary: "Apply to future",
      rationale: "Non-destructive.",
      planPatchRequired: false,
      targetAgents: [],
      abortAgents: [],
      discardAgentChanges: [],
      affectedMilestones: [],
      affectedStories: [],
      affectedFiles: [],
      risks: [],
      activeAgentsVersion: 3,
      referencedAgentStates: {},
      referencedPlanHashes: {},
      requiresConfirmation: false,
    };
    await expect(decideSteeringInstruction({ instruction, snapshot }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => { throw new Error("not used"); },
        spawnText: async () => JSON.stringify(strictNoGuidance),
      },
    })).rejects.toThrow(/STEER_MISSING_GUIDANCE_TEXT/);
  });

  it("normalize-produced apply-to-future with scope but no scopeTarget throws STEER_MISSING_SCOPE_TARGET", async () => {
    // The decider output is shorthand (triggers normalize), and the
    // shorthand sets scopeKind=milestone via the `scope` field but no
    // scopeTarget. The post-normalize contract check must catch this.
    const shorthand = {
      decision: "future",
      summary: "Apply later",
      scope: "milestone",
    };
    await expect(decideSteeringInstruction({ instruction, snapshot }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => { throw new Error("not used"); },
        spawnText: async () => JSON.stringify(shorthand),
      },
    })).rejects.toThrow(/STEER_MISSING_SCOPE_TARGET/);
  });
});
