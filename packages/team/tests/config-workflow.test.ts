import { describe, expect, it, vi } from "vitest";

import { resolveDefaults } from "../src/config/load";
import {
  effectiveTmuxManager,
  effectiveUi,
  implementationReviewMaxRounds,
  isHeadlessWorkflow,
  planReviewMaxRounds,
  workflowProfile,
} from "../src/config/workflow";

describe("workflow profile helpers", () => {
  it("identifies the default and headless profiles", () => {
    expect(workflowProfile(undefined)).toBe("default");
    expect(isHeadlessWorkflow(resolveDefaults({}))).toBe(false);
    expect(isHeadlessWorkflow(resolveDefaults({ workflow: { profile: "headless" } } as never))).toBe(true);
  });

  it("drops UI and tmux side channels in headless mode", () => {
    const headless = resolveDefaults({ workflow: { profile: "headless" } } as never);
    const ui = { notify: vi.fn() } as never;
    const tmux = { closeAllPanes: vi.fn() } as never;
    expect(effectiveUi(ui, headless)).toBeUndefined();
    expect(effectiveTmuxManager(tmux, headless)).toBeNull();
  });

  it("keeps UI and tmux side channels in the default profile", () => {
    const defaults = resolveDefaults({});
    const ui = { notify: vi.fn() } as never;
    const tmux = { closeAllPanes: vi.fn() } as never;
    expect(effectiveUi(ui, defaults)).toBe(ui);
    expect(effectiveTmuxManager(tmux, defaults)).toBe(tmux);
  });

  it("resolves phase-specific review limits with prompt overrides first", () => {
    const headless = resolveDefaults({ workflow: { profile: "headless" } } as never);
    expect(planReviewMaxRounds(undefined, headless)).toBe(3);
    expect(implementationReviewMaxRounds(undefined, headless)).toBe(4);
    expect(planReviewMaxRounds(8, headless)).toBe(8);
    expect(implementationReviewMaxRounds(8, headless)).toBe(8);
  });
});
