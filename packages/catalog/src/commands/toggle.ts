/**
 * `ct toggle`, `ct enable`, and `ct disable` subcommand implementations.
 *
 * - `ct toggle <name>` toggles a package's enabled state (enabled ↔ disabled)
 * - `ct enable <name>` enables a disabled package. No-op when already enabled.
 * - `ct disable <name>` disables a package and runs `pi uninstall`.
 *
 * All commands read/write `cat.yaml` via `readCatalog` / `writeCatalog`
 * and provide user feedback through `ctx.ui.notify`.
 */

import { togglePackage, enablePackage, disablePackage } from "../catalog/crud.js";
import type { CommandArgs, CommandCtx } from "./types.js";
import { readCatalog, writeCatalog } from "../config/io.js";
import { piUninstall } from "../util/exec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context for toggle/enable/disable commands. Uses the base `CommandCtx`. */
export type ToggleCtx = CommandCtx;

// ---------------------------------------------------------------------------
// toggleCommand
// ---------------------------------------------------------------------------

/**
 * Execute the `ct toggle` subcommand.
 *
 * Toggles the package's enabled state: enabled ↔ disabled.
 */
export async function toggleCommand(
  args: CommandArgs,
  ctx: ToggleCtx,
): Promise<void> {
  const name = args.positional[0];

  if (!name) {
    ctx.ui.notify("Usage: ct toggle <name>", "error");
    return;
  }

  const catalog = readCatalog(ctx.home);

  try {
    const updated = togglePackage(catalog, name);
    writeCatalog(updated, ctx.home);
    const isEnabled = updated.packages[name].enabled !== false;
    ctx.ui.notify(
      `Toggled "${name}" — now ${isEnabled ? "enabled" : "disabled"}`,
      "info",
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(message, "error");
  }
}

// ---------------------------------------------------------------------------
// enableCommand
// ---------------------------------------------------------------------------

/**
 * Execute the `ct enable` subcommand.
 *
 * Enables a disabled package. No-op when the package is already enabled.
 */
export async function enableCommand(
  args: CommandArgs,
  ctx: ToggleCtx,
): Promise<void> {
  const name = args.positional[0];

  if (!name) {
    ctx.ui.notify("Usage: ct enable <name>", "error");
    return;
  }

  const catalog = readCatalog(ctx.home);

  try {
    const updated = enablePackage(catalog, name);

    // enablePackage returns the same catalog reference when it's a no-op
    if (updated === catalog) {
      ctx.ui.notify(`"${name}" is already enabled`, "info");
      return;
    }

    writeCatalog(updated, ctx.home);
    ctx.ui.notify(`Enabled "${name}"`, "info");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(message, "error");
  }
}

// ---------------------------------------------------------------------------
// disableCommand
// ---------------------------------------------------------------------------

/**
 * Execute the `ct disable` subcommand.
 *
 * Disables a package and runs `pi uninstall` to remove it.
 */
export async function disableCommand(
  args: CommandArgs,
  ctx: ToggleCtx,
): Promise<void> {
  const name = args.positional[0];

  if (!name) {
    ctx.ui.notify("Usage: ct disable <name>", "error");
    return;
  }

  const catalog = readCatalog(ctx.home);

  try {
    const updated = disablePackage(catalog, name);
    writeCatalog(updated, ctx.home);
    ctx.ui.notify(`Disabled "${name}"`, "info");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(message, "error");
    return;
  }

  // Run pi uninstall after disabling
  ctx.ui.setWorkingMessage?.(`Uninstalling ${name}...`);
  try {
    await piUninstall(name);
  } catch {
    ctx.ui.notify(
      `Warning: "${name}" disabled in catalog but uninstall failed`,
      "warning",
    );
  }
  ctx.ui.setWorkingMessage?.();
}
