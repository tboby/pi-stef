/**
 * Integration tests for the full catalog lifecycle.
 *
 * These tests exercise the real command implementations end-to-end using
 * temporary directories and mocked network/shell layers. They are gated
 * behind `process.env.CATALOG_INTEGRATION` so they don't run in CI without
 * explicit setup.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import yaml from "js-yaml";

import type { CatalogYaml } from "../../src/config/schema.js";
import { initCommand } from "../../src/commands/init.js";
import { addCommand } from "../../src/commands/add.js";
import { statusCommand } from "../../src/commands/status.js";
import { profilesCommand, profileCommand } from "../../src/commands/profiles.js";
import { writeCatalog } from "../../src/config/io.js";
import { catalogFile } from "../../src/config/paths.js";

// ---------------------------------------------------------------------------
// Integration guard
// ---------------------------------------------------------------------------

const RUN = process.env.CATALOG_INTEGRATION;

// ---------------------------------------------------------------------------
// Mocks — only network and shell operations are mocked
// ---------------------------------------------------------------------------

vi.mock("../../src/catalog/install.js", () => ({
  scanInstalled: vi.fn(),
}));

import { scanInstalled } from "../../src/catalog/install.js";

const mockedScanInstalled = vi.mocked(scanInstalled);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;
const notifications: Array<{ msg: string; type?: string }> = [];

function makeCtx(overrides: Record<string, unknown> = {}) {
  notifications.length = 0;
  return {
    home: tmpDir,
    ui: {
      notify: vi.fn((msg: string, type?: "error" | "info" | "warning") => {
        notifications.push({ msg, type });
      }),
      select: vi.fn().mockResolvedValue("skill"),
      confirm: vi.fn().mockResolvedValue(true),
    },
    ...overrides,
  };
}

function readCatalogFromDisk(): CatalogYaml {
  const filePath = catalogFile(tmpDir);
  const raw = fs.readFileSync(filePath, "utf-8");
  return yaml.load(raw) as CatalogYaml;
}

function writeCatalogToDisk(catalog: CatalogYaml): void {
  writeCatalog(catalog, tmpDir);
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe.skipIf(!RUN)("Integration: full lifecycle", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-integ-"));
    vi.clearAllMocks();
    mockedScanInstalled.mockReturnValue({});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // (1) Fresh init → add 3 packages → status shows correct state
  // -------------------------------------------------------------------------

  describe("init → add → status", () => {
    it("initializes an empty catalog and adds 3 packages, then status shows correct counts", async () => {
      // --- Step 1: Init (empty system) ---
      mockedScanInstalled.mockReturnValue({});

      const ctx = makeCtx();
      await initCommand({ positional: [], flags: {} }, ctx);

      let catalog = readCatalogFromDisk();
      expect(Object.keys(catalog.packages)).toHaveLength(0);
      expect(catalog.meta.pi_version).toBe("0.0.0");

      // --- Step 2: Add 3 packages ---
      // Mock piInstall to avoid real shell calls
      const execModule = await import("../../src/util/exec.js");
      const installSpy = vi.spyOn(execModule, "piInstall").mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      catalog = readCatalogFromDisk();
      writeCatalogToDisk(catalog);

      const packages = [
        { name: "core-skill", source: "npm:core-skill" },
        { name: "useful-tool", source: "npm:useful-tool" },
        { name: "git-skill", source: "git:github.com/user/repo" },
      ];

      for (const pkg of packages) {
        await addCommand(
          {
            positional: [pkg.name, pkg.source],
            flags: { type: "skill" },
          },
          ctx,
        );
      }

      installSpy.mockRestore();

      // Verify catalog on disk
      catalog = readCatalogFromDisk();
      expect(Object.keys(catalog.packages)).toHaveLength(3);
      expect(catalog.packages["core-skill"]).toEqual({
        source: "npm:core-skill",
        type: "skill",
      });
      expect(catalog.packages["useful-tool"]).toEqual({
        source: "npm:useful-tool",
        type: "skill",
      });
      expect(catalog.packages["git-skill"]).toEqual({
        source: "git:github.com/user/repo",
        type: "skill",
      });

      // --- Step 3: Status shows correct state ---
      // Mock scanInstalled to reflect 2 of 3 packages installed
      mockedScanInstalled.mockReturnValue({
        "core-skill": { source: "npm:core-skill", name: "core-skill", version: "1.0.0" },
        "useful-tool": { source: "npm:useful-tool", name: "useful-tool", version: "2.0.0" },
      });

      notifications.length = 0;
      await statusCommand({ positional: [], flags: {} }, makeCtx());

      const statusMsg = notifications.map((n) => n.msg).join("\n");
      expect(statusMsg).toContain("3 total");
      expect(statusMsg).toContain("3 enabled");
      expect(statusMsg).toContain("Installed: 2");
      expect(statusMsg).toContain("Missing: 1");
    });
  });

  // -------------------------------------------------------------------------
  // (2) profile create → switch → verify correct packages active
  // -------------------------------------------------------------------------

  describe("profile lifecycle", () => {
    it("creates a profile, switches to it, and verifies packages", async () => {
      // Start with a catalog that has base packages
      const baseCatalog: CatalogYaml = {
        meta: { pi_version: "1.0.0" },
        packages: {
          "base-tool": { source: "npm:base-tool" },
        },
      };
      writeCatalogToDisk(baseCatalog);

      // --- Create a "work" profile ---
      const createCtx = makeCtx();
      await profileCommand(
        { positional: ["work"], flags: { create: true } },
        createCtx,
      );

      const afterCreate = readCatalogFromDisk();
      expect(afterCreate.profiles).toBeDefined();
      expect(afterCreate.profiles!["work"]).toEqual({ packages: {} });

      // --- Switch to "work" profile ---
      const switchCtx = makeCtx();
      await profileCommand(
        { positional: ["work"], flags: {} },
        switchCtx,
      );

      const afterSwitch = readCatalogFromDisk();
      expect(afterSwitch.meta.activeProfile).toBe("work");

      // --- List profiles ---
      const listCtx = makeCtx();
      await profilesCommand({ positional: [], flags: {} }, listCtx);

      const listMsg = notifications.map((n) => n.msg).join("\n");
      expect(listMsg).toContain("default");
      expect(listMsg).toContain("work");
      // work should be marked active
      const lines = listMsg.split("\n");
      const workLine = lines.find((l: string) => l.includes("work") && l.includes("*"));
      expect(workLine).toBeDefined();

      // --- Show current profile ---
      notifications.length = 0;
      const showCtx = makeCtx();
      await profileCommand({ positional: [], flags: {} }, showCtx);

      const showMsg = notifications.map((n) => n.msg).join("\n");
      expect(showMsg).toContain("work");

      // --- Delete profile ---
      const deleteCtx = makeCtx();
      await profileCommand(
        { positional: ["work"], flags: { delete: true } },
        deleteCtx,
      );

      const afterDelete = readCatalogFromDisk();
      expect(afterDelete.profiles?.["work"]).toBeUndefined();
    });
  });


});
