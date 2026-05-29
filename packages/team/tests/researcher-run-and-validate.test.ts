import { describe, expect, it, vi } from "vitest";

import { runResearcher } from "../src/research/run";
import type { AgentRun, AgentTask, TeamMember } from "../src/runtime/types";

function fakeRun(text: string, state: AgentRun["state"] = "completed"): AgentRun {
  return {
    state,
    pid: 1,
    parentPid: process.pid,
    childPids: [],
    metrics: { startedAtMs: Date.now() },
    exitCode: 0,
    finalText: text,
    events: [],
    eventsCompacted: false,
    eventSummary: { textDeltaCount: 0, thinkingDeltaCount: 0, compactedEventCount: 0 },
    toolCalls: [],
    stderrTail: "",
  };
}

const validBody = JSON.stringify({
  knownFacts: ["repo uses pnpm"],
  ambiguities: ["which port for healthz?"],
  openQuestions: [{ id: "q1", kind: "input", title: "What port?" }],
  external: [],
});

const member: TeamMember = { role: "researcher", model: "claude-haiku-4-5" };

describe("runResearcher", () => {
  it("returns parsed analysis on a valid first response", async () => {
    const spawn = vi.fn(async () => fakeRun(validBody));
    const r = await runResearcher({
      prompt: "build /healthz",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
    });
    expect(r).not.toBeNull();
    expect(r!.knownFacts).toEqual(["repo uses pnpm"]);
    expect(r!.openQuestions).toHaveLength(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("tells the researcher that questions are required by default and Other is orchestrator-owned", async () => {
    const calls: AgentTask[] = [];
    const spawn = vi.fn(async (_m: TeamMember, t: AgentTask) => {
      calls.push(t);
      return fakeRun(validBody);
    });
    await runResearcher({
      prompt: "build /healthz",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
    });
    expect(calls[0].task).toContain("Questions are required by default");
    expect(calls[0].task).toContain('Set `optional: true` only for kind="input"');
    expect(calls[0].task).toContain('Never include "Other (describe)"');
    expect(calls[0].task).toContain('"optional": true');
  });

  it("retries ONCE when first response is malformed JSON", async () => {
    const calls: AgentTask[] = [];
    let i = 0;
    const spawn = vi.fn(async (_m: TeamMember, t: AgentTask) => {
      calls.push(t);
      i += 1;
      return fakeRun(i === 1 ? "I am free-form prose, not JSON" : validBody);
    });
    const r = await runResearcher({
      prompt: "x",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
    });
    expect(r).not.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
    // Round-2 prompt explicitly says "PREVIOUS ATTEMPT INVALID" and "ONLY a JSON object".
    expect(calls[1].task).toMatch(/PREVIOUS ATTEMPT INVALID/);
    expect(calls[1].task).toMatch(/ONLY a JSON object/);
  });

  it("returns null AND notifies the user via ui.notify when both attempts fail", async () => {
    const spawn = vi.fn(async () => fakeRun("nope, never JSON"));
    const notify = vi.fn();
    const r = await runResearcher({
      prompt: "x",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
      ui: { notify },
    });
    expect(r).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatch(/fallback engaged/);
    expect(notify.mock.calls[0][1]).toBe("warning");
  });

  it("merges unresolved external refs into openQuestions as kind='input'", async () => {
    const spawn = vi.fn(async () => fakeRun(validBody));
    const r = await runResearcher({
      prompt: "see https://example.com/doc",
      externalContext: {
        resolved: [],
        unresolved: [
          { ref: { kind: "url", raw: "https://example.com/doc", id: "https://example.com/doc" }, reason: "no fetcher configured" },
        ],
      },
      researcher: member,
      spawn,
    });
    expect(r).not.toBeNull();
    // The researcher returned 1 openQuestion; we appended 1 from the unresolved ref.
    expect(r!.openQuestions).toHaveLength(2);
    const ext = r!.openQuestions.find((q) => q.id.startsWith("ext:url:"));
    expect(ext).toBeDefined();
    expect(ext!.kind).toBe("input");
    expect(ext!.title).toMatch(/Paste content of url:https:\/\/example.com\/doc/);
  });

  it("strips a ```json``` fence when the agent emits one", async () => {
    const fenced = "```json\n" + validBody + "\n```";
    const spawn = vi.fn(async () => fakeRun(fenced));
    const r = await runResearcher({
      prompt: "x",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
    });
    expect(r).not.toBeNull();
  });

  it("treats agent-stalled state as a parse miss → triggers retry", async () => {
    let i = 0;
    const spawn = vi.fn(async () => {
      i += 1;
      if (i === 1) return fakeRun("", "stalled");
      return fakeRun(validBody);
    });
    const r = await runResearcher({
      prompt: "x",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
    });
    expect(r).not.toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
