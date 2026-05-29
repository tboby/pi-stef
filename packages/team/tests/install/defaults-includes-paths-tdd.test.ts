/**
 * S-601: Verify config/defaults.json ships the paths and tdd sections,
 * and that resolveDefaults materialises them when no user config exists.
 *
 * Acceptance criteria:
 * - config/defaults.json has paths.git_mode === "auto" and tdd.mode === "auto"
 * - resolveDefaults({}) returns defaults with those sections populated
 * - resolveDefaults(userConfig) does NOT overwrite a user-supplied value
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveDefaults } from "../../src/config/load";

const DEFAULTS_JSON_PATH = path.join(__dirname, "..", "..", "config", "defaults.json");

describe("S-601: config/defaults.json includes paths and tdd sections", () => {
  it("defaults.json has paths.git_mode = 'auto'", () => {
    const raw = JSON.parse(readFileSync(DEFAULTS_JSON_PATH, "utf8"));
    expect(raw).toHaveProperty("paths");
    expect(raw.paths).toHaveProperty("git_mode", "auto");
  });

  it("defaults.json has tdd.mode = 'auto'", () => {
    const raw = JSON.parse(readFileSync(DEFAULTS_JSON_PATH, "utf8"));
    expect(raw).toHaveProperty("tdd");
    expect(raw.tdd).toHaveProperty("mode", "auto");
  });
});

describe("S-601: resolveDefaults materialises paths and tdd when no config exists", () => {
  it("resolveDefaults({}) has paths.git_mode = 'auto'", () => {
    const d = resolveDefaults({});
    expect(d.paths).toHaveProperty("git_mode", "auto");
  });

  it("resolveDefaults({}) has tdd.mode = 'auto'", () => {
    const d = resolveDefaults({});
    expect(d.tdd).toHaveProperty("mode", "auto");
  });

  it("resolveDefaults with user git_mode='on' does NOT revert to 'auto'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = resolveDefaults({ paths: { git_mode: "on" } as any });
    expect(d.paths.git_mode).toBe("on");
  });

  it("resolveDefaults with user tdd.mode='off' does NOT revert to 'auto'", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = resolveDefaults({ tdd: { mode: "off" } as any });
    expect(d.tdd.mode).toBe("off");
  });
});
