import { describe, expect, it } from "vitest";

import { parseSteeringDecision, decideSteeringInstruction } from "../src/steering/decider";
import type { SteeringWorkflowSnapshot } from "../src/steering/types";

const snapshot: SteeringWorkflowSnapshot = {
  workflowId: "workflow-1",
  workflowKind: "implement",
  activeAgentsVersion: 3,
  referencedAgentStates: {},
  referencedPlanHashes: {},
  activeAgents: [],
};

describe("steering decider", () => {
  const kinds = [
    "apply-to-future",
    "queue-for-safe-boundary",
    "restart-running-agents",
    "stop-running-agents",
    "discard-running-agent-changes",
    "amend-plan",
    "backtrack-completed-work",
    "ask-user",
    "reject",
  ] as const;

  it("parses strict decision JSON", () => {
    const decision = parseSteeringDecision(JSON.stringify({
      id: "decision-1",
      instructionId: "instruction-1",
      decidedAt: "2026-05-17T00:00:00.000Z",
      kind: "apply-to-future",
      summary: "Apply to future prompts",
      rationale: "No active agent impact.",
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
      guidanceText: "Apply the user steering to all future agents.",
    }));

    expect(decision).toMatchObject({ id: "decision-1", kind: "apply-to-future" });
  });

  it.each(kinds)("parses decision kind %s", (kind) => {
    const decision = parseSteeringDecision(JSON.stringify({
      id: `decision-${kind}`,
      instructionId: "instruction-1",
      decidedAt: "2026-05-17T00:00:00.000Z",
      kind,
      summary: `Decision ${kind}`,
      rationale: "Fake decider output.",
      planPatchRequired: kind === "amend-plan" || kind === "backtrack-completed-work",
      targetAgents: kind.includes("agents") ? ["agent-1"] : [],
      abortAgents: kind.includes("agents") ? ["agent-1"] : [],
      discardAgentChanges: kind === "discard-running-agent-changes" ? ["agent-1"] : [],
      affectedMilestones: kind === "backtrack-completed-work" ? ["M1"] : [],
      affectedStories: [],
      affectedFiles: [],
      risks: [],
      activeAgentsVersion: 3,
      referencedAgentStates: {},
      referencedPlanHashes: {},
      requiresConfirmation: kind === "discard-running-agent-changes" || kind === "backtrack-completed-work",
      ...(kind === "apply-to-future" ? { guidanceText: `Decision ${kind} guidance text.` } : {}),
    }));

    expect(decision.kind).toBe(kind);
  });

  it("rejects malformed decision JSON", () => {
    expect(() => parseSteeringDecision("{ not json")).toThrow(/Unable to parse steering decision/);
  });

  it("builds a safe default apply-to-future decision without a spawned reviewer", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Use smaller batches next.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "apply-to-future",
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("can run through a spawned steering-decider member", async () => {
    const calls: Array<{ role: string; widgetAgentId?: string; registerActiveAgent?: boolean }> = [];
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Please classify this.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async (member, _task, _errorPrefix, widgetAgentId, opts) => {
          calls.push({ role: member.role, widgetAgentId, registerActiveAgent: opts?.registerActiveAgent });
          return JSON.stringify({
            id: "decision-1",
            instructionId: "instruction-1",
            decidedAt: "2026-05-17T00:00:00.000Z",
            kind: "apply-to-future",
            summary: "Apply later",
            rationale: "Spawned path.",
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
            guidanceText: "Apply this steering guidance later in the workflow.",
          });
        },
      },
    });

    expect(calls).toEqual([{ role: "steering-decider", widgetAgentId: "steering-decider", registerActiveAgent: false }]);
    expect(decision.id).toBe("decision-1");
  });

  it("normalizes safe shorthand output from a spawned steering-decider", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Were you able to use the figma tool?",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          decision: "defer",
          summary: "Tool-sourced status question is not a steering directive; no workflow change required.",
          requiresConfirmation: false,
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "reject",
      summary: "Tool-sourced status question is not a steering directive; no workflow change required.",
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes agent-forwarding shorthand output from a spawned steering-decider", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Use Mock APIs call for now",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          action: "forward_to_planner",
          targetAgentId: "planner",
          note: "User directive: Use Mock APIs calls for now. Incorporate this constraint into the plan.",
          priority: "normal",
          requiresConfirmation: false,
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "User directive: Use Mock APIs calls for now. Incorporate this constraint into the plan.",
      targetAgents: ["planner"],
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes generic forward action shorthand with target agent ids", async () => {
    const messageForAgents = "User guidance: ensure the Figma MCP tool is used to fetch Figma context for the Profile Management design.";
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Let's make sure you use the figma tool to get the figma context",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          action: "forward",
          targetAgentIds: ["reviewer"],
          messageForAgents,
          summary: "Forward user instruction to reviewer to enforce Figma tool usage for Profile design context.",
          requiresConfirmation: false,
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "Forward user instruction to reviewer to enforce Figma tool usage for Profile design context.",
      targetAgents: ["reviewer"],
      amendedUserFacingPlanText: messageForAgents,
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes route decision shorthand with target agent id", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "The api calls need to be mocked as backend is not ready",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          decision: "route",
          targetAgentId: "planner",
          reason: "New constraint from user: backend not ready, API calls must be mocked.",
          requiresConfirmation: false,
          notes: "Incorporate API mocking (backend not ready) into the profile updates plan.",
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "New constraint from user: backend not ready, API calls must be mocked.",
      targetAgents: ["planner"],
      amendedUserFacingPlanText: "Incorporate API mocking (backend not ready) into the profile updates plan.",
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes the first supported item from decisions-array shorthand", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "The backend has not been implemented yet, so mock the API calls.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          decisions: [{
            action: "forward",
            targetAgentId: "developer-M1-S101",
            message: "User guidance: The backend has not been implemented yet, so mock the API calls in your implementation.",
            priority: "normal",
            requiresConfirmation: false,
            rationale: "User-provided constraint directly affects the running developer.",
          }],
          acknowledgement: "Forwarded backend-mocking guidance to developer-M1-S101.",
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "User guidance: The backend has not been implemented yet, so mock the API calls in your implementation.",
      targetAgents: ["developer-M1-S101"],
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes forwardToAgent decisions-array shorthand with agentId", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Let's add full code documentation to the plan.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          decisions: [{
            action: "forwardToAgent",
            agentId: "researcher",
            message: "User update: add full code documentation to the plan scope.",
            reason: "The user instruction changes planning scope and should be routed to the running researcher.",
          }],
          acknowledgement: "Forwarded documentation-scope guidance to researcher.",
          requiresConfirmation: false,
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "User update: add full code documentation to the plan scope.",
      targetAgents: ["researcher"],
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it("normalizes multi-action plan shorthand from a spawned steering-decider", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Clarification, the API calls need to be mocked because the backend API are not ready yet",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          decisionId: "58198d11-f85f-4748-bcc9-950b2a5da372",
          instructionId: "instruction-1",
          summary: "Incorporate clarification that backend APIs are not ready; all API calls must be mocked in the implementation.",
          rationale: "User clarified that backend endpoints are not yet available.",
          actions: [
            {
              type: "amend_plan",
              target: "planner",
              guidance: "Update the plan to state explicitly that backend APIs for profile-settings are NOT yet available.",
            },
            {
              type: "restart_agent",
              target: "developer-M1-S102",
              guidance: "Stop the currently running S-102 developer and restart it after the plan amendment lands.",
            },
            {
              type: "note",
              target: "orchestrator",
              guidance: "After plan amendment, re-evaluate completed developer stories.",
            },
          ],
          requiresConfirmation: true,
          confirmationReason: "Restarting the in-flight developer agent and amending the plan are non-trivial workflow mutations.",
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "restart-running-agents",
      summary: "Incorporate clarification that backend APIs are not ready; all API calls must be mocked in the implementation.",
      rationale: "User clarified that backend endpoints are not yet available.",
      planPatchRequired: true,
      targetAgents: ["developer-M1-S102"],
      activeAgentsVersion: 3,
      requiresConfirmation: true,
    });
    expect(decision.amendedUserFacingPlanText).toContain("Update the plan to state explicitly");
    expect(decision.amendedUserFacingPlanText).toContain("After plan amendment, re-evaluate completed developer stories.");
    expect(decision.amendedUserFacingPlanText).not.toContain("Stop the currently running S-102 developer");
    expect(decision.agentRestartInstructions).toEqual({
      "developer-M1-S102": "Stop the currently running S-102 developer and restart it after the plan amendment lands.",
    });
    expect(decision.risks).toContain("Restarting the in-flight developer agent and amending the plan are non-trivial workflow mutations.");
  });

  it("rejects unknown multi-action shorthand instead of downgrading to apply-to-future", async () => {
    await expect(decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Rewrite the plan with a new implementation strategy.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          actions: [{
            type: "rewrite_plan",
            guidance: "Rewrite the plan around the new implementation strategy.",
          }],
        }),
      },
    })).rejects.toThrow(/STEER_UNKNOWN_ACTION_SHAPE.*rewrite-plan/);
  });

  it("normalizes no-op fallback shorthand with rationale-only output", async () => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "Let's review the planner execution strategy because validation failed.",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify({
          id: "instruction-1",
          workflowId: "workflow-1",
          decision: "accept_fallback",
          action: "noop",
          target: "planner",
          rationale: "The orchestrator already wrote a sequential fallback; no active agent needs interruption.",
          recommendations: [{
            id: "rec-revise-writesets",
            target: "planner",
            summary: "Revise unsafe writeSets later.",
          }],
          requiresConfirmation: false,
          status: "resolved",
        }),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "reject",
      summary: "The orchestrator already wrote a sequential fallback; no active agent needs interruption.",
      targetAgents: ["planner"],
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });

  it.each([
    {
      name: "top-level action note",
      output: {
        action: "note",
        summary: "Acknowledge guidance that API calls must be mocked since backend is not ready.",
        notes: "Developers should use mock implementations rather than real API calls.",
        requiresConfirmation: false,
      },
      expectedSummary: "Acknowledge guidance that API calls must be mocked since backend is not ready.",
      expectedGuidance: "Developers should use mock implementations rather than real API calls.",
    },
    {
      name: "decisions-array note",
      output: {
        decisions: [{
          action: "note",
          note: "User clarifies that API calls must be mock implementations because the backend is not ready yet.",
          priority: "normal",
        }],
        acknowledgement: "Noted: API calls will be mocked since backend is not ready.",
      },
      expectedSummary: "User clarifies that API calls must be mock implementations because the backend is not ready yet.",
      expectedGuidance: "User clarifies that API calls must be mock implementations because the backend is not ready yet.",
    },
    {
      name: "decision note with broadcast target",
      output: {
        decision: "note",
        summary: "User clarifies that API calls must be mocked because backend is not ready yet.",
        notes: "Ensure all profile update hooks use mock implementations rather than real API calls.",
        requiresConfirmation: false,
        broadcastToAgents: ["developer-M1-S102"],
      },
      expectedSummary: "User clarifies that API calls must be mocked because backend is not ready yet.",
      expectedGuidance: "Ensure all profile update hooks use mock implementations rather than real API calls.",
      expectedTargets: ["developer-M1-S102"],
    },
    {
      name: "decisions-array note with details",
      output: {
        decisions: [{
          action: "note",
          summary: "Backend not ready; ensure all API calls are implemented as mocks",
          details: "Propagate this constraint to all current and future developer agents.",
          priority: "normal",
          requiresConfirmation: false,
        }],
        acknowledgement: "Acknowledged: API calls will be mocked since backend is not ready.",
      },
      expectedSummary: "Backend not ready; ensure all API calls are implemented as mocks",
      expectedGuidance: "Propagate this constraint to all current and future developer agents.",
    },
    {
      name: "inject-note workflow note",
      output: {
        decisionId: "instruction-1",
        action: "inject_note",
        note: "Backend is not ready; all API calls must be implemented as mock calls.",
        scope: "workflow",
        priority: "normal",
        requiresConfirmation: false,
        rationale: "User-provided constraint affects implementation approach for all developers.",
      },
      expectedSummary: "Backend is not ready; all API calls must be implemented as mock calls.",
      expectedGuidance: "Backend is not ready; all API calls must be implemented as mock calls.",
    },
    {
      name: "actions-array inject note",
      output: {
        actions: [{
          type: "inject_note",
          details: "Backend is not ready; all API calls must be implemented as mock calls.",
        }],
        summary: "Record mock-backend guidance for the workflow.",
        requiresConfirmation: false,
      },
      expectedSummary: "Record mock-backend guidance for the workflow.",
      expectedGuidance: "inject-note: Backend is not ready; all API calls must be implemented as mock calls.",
    },
  ])("normalizes note shorthand from failing steer artifact: $name", async ({ output, expectedSummary, expectedGuidance, expectedTargets }) => {
    const decision = await decideSteeringInstruction({
      instruction: {
        id: "instruction-1",
        workflowId: "workflow-1",
        receivedAt: "2026-05-17T00:00:00.000Z",
        source: "tool",
        text: "the api calls need to be mock calls because backend is not ready yet",
        priority: "normal",
        status: "queued",
      },
      snapshot,
    }, {
      member: { role: "steering-decider", model: "model" },
      sp: {
        spawn: async () => {
          throw new Error("not used");
        },
        spawnText: async () => JSON.stringify(output),
      },
    });

    expect(decision).toMatchObject({
      instructionId: "instruction-1",
      kind: "apply-to-future",
      summary: expectedSummary,
      amendedUserFacingPlanText: expectedGuidance,
      targetAgents: expectedTargets ?? [],
      activeAgentsVersion: 3,
      requiresConfirmation: false,
    });
  });
});
