/**
 * Line-delimited JSON parser ported from nano-team/src/runner.ts:112-130.
 *
 * Pi `--mode json` emits one JSON event per line on stdout. Non-JSON output
 * (banners, warnings) is dropped silently. Trailing partial lines are returned
 * as `remainder` so callers can carry them into the next read.
 */
export interface ParseResult {
  events: Record<string, unknown>[];
  remainder: string;
}

export function parseLineDelimitedJson(buffer: string): ParseResult {
  const events: Record<string, unknown>[] = [];
  let remainder = buffer;
  while (true) {
    const newlineIndex = remainder.indexOf("\n");
    if (newlineIndex < 0) break;
    const line = remainder.slice(0, newlineIndex);
    remainder = remainder.slice(newlineIndex + 1);
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!trimmed.startsWith("{")) continue;
    try {
      events.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // Best-effort: pi never emits truncated JSON inside a line, so a parse
      // failure here is treated as non-protocol output and dropped.
    }
  }
  return { events, remainder };
}

/**
 * Extract the assistant's final text from any of the pi 0.70.6 stream events
 * that carry assistant content:
 *   1. `agent_end.messages[]` — preferred (full final conversation).
 *   2. `message_end.message`  — fallback (last assistant message of the turn).
 *   3. `turn_end.message`     — fallback (some pi configurations attach
 *                                trailing text here).
 *
 * The first event whose payload yields a non-empty assistant-text string
 * wins. Returns an empty string when no recognizable assistant content is
 * present.
 */
export function extractFinalAssistantText(event: Record<string, unknown>): string {
  // Path 1: agent_end.messages[]
  const messages = Array.isArray(event.messages) ? (event.messages as unknown[]) : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const text = textFromAssistantMessage(messages[i]);
    if (text.length > 0) return text;
  }
  // Path 2 & 3: message_end / turn_end carry a single `.message`
  if ("message" in event) {
    const text = textFromAssistantMessage(event.message);
    if (text.length > 0) return text;
  }
  return "";
}

function textFromAssistantMessage(raw: unknown): string {
  if (!isRecord(raw) || raw.role !== "assistant") return "";
  const content = Array.isArray(raw.content) ? (raw.content as unknown[]) : [];
  return content
    .filter((c) => isRecord(c) && c.type === "text")
    .map((c) => (isRecord(c) && typeof c.text === "string" ? c.text : ""))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
