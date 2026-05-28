import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { loadAndResolveDefaults } from "../src/config/load";

describe("DEFAULT_CONFIG — paths/tdd fields", () => {
  it("DEFAULT_CONFIG.paths.git_mode === 'auto'", () => {
    expect(DEFAULT_CONFIG.paths.git_mode).toBe("auto");
  });

  it("DEFAULT_CONFIG.paths.ai_plan_root === undefined", () => {
    expect(DEFAULT_CONFIG.paths.ai_plan_root).toBeUndefined();
  });

  it("DEFAULT_CONFIG.tdd.mode === 'auto'", () => {
    expect(DEFAULT_CONFIG.tdd.mode).toBe("auto");
  });
});

describe("loadAndResolveDefaults — paths/tdd fields", () => {
  it("returns paths/tdd defaults when no config files are present", async () => {
    const tmpdir = path.join(os.tmpdir(), `schema-test-${Date.now()}`);
    const resolved = await loadAndResolveDefaults(tmpdir, { homeDir: tmpdir });
    expect(resolved.paths.git_mode).toBe("auto");
    expect(resolved.paths.ai_plan_root).toBeUndefined();
    expect(resolved.tdd.mode).toBe("auto");
  });
});
