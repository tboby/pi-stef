import { describe, expect, it, vi } from "vitest";

import { registerAtlassianTools } from "../src/tools/registerAtlassianTools";

class FakePi {
  tools: Array<{ name: string; execute: (...args: any[]) => Promise<any> }> = [];
  commands = new Map<string, unknown>();

  registerTool(tool: { name: string; execute: (...args: any[]) => Promise<any> }): void {
    this.tools.push(tool);
  }

  registerCommand(name: string, options: unknown): void {
    this.commands.set(name, options);
  }

  sendUserMessage = vi.fn();
}

describe("Atlassian slash commands", () => {
  it("registers /jira-issue, /get-jira-issue, and /story-context commands", () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    expect(pi.commands.has("jira-issue")).toBe(true);
    expect(pi.commands.has("get-jira-issue")).toBe(true);
    expect(pi.commands.has("story-context")).toBe(true);
  });

  it("/jira-issue posts a prompt to the agent session", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("jira-issue") as any;
    await command.handler("PROJ-123", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("jira_issue"),
    );
  });

  it("/get-jira-issue posts a prompt to the agent session", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("get-jira-issue") as any;
    await command.handler("PROJ-456", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("jira_get_issue"),
    );
  });

  it("/story-context posts a prompt to the agent session", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("story-context") as any;
    await command.handler("PROJ-789", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("story_context"),
    );
  });

  it("/jira-issue uses followUp deliverAs when not idle", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("jira-issue") as any;
    await command.handler("PROJ-123", { isIdle: () => false });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("jira_issue"),
      { deliverAs: "followUp" },
    );
  });

  it("registers /confluence-page and /get-confluence-page commands", () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    expect(pi.commands.has("confluence-page")).toBe(true);
    expect(pi.commands.has("get-confluence-page")).toBe(true);
  });

  it("/confluence-page posts a prompt with url when given a URL", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("confluence-page") as any;
    await command.handler("https://example.atlassian.net/wiki/spaces/TEST/pages/12345", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("confluence_page"),
    );
    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining('url: "https://example.atlassian.net/wiki/spaces/TEST/pages/12345"'),
    );
  });

  it("/confluence-page posts a prompt with pageId when given an ID", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("confluence-page") as any;
    await command.handler("12345", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining('pageId: "12345"'),
    );
  });

  it("/get-confluence-page posts a prompt to the agent session", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("get-confluence-page") as any;
    await command.handler("67890", { isIdle: () => true });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("confluence_get_page"),
    );
  });

  it("/confluence-page uses followUp deliverAs when not idle", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("confluence-page") as any;
    await command.handler("12345", { isIdle: () => false });

    expect(pi.sendUserMessage).toHaveBeenCalledWith(
      expect.stringContaining("confluence_page"),
      { deliverAs: "followUp" },
    );
  });

  it("/confluence-page does nothing when args are empty", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("confluence-page") as any;
    await command.handler("", { isIdle: () => true });

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });

  it("/get-confluence-page does nothing when args are empty", async () => {
    const pi = new FakePi();

    registerAtlassianTools(pi as never);

    const command = pi.commands.get("get-confluence-page") as any;
    await command.handler("", { isIdle: () => true });

    expect(pi.sendUserMessage).not.toHaveBeenCalled();
  });
});
