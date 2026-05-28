import { describe, expect, it, vi } from "vitest";

import { AskUser } from "../src/ask-user";

function fakeUi() {
  return {
    select: vi.fn(),
    input: vi.fn(),
    confirm: vi.fn(),
    notify: vi.fn(),
    onTerminalInput: vi.fn(),
    setStatus: vi.fn(),
    setWorkingMessage: vi.fn(),
    setWorkingVisible: vi.fn(),
    setWorkingIndicator: vi.fn(),
    setHiddenThinkingLabel: vi.fn(),
    setWidget: vi.fn(),
    setFooter: vi.fn(),
    setHeader: vi.fn(),
    setTitle: vi.fn(),
    custom: vi.fn(),
    pasteToEditor: vi.fn(),
    setEditorText: vi.fn(),
    getEditorText: vi.fn(),
    editor: vi.fn(),
    addAutocompleteProvider: vi.fn(),
    setEditorComponent: vi.fn(),
    theme: {} as never,
    getAllThemes: vi.fn(),
    getTheme: vi.fn(),
    setTheme: vi.fn(),
    getToolsExpanded: vi.fn(),
    setToolsExpanded: vi.fn(),
  };
}

describe("M3: AskUser.select", () => {
  it("returns prompt value without asking UI", async () => {
    const ui = fakeUi();
    const a = new AskUser(ui as never);
    const r = await a.select({
      key: "model.planner",
      title: "Pick planner model",
      options: ["a", "b"],
      prompt: "a",
    });
    expect(r).toBe("a");
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("falls through prompt → project → global → ui call", async () => {
    const ui = fakeUi();
    ui.select.mockResolvedValue("from-ui");
    const a = new AskUser(ui as never);
    const r = await a.select({ key: "k", title: "t", options: ["x", "y"] });
    expect(r).toBe("from-ui");
    expect(ui.select).toHaveBeenCalledWith("t", ["x", "y"], { signal: undefined });
  });

  it("falls through to default when ui returns undefined", async () => {
    const ui = fakeUi();
    ui.select.mockResolvedValue(undefined);
    const a = new AskUser(ui as never);
    const r = await a.select({ key: "k", title: "t", options: ["x", "y"], default: "fallback" });
    expect(r).toBe("fallback");
  });

  it("caches the answer; second call short-circuits with no UI call", async () => {
    const ui = fakeUi();
    ui.select.mockResolvedValue("answer");
    const a = new AskUser(ui as never);
    await a.select({ key: "k", title: "t", options: ["x", "y"] });
    await a.select({ key: "k", title: "t-again", options: ["x", "y"] });
    expect(ui.select).toHaveBeenCalledTimes(1);
  });

  it("project value beats global", async () => {
    const ui = fakeUi();
    const a = new AskUser(ui as never);
    const r = await a.select({ key: "k", title: "t", options: [], project: "j", global: "g" });
    expect(r).toBe("j");
  });
});

describe("M3: AskUser.input", () => {
  it("returns prompt value without asking UI", async () => {
    const ui = fakeUi();
    const a = new AskUser(ui as never);
    const r = await a.input({ key: "k", title: "Slug?", prompt: "my-slug" });
    expect(r).toBe("my-slug");
    expect(ui.input).not.toHaveBeenCalled();
  });

  it("forwards placeholder + signal to pi.ui.input", async () => {
    const ui = fakeUi();
    ui.input.mockResolvedValue("typed");
    const ctrl = new AbortController();
    const a = new AskUser(ui as never);
    await a.input({ key: "k", title: "Slug?", placeholder: "hyphenated", signal: ctrl.signal });
    expect(ui.input).toHaveBeenCalledWith("Slug?", "hyphenated", { signal: ctrl.signal });
  });
});

describe("M3: AskUser.confirm", () => {
  it("returns prompt value without asking UI (boolean false)", async () => {
    const ui = fakeUi();
    const a = new AskUser(ui as never);
    const r = await a.confirm({ key: "k", title: "Confirm?", message: "ok", prompt: false });
    expect(r).toBe(false);
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("falls through to UI and caches", async () => {
    const ui = fakeUi();
    ui.confirm.mockResolvedValue(true);
    const a = new AskUser(ui as never);
    expect(await a.confirm({ key: "k", title: "Resume?", message: "?" })).toBe(true);
    expect(await a.confirm({ key: "k", title: "Resume?", message: "?" })).toBe(true);
    expect(ui.confirm).toHaveBeenCalledTimes(1);
  });
});

describe("M3: AskUser AbortSignal", () => {
  it("returns undefined immediately if signal already aborted before UI call", async () => {
    const ui = fakeUi();
    const ctrl = new AbortController();
    ctrl.abort();
    const a = new AskUser(ui as never);
    const r = await a.select({ key: "k", title: "t", options: ["a", "b"], signal: ctrl.signal });
    expect(r).toBeUndefined();
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("does not short-circuit on aborted signal when chain provides a value", async () => {
    const ui = fakeUi();
    const ctrl = new AbortController();
    ctrl.abort();
    const a = new AskUser(ui as never);
    const r = await a.select({ key: "k", title: "t", options: [], project: "j", signal: ctrl.signal });
    expect(r).toBe("j");
  });
});
