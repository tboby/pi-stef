import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import type { CatalogYaml } from "../../src/config/schema.js";
import type { CommandCtx } from "../../src/commands/types.js";
import { updateCommand } from "../../src/commands/update.js";
import { writeCatalog } from "../../src/config/io.js";

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function makeHome(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-catalog-update-"));
  return tmpDir;
}

function cleanup() {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Mock ctx builder
// ---------------------------------------------------------------------------

function makeCtx(): { ctx: CommandCtx; ui: { notify: ReturnType<typeof vi.fn> } } {
  const ui = { notify: vi.fn() };
  return { ctx: { ui, home: tmpDir } as unknown as CommandCtx, ui };
}

function seedCatalog(home: string, catalog?: CatalogYaml): void {
  writeCatalog(
    catalog ?? {
      meta: { pi_version: "1.0.0" },
      packages: {},
    },
    home,
  );
}

// ---------------------------------------------------------------------------
// updateCommand
// ---------------------------------------------------------------------------

describe("updateCommand", () => {
  let updateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    makeHome();
    const execModule = await import("../../src/util/exec.js");
    updateSpy = vi
      .spyOn(execModule, "piUpdate")
      .mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  });

  afterEach(() => {
    updateSpy?.mockRestore();
    cleanup();
  });

  // --- Error cases ----------------------------------------------------------

  it("shows error when no args and no --all flag", async () => {
    seedCatalog(tmpDir);
    const { ctx, ui } = makeCtx();

    await updateCommand({ positional: [], flags: {} }, ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage"),
      "error",
    );
  });

  it("shows error when package not found", async () => {
    seedCatalog(tmpDir);
    const { ctx, ui } = makeCtx();

    await updateCommand({ positional: ["nonexistent"], flags: {} }, ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("not found"),
      "error",
    );
  });

  // --- Single package update ------------------------------------------------

  it("runs pi update for a single package", async () => {
    const catalog: CatalogYaml = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg@1.0.0" },
      },
    };
    seedCatalog(tmpDir, catalog);
    const { ctx, ui } = makeCtx();

    await updateCommand({ positional: ["my-pkg"], flags: {} }, ctx);

    expect(updateSpy).toHaveBeenCalledWith("npm:my-pkg@1.0.0");
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Updated"),
      "info",
    );
  });

  it("warns when single package update fails", async () => {
    const catalog: CatalogYaml = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg@1.0.0" },
      },
    };
    seedCatalog(tmpDir, catalog);
    const { ctx, ui } = makeCtx();

    updateSpy.mockRejectedValue(new Error("update failed"));

    await updateCommand({ positional: ["my-pkg"], flags: {} }, ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("failed"),
      "warning",
    );
  });

  // --- Update all -----------------------------------------------------------

  it("updates all packages when --all flag is set", async () => {
    const catalog: CatalogYaml = {
      meta: { pi_version: "1.0.0" },
      packages: {
        pkg1: { source: "npm:pkg1@1.0.0" },
        pkg2: { source: "npm:pkg2@2.0.0" },
      },
    };
    seedCatalog(tmpDir, catalog);
    const { ctx, ui } = makeCtx();

    await updateCommand({ positional: [], flags: { all: true } }, ctx);

    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledWith("npm:pkg1@1.0.0");
    expect(updateSpy).toHaveBeenCalledWith("npm:pkg2@2.0.0");
    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Updated 2/2"),
      "info",
    );
  });

  it("reports failures when some packages fail to update", async () => {
    const catalog: CatalogYaml = {
      meta: { pi_version: "1.0.0" },
      packages: {
        pkg1: { source: "npm:pkg1@1.0.0" },
        pkg2: { source: "npm:pkg2@2.0.0" },
      },
    };
    seedCatalog(tmpDir, catalog);
    const { ctx, ui } = makeCtx();

    updateSpy
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })
      .mockRejectedValueOnce(new Error("update failed"));

    await updateCommand({ positional: [], flags: { all: true } }, ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Updated 1/2"),
      "warning",
    );
  });

  it("shows info when catalog is empty and --all is set", async () => {
    seedCatalog(tmpDir);
    const { ctx, ui } = makeCtx();

    await updateCommand({ positional: [], flags: { all: true } }, ctx);

    expect(ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("empty"),
      "info",
    );
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
