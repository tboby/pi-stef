import { describe, expect, it, vi } from "vitest";

import { resolveValue, resolveValueSync } from "../src/config/resolve";

describe("M2: resolveValue chain (prompt → project → global → ask → default)", () => {
  it("returns prompt when defined (highest precedence)", async () => {
    const r = await resolveValue({ prompt: "p", project: "j", global: "g", default: "d" });
    expect(r).toEqual({ value: "p", source: "prompt" });
  });

  it("returns project when prompt is undefined", async () => {
    const r = await resolveValue({ project: "j", global: "g", default: "d" });
    expect(r).toEqual({ value: "j", source: "project" });
  });

  it("returns global when prompt + project undefined", async () => {
    const r = await resolveValue({ global: "g", default: "d" });
    expect(r).toEqual({ value: "g", source: "global" });
  });

  it("calls ask when prompt + project + global all undefined", async () => {
    const ask = vi.fn().mockResolvedValue("answered");
    const r = await resolveValue({ ask, default: "d" });
    expect(r).toEqual({ value: "answered", source: "ask" });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("falls through to default when ask returns undefined", async () => {
    const ask = vi.fn().mockResolvedValue(undefined);
    const r = await resolveValue({ ask, default: "d" });
    expect(r).toEqual({ value: "d", source: "default" });
  });

  it("does NOT call ask when an earlier source already produced a value", async () => {
    const ask = vi.fn();
    const r = await resolveValue({ project: "j", ask, default: "d" });
    expect(r.source).toBe("project");
    expect(ask).not.toHaveBeenCalled();
  });

  it("forwards signal to ask", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const ask = vi.fn().mockImplementation(async (signal?: AbortSignal) => {
      receivedSignal = signal;
      return "value";
    });
    await resolveValue({ ask, default: "d", signal: controller.signal });
    expect(receivedSignal).toBe(controller.signal);
  });

  it("falls through to default when no source defined", async () => {
    const r = await resolveValue<string>({ default: "fallback" });
    expect(r).toEqual({ value: "fallback", source: "default" });
  });
});

describe("M2: resolveValueSync (no Q&A path)", () => {
  it("respects the same precedence as resolveValue", () => {
    expect(resolveValueSync({ prompt: 1, project: 2, global: 3, default: 4 })).toEqual({ value: 1, source: "prompt" });
    expect(resolveValueSync({ project: 2, global: 3, default: 4 })).toEqual({ value: 2, source: "project" });
    expect(resolveValueSync({ global: 3, default: 4 })).toEqual({ value: 3, source: "global" });
    expect(resolveValueSync({ default: 4 })).toEqual({ value: 4, source: "default" });
  });
});

describe("M2: resolveValue end-to-end on a representative knob (review.max_rounds)", () => {
  it("resolves to project value when global has 5 and project has 8", async () => {
    const r = await resolveValueSync({ global: 5, project: 8, default: 10 });
    expect(r).toEqual({ value: 8, source: "project" });
  });

  it("resolves to default 10 when neither global nor project sets it", async () => {
    const r = await resolveValueSync({ default: 10 });
    expect(r).toEqual({ value: 10, source: "default" });
  });
});
