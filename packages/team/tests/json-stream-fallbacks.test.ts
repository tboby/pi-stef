import { describe, expect, it } from "vitest";

import { extractFinalAssistantText } from "../src/runtime/json-stream";

/**
 * Audit fix: pi 0.70.6 emits multiple final-text-bearing events:
 *   - `agent_end.messages[]` (full conversation, preferred)
 *   - `message_end.message` (last assistant message of the turn)
 *   - `turn_end` may contain trailing text in some pi configurations
 *
 * The original implementation only handled `agent_end.messages`. Inputs that
 * came through `message_end` alone (e.g., a curtailed run that didn't reach
 * agent_end) returned an empty string, which made the orchestrator look as if
 * the planner had said nothing.
 */
describe("audit fix: extractFinalAssistantText fallbacks for pi 0.70.6 events", () => {
  it("agent_end with messages[] still works (primary path)", () => {
    const ev = {
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }] },
        { role: "assistant", content: [{ type: "text", text: "hello plan" }] },
      ],
    };
    expect(extractFinalAssistantText(ev)).toBe("hello plan");
  });

  it("message_end with single message falls back correctly", () => {
    const ev = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "partial " },
          { type: "text", text: "answer" },
        ],
      },
    };
    expect(extractFinalAssistantText(ev)).toBe("partial answer");
  });

  it("turn_end with trailing assistant text falls back correctly", () => {
    const ev = {
      type: "turn_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "wrapped up" }],
      },
    };
    expect(extractFinalAssistantText(ev)).toBe("wrapped up");
  });

  it("returns empty string when no recognizable assistant content is present", () => {
    expect(extractFinalAssistantText({ type: "agent_end", messages: [] })).toBe("");
    expect(extractFinalAssistantText({ type: "message_end", message: { role: "user", content: [] } })).toBe("");
    expect(extractFinalAssistantText({})).toBe("");
  });
});
