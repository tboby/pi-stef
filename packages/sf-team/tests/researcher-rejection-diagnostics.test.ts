import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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

const member: TeamMember = { role: "researcher", model: "claude-haiku-4-5" };

describe("researcher rejected-payload diagnostics", () => {
  it("when finalText is unparseable prose: writes researcher-rejected-{1,2}.md with reason='no parseable JSON' and the raw output", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rej-prose-"));
    try {
      const spawn = vi.fn(async () => fakeRun("I looked at the repo and here's what I found: this and that..."));
      const result = await runResearcher({
        prompt: "x",
        externalContext: { resolved: [], unresolved: [] },
        researcher: member,
        spawn,
        diagnosticsContext: { repoRoot: root, slug: "demo" },
      });
      expect(result).toBeNull();
      const folder = path.join(root, "ai_plan", "demo");
      const r1 = readFileSync(path.join(folder, "researcher-rejected-1.md"), "utf8");
      const r2 = readFileSync(path.join(folder, "researcher-rejected-2.md"), "utf8");
      expect(r1).toContain("no parseable JSON");
      expect(r1).toContain("I looked at the repo");
      expect(r2).toContain("no parseable JSON");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("when finalText parses as JSON but fails schema: rejection file contains schema errors with field paths", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rej-schema-"));
    try {
      // Missing required `openQuestions` array.
      const wrongShape = JSON.stringify({
        knownFacts: ["a"],
        ambiguities: [],
        external: [],
        confidence: 0.9, // unknown extra field
      });
      const spawn = vi.fn(async () => fakeRun(wrongShape));
      const result = await runResearcher({
        prompt: "x",
        externalContext: { resolved: [], unresolved: [] },
        researcher: member,
        spawn,
        diagnosticsContext: { repoRoot: root, slug: "demo" },
      });
      expect(result).toBeNull();
      const folder = path.join(root, "ai_plan", "demo");
      const r1 = readFileSync(path.join(folder, "researcher-rejected-1.md"), "utf8");
      // Schema-error section must be present and name at least one field.
      expect(r1).toContain("## Schema errors");
      // Either openQuestions (missing) or confidence (additional) must appear in the listed errors.
      expect(r1).toMatch(/openQuestions|confidence/);
      // Extracted-JSON block must be there for inspection.
      expect(r1).toContain("## Extracted JSON");
      expect(r1).toContain("knownFacts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("when agent run did not complete: rejection file records the run state in the reason", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rej-stalled-"));
    try {
      const spawn = vi.fn(async () => fakeRun("", "stalled"));
      await runResearcher({
        prompt: "x",
        externalContext: { resolved: [], unresolved: [] },
        researcher: member,
        spawn,
        diagnosticsContext: { repoRoot: root, slug: "demo" },
      });
      const r1 = readFileSync(path.join(root, "ai_plan", "demo", "researcher-rejected-1.md"), "utf8");
      expect(r1).toContain("agent run state=stalled");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("when no diagnosticsContext is supplied: behaves as before, no files written, returns null on failure", async () => {
    const spawn = vi.fn(async () => fakeRun("not json"));
    const notify = vi.fn();
    const result = await runResearcher({
      prompt: "x",
      externalContext: { resolved: [], unresolved: [] },
      researcher: member,
      spawn,
      ui: { notify },
    });
    expect(result).toBeNull();
    expect(notify).toHaveBeenCalledOnce();
    const msg = notify.mock.calls[0][0] as string;
    // Without diagnosticsContext, the notify message should NOT name a non-existent path.
    expect(msg).not.toMatch(/researcher-rejected-/);
  });

  it("on rejection retry: both rounds reuse the default widget agent id so the card consolidates instead of stacking", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rej-consolidate-"));
    try {
      // Round 1 returns empty finalText (the real-world WebSocket-1006
      // failure mode); round 2 also returns empty so we exercise both
      // spawns and capture both widgetAgentId args.
      const spawn = vi.fn(
        async (_member: TeamMember, _task: AgentTask, _widgetAgentId?: string) => fakeRun(""),
      );
      await runResearcher({
        prompt: "x",
        externalContext: { resolved: [], unresolved: [] },
        researcher: member,
        spawn,
        diagnosticsContext: { repoRoot: root, slug: "demo" },
      });
      expect(spawn).toHaveBeenCalledTimes(2);
      // Both calls must omit (or pass undefined for) widgetAgentId so
      // the orchestrator subscribes them under the default `researcher`
      // id and the existing card's round counter bumps to 2.
      expect(spawn.mock.calls[0][2]).toBeUndefined();
      expect(spawn.mock.calls[1][2]).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("when diagnosticsContext is supplied AND the run fails: notify message names the path so the user can find the artifacts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rej-notify-"));
    try {
      const spawn = vi.fn(async () => fakeRun("not json"));
      const notify = vi.fn();
      await runResearcher({
        prompt: "x",
        externalContext: { resolved: [], unresolved: [] },
        researcher: member,
        spawn,
        ui: { notify },
        diagnosticsContext: { repoRoot: root, slug: "demo" },
      });
      const msg = notify.mock.calls[0][0] as string;
      expect(msg).toMatch(/researcher-rejected/);
      expect(msg).toContain("demo");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
