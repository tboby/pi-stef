import { describe, expect, it } from "vitest";

import { AskUser } from "../src/ask-user";

/**
 * Audit fix: pi.ui.confirm returns Promise<boolean>, not Promise<boolean | undefined>.
 * The original implementation did `const final = answer ?? opts.default` which
 * was dead code (a returned `false` was a valid answer, not undefined). The fix:
 * default fires only when the call cannot run (e.g., signal aborted), and a
 * real `false` from pi.ui.confirm is preserved as `false`.
 */
describe("audit fix: ask-user.confirm fallthrough is reachable and preserves false", () => {
  it("preserves a real `false` answer from pi.ui.confirm (does not coerce to default)", async () => {
    const ui = {
      select: async () => undefined,
      input: async () => undefined,
      // user explicitly answered false
      confirm: async () => false,
      notify: () => undefined,
    } as unknown as ConstructorParameters<typeof AskUser>[0];
    const askUser = new AskUser(ui);
    const result = await askUser.confirm({
      key: "k1",
      title: "Push?",
      message: "Push commit?",
      default: true,
    });
    expect(result).toBe(false);
  });

  it("returns the explicit default when the call is short-circuited by an aborted signal", async () => {
    const ui = {
      select: async () => undefined,
      input: async () => undefined,
      confirm: async () => true, // would normally return true
      notify: () => undefined,
    } as unknown as ConstructorParameters<typeof AskUser>[0];
    const askUser = new AskUser(ui);
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await askUser.confirm({
      key: "k2",
      title: "x",
      message: "y",
      default: false,
      signal: ctrl.signal,
    });
    // Audit fix: the explicit default fires when the call cannot run (signal
    // pre-aborted). Previously this returned undefined, dropping the default.
    expect(result).toBe(false);
  });

  it("uses prompt-tier override even when ui.confirm would return false", async () => {
    const ui = {
      select: async () => undefined,
      input: async () => undefined,
      confirm: async () => false,
      notify: () => undefined,
    } as unknown as ConstructorParameters<typeof AskUser>[0];
    const askUser = new AskUser(ui);
    const result = await askUser.confirm({ key: "k3", title: "x", message: "y", prompt: true });
    expect(result).toBe(true);
  });
});
