/**
 * S-519: Assert that schemas for all 5 tools accept aiPlanPath, gitMode, tddMode.
 *
 * Checks that the registered tool schemas (both start and resume variants)
 * have the correct optional fields for the new no-git mode arguments.
 */
import { describe, expect, it } from "vitest";
import { registerFhTeam, TEAM_BASE_TOOL_NAMES, TEAM_STEER_TOOL_NAME } from "../src/register";

class FakePi {
  tools: Array<{ name: string; parameters: any }> = [];
  commands: Array<{ name: string }> = [];
  registerTool(tool: { name: string; parameters: any }): void {
    this.tools.push(tool);
  }
  registerCommand(name: string): void {
    this.commands.push({ name });
  }
  sendUserMessage(): void {}
}

function getToolSchema(pi: FakePi, toolName: string): any {
  const tool = pi.tools.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.parameters;
}

function schemaProperties(schema: any): Record<string, any> {
  return schema?.properties ?? {};
}

describe("S-519: tool schemas accept gitMode and tddMode", () => {
  const pi = new FakePi();
  registerFhTeam(pi as never);

  it("fh_team_plan start schema has gitMode and tddMode", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_plan"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_plan_resume schema has gitMode and tddMode", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_plan_resume"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_task start schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_task"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_task_resume schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_task_resume"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_implement start schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_implement"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_implement_resume schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_implement_resume"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_auto start schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_auto"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_auto_resume schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_auto_resume"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_followup start schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_followup"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_followup_resume schema has gitMode, tddMode, and aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, "fh_team_followup_resume"));
    expect(props).toHaveProperty("gitMode");
    expect(props).toHaveProperty("tddMode");
    expect(props).toHaveProperty("aiPlanPath");
  });

  it("fh_team_steer schema has aiPlanPath", () => {
    const props = schemaProperties(getToolSchema(pi, TEAM_STEER_TOOL_NAME));
    expect(props).toHaveProperty("aiPlanPath");
  });
});
