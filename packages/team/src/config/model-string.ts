import { THINKING_LEVELS, type ThinkingLevel } from "./schema";

const THINKING_SET = new Set<ThinkingLevel>(THINKING_LEVELS);

/**
 * Parse a pi `model[:thinking]` shorthand.
 *
 * Pi accepts both forms (model alone, or model:thinking). The model id can
 * itself contain slashes (provider/id), so we split on the LAST colon and
 * promote the right-hand side to {@link ThinkingLevel} only if it matches a
 * known level. If it doesn't, the colon is treated as part of the model id.
 *
 * @example
 *  parseModelString("claude-opus-4-7")               -> { model: "claude-opus-4-7" }
 *  parseModelString("claude-opus-4-7:high")          -> { model: "claude-opus-4-7", thinking: "high" }
 *  parseModelString("anthropic/claude-opus-4-7:xhigh") -> { model: "anthropic/claude-opus-4-7", thinking: "xhigh" }
 *  parseModelString("openrouter:anthropic/x:medium") -> { model: "openrouter:anthropic/x", thinking: "medium" }
 *  parseModelString("local:debug")                   -> { model: "local:debug" } (debug is not a thinking level)
 */
export function parseModelString(input: string): { model: string; thinking?: ThinkingLevel } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("parseModelString: empty input");
  }
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon < 0) {
    return { model: trimmed };
  }
  const candidate = trimmed.slice(lastColon + 1);
  if (THINKING_SET.has(candidate as ThinkingLevel)) {
    const head = trimmed.slice(0, lastColon);
    if (head.length === 0) {
      // ":high" -> treat as no model; surface a friendly error
      throw new Error(`parseModelString: model name is empty in "${input}"`);
    }
    return { model: head, thinking: candidate as ThinkingLevel };
  }
  return { model: trimmed };
}
