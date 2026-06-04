/**
 * Tool-schema shape tests for the unified surface (7 tools: 5 `<base>`
 * start + 1 unified `sf_team_resume` + standalone `sf_team_steer`).
 * The legacy throwing aliases and per-base `_resume` variants are removed.
 *
 * - Each `<base>` (start) tool's `parameters` is a single Type.Object
 *   with `additionalProperties: false` (the historical anyOf union is
 *   GONE).
 * - The unified `sf_team_resume` tool's `parameters` is a single
 *   Type.Object that requires `resume` (optional, for latest-workflow
 *   fallback) plus shared fields like gitMode, tddMode, aiPlanPath.
 */
import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";

import sfTeamExtension from "../extensions/team";
import { TEAM_BASE_TOOL_NAMES, TEAM_TOOL_NAMES, type TeamBaseToolName } from "../src/register";

class FakePi {
  tools: Array<{ name: string; description: string; parameters: unknown; execute: (...args: any[]) => Promise<any> }> = [];
  registerTool(tool: { name: string; description: string; parameters: unknown; execute: (...args: any[]) => Promise<any> }): void {
    this.tools.push(tool);
  }
  registerCommand(_name: string, _options: unknown): void {}
  sendUserMessage(_content: string): void {}
}

interface ParamSchema {
  type?: string;
  anyOf?: unknown;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, unknown>;
}

function asSchema(parameters: unknown): ParamSchema {
  return parameters as ParamSchema;
}

const requiredStartKey: Record<TeamBaseToolName, string> = {
  sf_team_plan: "title",
  sf_team_implement: "slug",
  sf_team_task: "title",
  sf_team_auto: "title",
  sf_team_followup: "title",
};

function loadSfTeamPi(): FakePi {
  const pi = new FakePi();
  sfTeamExtension(pi as never);
  return pi;
}

describe("tool-schema: 7-tool unified surface (5 `<base>` + 1 `sf_team_resume` + steer)", () => {
  it("registers exactly the 7 tools enumerated by TEAM_TOOL_NAMES (no legacy aliases or per-base _resume)", () => {
    const pi = loadSfTeamPi();
    const names = pi.tools.map((t) => t.name);
    expect(names).toEqual([...TEAM_TOOL_NAMES]);
    expect(names).toHaveLength(7);
    for (const base of TEAM_BASE_TOOL_NAMES) {
      expect(names).toContain(base);
      // No per-base `_resume` suffix — replaced by unified sf_team_resume.
      expect(names).not.toContain(`${base}_resume`);
      // No `_start` suffix anywhere — that was the M1 shape.
      expect(names).not.toContain(`${base}_start`);
    }
    expect(names).toContain("sf_team_resume");
    expect(names).toContain("sf_team_steer");
  });

  it("each `<base>` (start) schema is a single Type.Object with additionalProperties:false (no anyOf)", () => {
    const pi = loadSfTeamPi();
    for (const base of TEAM_BASE_TOOL_NAMES) {
      const t = pi.tools.find((x) => x.name === base)!;
      const schema = asSchema(t.parameters);
      expect(schema.type, `${base} must be a single object schema`).toBe("object");
      expect(schema.anyOf, `${base} must NOT be an anyOf union`).toBeUndefined();
      expect(schema.additionalProperties).toBe(false);
      const startKey = requiredStartKey[base];
      expect(schema.properties, `${base} must define properties`).toBeDefined();
      expect(schema.properties).toHaveProperty(startKey);
      expect(schema.required ?? []).toContain(startKey);
    }
  });

  it("unified `sf_team_resume` schema is a single Type.Object with `resume` optional", () => {
    const pi = loadSfTeamPi();
    const t = pi.tools.find((x) => x.name === "sf_team_resume")!;
    const schema = asSchema(t.parameters);
    expect(schema.type, "sf_team_resume must be a single object schema").toBe("object");
    expect(schema.anyOf, "sf_team_resume must NOT be an anyOf union").toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toHaveProperty("resume");
    // resume is optional in the unified tool (omitting it resumes the latest workflow)
    expect(schema.required ?? []).not.toContain("resume");
  });

  it("each `<base>` schema accepts the normal input but rejects {} and { resume }", () => {
    const pi = loadSfTeamPi();
    for (const base of TEAM_BASE_TOOL_NAMES) {
      const t = pi.tools.find((x) => x.name === base)!;
      const startKey = requiredStartKey[base];
      const normal: Record<string, unknown> = { [startKey]: "x" };
      expect(Value.Check(t.parameters as never, normal)).toBe(true);
      expect(Value.Check(t.parameters as never, {})).toBe(false);
      expect(Value.Check(t.parameters as never, { resume: "x" })).toBe(false);
    }
  });

  it("unified `sf_team_resume` schema accepts { resume } and {} (latest-workflow fallback) but rejects start-only input", () => {
    const pi = loadSfTeamPi();
    const t = pi.tools.find((x) => x.name === "sf_team_resume")!;
    expect(Value.Check(t.parameters as never, { resume: "x" })).toBe(true);
    // Empty object is valid for sf_team_resume (resumes latest workflow)
    expect(Value.Check(t.parameters as never, {})).toBe(true);
    // Start-only input (e.g. just a title) is not valid on the resume tool
    expect(Value.Check(t.parameters as never, { title: "x" })).toBe(false);
  });
});
