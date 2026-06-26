/**
 * `ct init` command implementation.
 *
 * Scans currently installed pi packages and generates `cat.yaml`.
 */

import fs from "node:fs";
import { scanInstalled } from "../catalog/install.js";
import type { CatalogYaml } from "../config/schema.js";
import type { CommandArgs, CommandCtx } from "./types.js";
import { catalogFile } from "../config/paths.js";
import { readCatalog, writeCatalog } from "../config/io.js";
import { discoverLocalExtensions } from "../extensions/discovery.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context for `initCommand`. Uses the base `CommandCtx`. */
export type InitContext = CommandCtx;

// ---------------------------------------------------------------------------
// initCommand
// ---------------------------------------------------------------------------

/**
 * Initialize a new catalog by scanning installed packages.
 */
export async function initCommand(
  args: CommandArgs,
  ctx: InitContext,
): Promise<void> {
  const { flags } = args;
  const force = "force" in flags || "f" in flags;
  await initFromScan(ctx, force);
}

// ---------------------------------------------------------------------------
// initFromScan
// ---------------------------------------------------------------------------

async function initFromScan(ctx: InitContext, force = false): Promise<void> {
  // Refuse if cat.yaml already exists with meaningful content (unless --force)
  if (!force) {
    const catPath = catalogFile(ctx.home);
    if (fs.existsSync(catPath)) {
      const existing = readCatalog(ctx.home);
      const hasData =
        existing.profiles !== undefined ||
        existing.local_extensions !== undefined ||
        Object.keys(existing.packages).length > 0;
      if (hasData) {
        ctx.ui.notify(
          "cat.yaml already exists with packages, profiles, or local extensions. Use `ct init --force` to overwrite.",
          "warning",
        );
        return;
      }
    }
  }

  let installed: Record<string, { source: string }>;
  try {
    installed = scanInstalled(ctx.home);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(`Failed to scan installed packages: ${message}`, "error");
    return;
  }
  const names = Object.keys(installed);

  const packages: CatalogYaml["packages"] = {};
  for (const [name, pkg] of Object.entries(installed)) {
    packages[name] = {
      source: pkg.source,
    };
  }

  // Capture enabled local extensions
  let local_extensions: string[] | undefined;
  try {
    const extEntries = await discoverLocalExtensions();
    const enabled = extEntries.filter((e) => e.state === "enabled");
    if (enabled.length > 0) {
      local_extensions = enabled.map((e) => e.path);
    }
  } catch {
    // Non-fatal — skip local extensions if discovery fails
  }

  const catalog: CatalogYaml = {
    meta: { pi_version: "0.0.0" },
    packages,
  };

  if (local_extensions) {
    catalog.local_extensions = local_extensions;
  }

  writeCatalog(catalog, ctx.home);

  const extCount = local_extensions?.length ?? 0;
  ctx.ui.notify(
    `Initialized catalog with ${names.length} package${names.length === 1 ? "" : "s"}${extCount > 0 ? ` and ${extCount} local extension${extCount === 1 ? "" : "s"}` : ""}.`,
    "info",
  );
}


