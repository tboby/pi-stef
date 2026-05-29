#!/usr/bin/env node
/**
 * Mock-pi-binary fixture for spawnAgent lifecycle tests.
 *
 * Behavior is controlled via env vars on the spawn (set by the tests):
 *   MOCK_PI_MODE=happy           -> emit a normal event sequence and exit 0
 *   MOCK_PI_MODE=stall           -> emit a session event then sleep 60s
 *   MOCK_PI_MODE=spawn-child     -> spawn a long-running grandchild then wait for sigterm
 *   MOCK_PI_MODE=thinking-stderr -> stay silent on stdout but emit stderr
 *                                   chunks every 200ms for 2s, then finish
 *                                   normally. Used to verify stderr beats
 *                                   the watchdog (regression for the
 *                                   "stalled reviewer that's actually thinking" bug).
 *   MOCK_PI_FINAL_TEXT=...       -> body of the final assistant text in agent_end
 *   MOCK_PI_MODE=stream-many     -> emit many message_update deltas
 *   MOCK_PI_STREAM_EVENTS=1000   -> number of deltas for stream-many
 *   MOCK_PI_STREAM_DELTA=x       -> text delta body for stream-many
 */
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";

const mode = process.env.MOCK_PI_MODE ?? "happy";
const finalText = process.env.MOCK_PI_FINAL_TEXT ?? "## Verdict\nVERDICT: APPROVED";
const usage = process.env.MOCK_PI_USAGE ? JSON.parse(process.env.MOCK_PI_USAGE) : undefined;
const contextUsage = process.env.MOCK_PI_CONTEXT_USAGE ? JSON.parse(process.env.MOCK_PI_CONTEXT_USAGE) : undefined;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function emitAsync(event) {
  if (process.stdout.write(`${JSON.stringify(event)}\n`)) return;
  await new Promise((resolve) => process.stdout.once("drain", resolve));
}

let killed = false;
process.on("SIGTERM", () => {
  killed = true;
  process.exit(143);
});

async function run() {
  emit({ type: "session", id: "mock", cwd: process.cwd() });
  emit({ type: "agent_start" });
  emit({ type: "turn_start" });

  if (mode === "stall") {
    // Emit nothing else for 60s; tests configure heartbeatMs much smaller.
    await delay(60_000);
    return;
  }

  if (mode === "thinking-stderr") {
    // Emit no stdout JSON for 2s; emit stderr chunks every 200ms.
    // The watchdog (with heartbeatMs:300) would fire if stderr didn't beat,
    // but the fixed implementation lets stderr keep us alive.
    const totalMs = 2_000;
    const stepMs = 200;
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
      process.stderr.write(`thinking... ${elapsed}ms\n`);
      await delay(stepMs);
    }
    emit({ type: "turn_end" });
    emit({
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: finalText }] },
      ],
    });
    process.exit(0);
  }

  if (mode === "spawn-child") {
    // Spawn a grandchild that will be killed when our process group dies.
    const child = spawn("node", ["-e", "setInterval(() => {}, 100000);"], {
      stdio: "ignore",
      detached: false,
    });
    emit({ type: "tool_call", toolName: "read", input: { path: "/tmp/example" } });
    emit({ type: "message_start", message: { role: "assistant" } });
    // Write its pid out of band so the test can verify the grandchild dies.
    process.stderr.write(`grandchild=${child.pid}\n`);
    // Wait until killed.
    await delay(60_000);
    if (!killed && child.pid) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        // ignore
      }
    }
    return;
  }

  if (mode === "stream-many") {
    const count = Number.parseInt(process.env.MOCK_PI_STREAM_EVENTS ?? "1000", 10);
    const delta = process.env.MOCK_PI_STREAM_DELTA ?? "x";
    const safeCount = Number.isFinite(count) && count > 0 ? count : 1000;
    await emitAsync({ type: "message_start", message: { role: "assistant" } });
    for (let i = 0; i < safeCount; i += 1) {
      await emitAsync({
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: delta }] },
        assistantMessageEvent: { type: "text_delta", delta },
      });
    }
    await emitAsync({ type: "tool_execution_start", toolName: "stream_probe" });
    await emitAsync({ type: "tool_execution_update", toolName: "stream_probe", output: "ok" });
    await emitAsync({ type: "turn_end" });
    await emitAsync({
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: finalText }] },
      ],
    });
    await new Promise((resolve) => process.stdout.end(resolve));
    process.exitCode = 0;
    return;
  }

  // happy path
  emit({ type: "tool_call", toolName: "read", input: { path: "/etc/hostname" } });
  emit({ type: "tool_execution_start", toolCallId: "bash-1", toolName: "bash", args: { command: "pnpm test" } });
  await delay(5);
  emit({ type: "tool_execution_end", toolCallId: "bash-1", toolName: "bash", isError: false, result: { content: [] } });
  emit({
    type: "message_update",
    message: { role: "assistant", content: [{ type: "text", text: finalText }] },
    assistantMessageEvent: { type: "text_delta", delta: finalText },
  });
  emit({ type: "turn_end" });
  emit({
    type: "agent_end",
    contextUsage,
    messages: [
      { role: "user", content: [{ type: "text", text: "ignored" }] },
      { role: "assistant", content: [{ type: "text", text: finalText }], usage },
    ],
  });
  process.exit(0);
}

run().catch((err) => {
  process.stderr.write(`mock-pi error: ${err}\n`);
  process.exit(1);
});
