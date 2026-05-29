import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { spawnAgent } from "../src/runtime/spawn";
import type { TeamMember } from "../src/runtime/types";

const FIXTURE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MOCK_PI = path.join(FIXTURE_DIR, "fixtures", "mock-pi.mjs");
const member: TeamMember = { role: "planner", model: "mock-model" };

describe("spawnAgent synthetic high-volume stream baseline", () => {
  it("completes a 1,000-delta mock stream, compacts retained events, records metrics, and preserves the raw log", async () => {
    const tmp = mkdtempSync(path.join(tmpdir(), "ct-stream-many-"));
    try {
      const rawLogPath = path.join(tmp, "agent-raw.log");
      const run = await spawnAgent(
        member,
        { task: "stream a lot" },
        {
          piBinary: MOCK_PI,
          rawLogPath,
          env: {
            ...process.env,
            MOCK_PI_MODE: "stream-many",
            MOCK_PI_STREAM_EVENTS: "1000",
            MOCK_PI_STREAM_DELTA: "x",
            MOCK_PI_FINAL_TEXT: "stream done",
          },
        },
      );

      expect(run.state).toBe("completed");
      expect(run.finalText).toBe("stream done");
      expect(run.metrics.startedAtMs).toBeGreaterThan(0);
      expect(run.metrics.firstStdoutAtMs).toBeGreaterThanOrEqual(run.metrics.startedAtMs);
      expect(run.metrics.firstTextDeltaAtMs).toBeGreaterThanOrEqual(run.metrics.firstStdoutAtMs ?? 0);
      expect(run.metrics.agentEndAtMs).toBeGreaterThanOrEqual(run.metrics.firstTextDeltaAtMs ?? 0);
      expect(run.metrics.rawLogFinishedAtMs).toBeGreaterThanOrEqual(run.metrics.startedAtMs);
      expect(run.metrics.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(run.eventsCompacted).toBe(true);
      expect(run.eventSummary.textDeltaCount).toBe(1000);
      expect(run.eventSummary.thinkingDeltaCount).toBe(0);

      const messageUpdates = run.events.filter((event) => {
        return event.kind === "stdout-json" && event.raw.type === "message_update";
      });
      expect(messageUpdates.length).toBe(0);
      expect(run.events.length).toBeLessThan(100);

      const rawLog = readFileSync(rawLogPath, "utf8");
      expect((rawLog.match(/"type":"message_update"/g) ?? []).length).toBe(1000);
      expect(rawLog).toContain('"type":"agent_end"');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
