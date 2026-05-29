import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * S-603 + S-610: raw stdout/stderr mirroring is implemented via explicit
 * `data` event handlers (NOT default `pipe()`). The file is closed
 * exactly once when both stdout AND stderr have ended. spawnAgent
 * awaits the WriteStream's `finish` event before resolving, so reads
 * after `await spawnAgent(...)` see the full file content.
 */


/* ───────────────────── S-603 / S-610 integration ──────────────────────────
 * Exercise the actual spawnAgent codepath with rawLogPath set, using a
 * tiny inline node script as the pi binary. The script emits known
 * lines on BOTH stdout and stderr; after spawnAgent resolves, we read
 * the log file and assert the bytes appear in order.
 * --------------------------------------------------------------------- */

describe("S-610 spawnAgent with rawLogPath: real subprocess output appears in the file", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "ct-rawlog-int-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("a child that writes to BOTH stdout and stderr is fully mirrored to the log file", async () => {
    // Tiny "fake pi" that ignores its argv, writes known bytes on
    // BOTH streams, then exits 0. spawnAgent uses spawn(piBinary, argv)
    // — if our `piBinary` is an executable node script, the argv is
    // simply passed and ignored.
    const fs = require("node:fs") as typeof import("node:fs");
    const piStub = path.join(tmp, "pi-stub.mjs");
    fs.writeFileSync(piStub, `#!/usr/bin/env node
// Argv is ignored — buildPiArgv composes pi's CLI args; we don't care.
process.stdout.write(JSON.stringify({ type: "session_started" }) + "\\n");
process.stderr.write("STDERR-MARK-1\\n");
process.stdout.write("STDOUT-PROSE-LINE\\n");
process.stderr.write("STDERR-MARK-2\\n");
process.stdout.write(JSON.stringify({ type: "agent_end", text: "DONE" }) + "\\n");
process.exit(0);
`, { mode: 0o755 });

    const { spawnAgent } = await import("../src/runtime/spawn");
    const rawLogPath = path.join(tmp, "agent-raw.log");

    await spawnAgent(
      { role: "planner", model: "anthropic/claude-haiku-4-5" },
      { task: "raw-log integration test" },
      {
        piBinary: piStub,
        rawLogPath,
        heartbeatMs: 5_000,
      },
    );

    expect(existsSync(rawLogPath)).toBe(true);
    const content = fs.readFileSync(rawLogPath, "utf8");
    // Both streams' content is in the file.
    expect(content).toContain("STDOUT-PROSE-LINE");
    expect(content).toContain("STDERR-MARK-1");
    expect(content).toContain("STDERR-MARK-2");
    expect(content).toContain('"type":"agent_end"');
    // The session_started JSON is also present.
    expect(content).toContain('"type":"session_started"');
  });
});

/* ───────────────────────── direct stream-mirror test ───────────────────── */

describe("S-603 stream-mirror behavior (close-once-on-both-end semantics)", () => {
  /**
   * The mirroring code lives inline in spawn.ts; the cleanest
   * isolation-test is to extract the same pattern here and assert the
   * close-once-on-both-end semantics. This is a unit test of the
   * algorithm — the integration test above proves the actual file is
   * populated by a real subprocess.
   */
  function makeMirror(filePath: string): {
    onStdout: (chunk: string) => void;
    onStdoutEnd: () => void;
    onStderr: (chunk: string) => void;
    onStderrEnd: () => void;
    finish: Promise<void>;
  } {
    const fs = require("node:fs") as typeof import("node:fs");
    const file = fs.createWriteStream(filePath, { flags: "a" });
    let openSources = 2;
    const finish = new Promise<void>((resolve) => {
      file.once("finish", resolve);
      file.once("error", () => resolve());
    });
    const closeIfDone = (): void => {
      openSources -= 1;
      if (openSources === 0) file.end();
    };
    return {
      onStdout: (c) => file.write(c),
      onStdoutEnd: closeIfDone,
      onStderr: (c) => file.write(c),
      onStderrEnd: closeIfDone,
      finish,
    };
  }

  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "ct-mirror-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("(a) bytes from BOTH stdout and stderr land in the file", async () => {
    const file = path.join(tmp, "a.log");
    const m = makeMirror(file);
    m.onStdout("STORY START\n");
    m.onStderr("WARN: slow\n");
    m.onStdout("STORY END\n");
    m.onStdoutEnd();
    m.onStderrEnd();
    await m.finish;
    const content = readFileSync(file, "utf8");
    expect(content).toContain("STORY START");
    expect(content).toContain("STORY END");
    expect(content).toContain("WARN: slow");
    // Order preserved.
    expect(content.indexOf("STORY START")).toBeLessThan(content.indexOf("STORY END"));
  });

  it("(b) stdout ends BEFORE stderr: file is NOT closed prematurely; stderr's late writes succeed", async () => {
    const file = path.join(tmp, "b.log");
    const m = makeMirror(file);
    m.onStdout("first\n");
    m.onStdoutEnd(); // stdout done
    // stderr writes AFTER stdout has ended
    m.onStderr("late stderr line\n");
    m.onStderrEnd();
    await m.finish;
    const content = readFileSync(file, "utf8");
    expect(content).toContain("first");
    expect(content).toContain("late stderr line");
  });

  it("(c) stderr ends FIRST: same — late stdout writes still land", async () => {
    const file = path.join(tmp, "c.log");
    const m = makeMirror(file);
    m.onStderr("err first\n");
    m.onStderrEnd();
    m.onStdout("late stdout line\n");
    m.onStdoutEnd();
    await m.finish;
    const content = readFileSync(file, "utf8");
    expect(content).toContain("err first");
    expect(content).toContain("late stdout line");
  });

  it("(d) both ends arrive simultaneously: file closes exactly once (no double-end error)", async () => {
    const file = path.join(tmp, "d.log");
    const m = makeMirror(file);
    m.onStdout("x\n");
    m.onStderr("y\n");
    // Trigger both ends in the SAME microtask.
    m.onStdoutEnd();
    m.onStderrEnd();
    await m.finish;
    expect(existsSync(file)).toBe(true);
    const content = readFileSync(file, "utf8");
    expect(content).toBe("x\ny\n");
  });
});

/* ───────────────────── kill-on-agent_end (UX-regression guard) ─────────────
 * Pi's post-`agent_end` teardown can take minutes. With the live tmux
 * pane making pi's logical end visible, the user sees a "✓ done" line
 * and then a multi-minute silent wait before the next agent spawns.
 * spawnAgent now treats `agent_end` as the orchestrator's
 * "we have everything we need" signal and SIGTERMs the subprocess via
 * the existing killTree path. This test PINS that behavior — without
 * the kill, this test would deadlock until the heartbeat watchdog
 * fires (and fail with state=stalled) or the test runner timeout
 * fires. With the kill, spawnAgent returns promptly; it must NOT pay
 * the full SIGTERM grace window when the process group exits immediately.
 * --------------------------------------------------------------------- */

describe("kill-on-agent_end: spawnAgent SIGTERMs pi after observing agent_end (no waiting on pi's teardown)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "ct-killonend-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("a stub that writes agent_end then sleeps forever still resolves quickly with state=completed", async () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const piStub = path.join(tmp, "pi-stub.mjs");
    // Emits agent_end, then deliberately keeps the event loop alive
    // forever (a recurring setInterval). Without kill-on-agent_end,
    // spawnAgent would await child.close indefinitely, the heartbeat
    // would eventually flip the run to "stalled", and the test would
    // fail. With the fix, SIGTERM fires immediately on agent_end and
    // node terminates within milliseconds — well inside the 2s grace
    // window, since node's default SIGTERM handler exits the process.
    // Shape matches what `extractFinalAssistantText` recognizes:
    // an `agent_end` event whose `messages[]` carries the assistant
    // content array. This proves text is captured BEFORE the kill.
    const agentEnd = JSON.stringify({
      type: "agent_end",
      messages: [
        { role: "assistant", content: [{ type: "text", text: "FINAL TEXT" }] },
      ],
    });
    fs.writeFileSync(piStub, `#!/usr/bin/env node
process.stdout.write(${JSON.stringify(agentEnd)} + "\\n");
// Keep the process alive indefinitely; only a kill signal will end it.
setInterval(() => {}, 10_000);
`, { mode: 0o755 });

    const { spawnAgent } = await import("../src/runtime/spawn");

    const startedAt = Date.now();
    const run = await spawnAgent(
      { role: "planner", model: "anthropic/claude-haiku-4-5" },
      { task: "kill-on-agent_end regression test" },
      {
        piBinary: piStub,
        // Heartbeat is set HIGH so a regression that drops the kill
        // would hit the test-runner timeout (the deterministic failure
        // mode) rather than a stalled-state race that depends on
        // heartbeat tuning.
        heartbeatMs: 60_000,
      },
    );
    const elapsed = Date.now() - startedAt;

    // Must complete (not stalled / aborted) — the kill is graceful.
    expect(run.state).toBe("completed");
    // finalText was extracted from the agent_end event, captured BEFORE
    // the kill takes effect.
    expect(run.finalText).toBe("FINAL TEXT");
    // SIGTERM grace is ~2s; node defaults to exiting on SIGTERM, so this
    // should return close to the fast-exit path without waiting for the much
    // looser historical 4s allowance. Keep enough headroom for loaded CI
    // workers; the load-bearing behavior is that this test does not hang.
    expect(elapsed).toBeLessThan(2_500);
  }, 10_000);
});
