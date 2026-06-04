/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register a simple tool that JSON-serializes the execute result.
 * Used across Jira and Confluence tool registration modules.
 */
export function registerTool(
  pi: ExtensionAPI,
  name: string,
  description: string,
  parameters: unknown,
  execute: (params: any, signal?: AbortSignal) => Promise<unknown>,
  options?: { promptSnippet?: string },
): void {
  pi.registerTool({
    name,
    label: name,
    description,
    promptSnippet: options?.promptSnippet,
    parameters: parameters as never,
    async execute(_toolCallId: string, params: any, signal: AbortSignal | undefined) {
      const result = await execute(params, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    },
  });
}
