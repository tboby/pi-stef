import { describe, expect, it, vi } from "vitest";

import { preflightSkillCheck } from "../src/orchestrator/preflight";

describe("M9 preflightSkillCheck (S-901)", () => {
  it("returns resolved + missing without throwing on missing skills", async () => {
    const r = await preflightSkillCheck(["a", "b", "c"], {
      resolve: (n) => (n === "a" ? "/path/a" : n === "c" ? "/path/c" : undefined),
    });
    expect(r.resolved).toEqual([
      { name: "a", path: "/path/a" },
      { name: "c", path: "/path/c" },
    ]);
    expect(r.missing).toEqual(["b"]);
  });

  it("warns via pi.ui.notify when any skill is missing", async () => {
    const notify = vi.fn();
    await preflightSkillCheck(["nope", "alsoNope"], {
      resolve: () => undefined,
      ui: { confirm: vi.fn(), notify } as never,
    });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toContain("nope");
    expect(notify.mock.calls[0][0]).toContain("alsoNope");
    expect(notify.mock.calls[0][1]).toBe("warning");
  });

  it("does not warn when every skill resolves", async () => {
    const notify = vi.fn();
    const r = await preflightSkillCheck(["a"], {
      resolve: (n) => `/path/${n}`,
      ui: { confirm: vi.fn(), notify } as never,
    });
    expect(r.missing).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});
