import { vi } from "vitest";

export interface CapturedTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  execute: (...args: unknown[]) => Promise<unknown>;
  renderResult?: (...args: unknown[]) => unknown;
}

export interface CapturedCommand {
  description: string;
  handler: (...args: unknown[]) => Promise<void>;
}

export interface MockExtensionAPI {
  registerTool: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  getActiveTools: ReturnType<typeof vi.fn>;
  tools: CapturedTool[];
  commands: Map<string, CapturedCommand>;
  eventHandlers: Map<string, (...args: unknown[]) => unknown>;
}

export function createMockAPI(activeToolNames: string[] = []): MockExtensionAPI {
  const tools: CapturedTool[] = [];
  const commands = new Map<string, CapturedCommand>();
  const eventHandlers = new Map<string, (...args: unknown[]) => unknown>();

  const registerTool = vi.fn((tool: CapturedTool) => {
    tools.push(tool);
  });
  const registerCommand = vi.fn((name: string, opts: CapturedCommand) => {
    commands.set(name, opts);
  });
  const on = vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
    eventHandlers.set(event, handler);
  });
  const getActiveTools = vi.fn(() => activeToolNames);

  return { registerTool, registerCommand, on, getActiveTools, tools, commands, eventHandlers };
}

export function getToolByName(mockApi: MockExtensionAPI, name: string): CapturedTool | undefined {
  return mockApi.tools.find((t) => t.name === name);
}

export async function executeTool(mockApi: MockExtensionAPI, name: string, params: unknown, ctx: Record<string, unknown> = {}): Promise<unknown> {
  const tool = getToolByName(mockApi, name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.execute("", params, undefined, undefined, ctx);
}
