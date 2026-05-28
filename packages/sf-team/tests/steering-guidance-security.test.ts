import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSteeringStore } from "../src/steering/store";
import { sanitizeGuidanceText, truncateGuidanceText } from "../src/steering/guidance-sanitize";
import { loadActiveSteeringGuidance } from "../src/steering/guidance-inject";

describe("steering guidance security hardening", () => {
  let rootDir: string;
  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "guidance-security-"));
  });
  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("sanitizeGuidanceText strips NUL, \\r, other ASCII controls, zero-width chars; preserves \\n and \\t", () => {
    const dirty = `ok\x00null​zwsp‌nonJoiner‮override\r\nline2\rcr\nthree\ttab`;
    const clean = sanitizeGuidanceText(dirty);
    expect(clean).not.toContain("\x00");
    expect(clean).not.toContain("\r");
    expect(clean).not.toContain("​");
    expect(clean).not.toContain("‌");
    expect(clean).not.toContain("‮");
    expect(clean).toContain("\n");
    expect(clean).toContain("\t");
    expect(clean).toBe("oknullzwspnonJoineroverride\nline2cr\nthree\ttab");
  });

  it("truncateGuidanceText caps at 2000 chars with marker suffix", () => {
    const long = "a".repeat(2500);
    const truncated = truncateGuidanceText(long);
    expect(truncated.endsWith("…[truncated]")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(2000 + "…[truncated]".length);
  });

  it("appendGuidance sanitizes + truncates inside store before persisting", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const dirty = "before\x00middle​after";
    const row = await store.appendGuidance({
      instructionId: "i-1", workflowId: "wf-1", scope: { kind: "workflow" }, text: dirty, source: "tool",
    });
    expect(row.text).toBe("beforemiddleafter");
  });

  it("loadActiveSteeringGuidance prefixes every line with provenance marker", async () => {
    const store = createSteeringStore({ rootDir, expectedRoot: rootDir });
    const row = await store.appendGuidance({
      instructionId: "inst-prov", workflowId: "wf-1", scope: { kind: "workflow" }, text: "rule", source: "slash",
    });
    await store.activateGuidance(row.id);
    await store.updateInstructionStatus("inst-prov", "applied");
    const result = await loadActiveSteeringGuidance(store, {
      workflowId: "wf-1", role: "developer",
    });
    expect(result.lines).toEqual(["- [steering slash:inst-prov] rule"]);
  });
});
