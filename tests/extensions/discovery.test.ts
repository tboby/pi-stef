import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  reconcileLocalExtensions,
  executeLocalExtensionActions,
  type LocalExtensionEntry,
} from "../../src/extensions/discovery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe("reconcileLocalExtensions", () => {
  it("produces enable actions for disabled extensions in the desired set", () => {
    const current: LocalExtensionEntry[] = [
      { path: "foo.ts", state: "disabled", activePath: "/ext/foo.ts", disabledPath: "/ext/foo.ts.disabled" },
      { path: "bar.ts", state: "enabled", activePath: "/ext/bar.ts", disabledPath: "/ext/bar.ts.disabled" },
    ];

    const result = reconcileLocalExtensions(["foo.ts", "bar.ts"], current);

    expect(result.enables).toHaveLength(1);
    expect(result.enables[0].path).toBe("foo.ts");
    expect(result.disables).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("produces disable actions for enabled extensions not in desired set", () => {
    const current: LocalExtensionEntry[] = [
      { path: "foo.ts", state: "enabled", activePath: "/ext/foo.ts", disabledPath: "/ext/foo.ts.disabled" },
      { path: "bar.ts", state: "enabled", activePath: "/ext/bar.ts", disabledPath: "/ext/bar.ts.disabled" },
    ];

    const result = reconcileLocalExtensions(["foo.ts"], current);

    expect(result.enables).toHaveLength(0);
    expect(result.disables).toHaveLength(1);
    expect(result.disables[0].path).toBe("bar.ts");
    expect(result.warnings).toHaveLength(0);
  });

  it("produces no actions when current state already matches desired", () => {
    const current: LocalExtensionEntry[] = [
      { path: "foo.ts", state: "enabled", activePath: "/ext/foo.ts", disabledPath: "/ext/foo.ts.disabled" },
      { path: "bar.ts", state: "disabled", activePath: "/ext/bar.ts", disabledPath: "/ext/bar.ts.disabled" },
    ];

    const result = reconcileLocalExtensions(["foo.ts"], current);

    expect(result.enables).toHaveLength(0);
    expect(result.disables).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns about desired extensions not found on disk", () => {
    const current: LocalExtensionEntry[] = [
      { path: "foo.ts", state: "enabled", activePath: "/ext/foo.ts", disabledPath: "/ext/foo.ts.disabled" },
    ];

    const result = reconcileLocalExtensions(["foo.ts", "nonexistent.ts"], current);

    expect(result.enables).toHaveLength(0);
    expect(result.disables).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("nonexistent.ts");
  });

  it("handles empty desired set by disabling everything", () => {
    const current: LocalExtensionEntry[] = [
      { path: "foo.ts", state: "enabled", activePath: "/ext/foo.ts", disabledPath: "/ext/foo.ts.disabled" },
      { path: "bar/", state: "enabled", activePath: "/ext/bar/index.ts", disabledPath: "/ext/bar/index.ts.disabled" },
    ];

    const result = reconcileLocalExtensions([], current);

    expect(result.enables).toHaveLength(0);
    expect(result.disables).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles empty current state with desired extensions", () => {
    const result = reconcileLocalExtensions(["foo.ts"], []);

    expect(result.enables).toHaveLength(0);
    expect(result.disables).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("foo.ts");
  });
});

// ---------------------------------------------------------------------------
// executeLocalExtensionActions
// ---------------------------------------------------------------------------

describe("executeLocalExtensionActions", () => {
  it("renames disabled → enabled for enable actions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-exec-"));
    const activePath = join(dir, "foo.ts");
    const disabledPath = join(dir, "foo.ts.disabled");
    await writeFile(disabledPath, "// test");

    const result = await executeLocalExtensionActions([
      { type: "enable", path: "foo.ts", activePath, disabledPath },
    ]);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Verify file was renamed
    const fs = await import("node:fs/promises");
    await expect(fs.access(activePath)).resolves.toBeUndefined();
    await expect(fs.access(disabledPath)).rejects.toThrow();

    await rm(dir, { recursive: true, force: true });
  });

  it("renames enabled → disabled for disable actions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-exec-"));
    const activePath = join(dir, "foo.ts");
    const disabledPath = join(dir, "foo.ts.disabled");
    await writeFile(activePath, "// test");

    const result = await executeLocalExtensionActions([
      { type: "disable", path: "foo.ts", activePath, disabledPath },
    ]);

    expect(result.success).toBe(true);
    await expect(
      import("node:fs/promises").then((fs) => fs.access(disabledPath)),
    ).resolves.toBeUndefined();

    await rm(dir, { recursive: true, force: true });
  });

  it("collects errors without aborting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ext-exec-"));
    const missingPath = join(dir, "nonexistent.ts");
    const missingDisabled = join(dir, "nonexistent.ts.disabled");

    const result = await executeLocalExtensionActions([
      { type: "enable", path: "missing.ts", activePath: missingPath, disabledPath: missingDisabled },
    ]);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("missing.ts");

    await rm(dir, { recursive: true, force: true });
  });
});
