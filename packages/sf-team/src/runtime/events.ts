import type { AgentEvent, AgentRunState } from "./types";

export interface RawEventClassification {
  type?: string;
  textDeltaCount: number;
  thinkingDeltaCount: number;
  isHighVolumeStreamDelta: boolean;
}

export function classifyRawEvent(raw: Record<string, unknown>): RawEventClassification {
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const textDeltaCount = rawHasDelta(raw, "text") ? 1 : 0;
  const thinkingDeltaCount = rawHasDelta(raw, "thinking") ? 1 : 0;
  return {
    type,
    textDeltaCount,
    thinkingDeltaCount,
    isHighVolumeStreamDelta: type === "message_update" && (textDeltaCount > 0 || thinkingDeltaCount > 0),
  };
}

export function eventAffectsWidget(event: AgentEvent): boolean {
  // Keep this allowlist in sync with tui/wiring.ts:applyAgentEvent. The
  // orchestrator uses this as a fast pre-filter before calling that reducer.
  if (event.kind === "stdout-json") {
    const t = typeof event.raw.type === "string" ? event.raw.type : undefined;
    return t === "agent_start" || t === "agent_end";
  }
  return (
    event.kind === "tool_call"
    || event.kind === "stalled"
    || event.kind === "aborted"
    || event.kind === "exit"
    || event.kind === "error"
  );
}

export function isTerminalAgentEvent(event: AgentEvent): boolean {
  return agentStateFromTerminalEvent(event) !== undefined;
}

export function agentStateFromTerminalEvent(event: AgentEvent): Exclude<AgentRunState, "running"> | undefined {
  if (event.kind === "stalled") return "stalled";
  if (event.kind === "aborted") return "aborted";
  if (event.kind === "exit") return event.exitCode === 0 ? "completed" : "failed";
  if (event.kind === "stdout-json") {
    const t = typeof event.raw.type === "string" ? event.raw.type : undefined;
    if (t === "agent_end") return "completed";
  }
  if (event.kind === "error") return "failed";
  return undefined;
}

function rawHasDelta(raw: Record<string, unknown>, kind: "text" | "thinking"): boolean {
  const event = raw.assistantMessageEvent;
  if (isRecord(event)) {
    const eventType = typeof event.type === "string" ? event.type : "";
    if (kind === "text" && eventType.includes("text") && event.delta !== undefined) return true;
    if (kind === "thinking" && eventType.includes("thinking") && event.delta !== undefined) return true;
  }

  const message = raw.message;
  if (!isRecord(message)) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((part) => {
    if (!isRecord(part)) return false;
    const type = typeof part.type === "string" ? part.type : "";
    if (kind === "text") return type === "text" && typeof part.text === "string" && part.text.length > 0;
    return type.includes("thinking") && typeof part.text === "string" && part.text.length > 0;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
