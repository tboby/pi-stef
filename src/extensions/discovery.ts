/**
 * Local extension discovery and state management.
 *
 * Scans ~/.pi/agent/extensions/ for pi extension entries and determines
 * their enabled/disabled state based on the `.disabled` suffix convention
 * used by pi-extmgr.
 *
 * Only global ~/.pi/agent/extensions/ is scanned — project-local
 * .pi/extensions/ is not profile-managed.
 */

import { type Dirent } from "node:fs";
import { readdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Suffix appended to disabled extension files. */
export const DISABLED_SUFFIX = ".disabled";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocalExtensionState = "enabled" | "disabled";

export interface LocalExtensionEntry {
  /** Relative path under extensions dir (e.g. "research-archive.ts", "subagent/"). */
  path: string;
  /** Current enabled/disabled state. */
  state: LocalExtensionState;
  /** Absolute path to the active (enabled) file. */
  activePath: string;
  /** Absolute path to the disabled file (with .disabled suffix). */
  disabledPath: string;
}

export interface ReconcileLocalExtensionsResult {
  enables: LocalExtensionAction[];
  disables: LocalExtensionAction[];
  warnings: string[];
}

export interface LocalExtensionAction {
  type: "enable" | "disable";
  path: string;
  activePath: string;
  disabledPath: string;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Get the global extensions directory path.
 */
export function globalExtensionsDir(): string {
  return join(homedir(), ".pi", "agent", "extensions");
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover all local extensions in ~/.pi/agent/extensions/.
 *
 * Returns entries sorted by path.
 */
export async function discoverLocalExtensions(): Promise<LocalExtensionEntry[]> {
  const root = globalExtensionsDir();
  const entries: LocalExtensionEntry[] = [];

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(root, { withFileTypes: true });
  } catch (error: unknown) {
    // ENOENT is expected — no extensions directory yet
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  for (const item of dirEntries) {
    const name = item.name;

    // Skip hidden files/directories
    if (name.startsWith(".")) continue;

    if (item.isFile()) {
      const entry = parseTopLevelFile(root, name);
      if (entry) entries.push(entry);
    } else if (item.isDirectory()) {
      const dirEntries = await parseDirectoryExtensions(root, name);
      entries.push(...dirEntries);
    }
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

/**
 * Parse a top-level .ts/.js file as an extension entry.
 */
function parseTopLevelFile(
  root: string,
  fileName: string,
): LocalExtensionEntry | undefined {
  const isEnabled = /\.(ts|js)$/i.test(fileName) && !fileName.endsWith(DISABLED_SUFFIX);
  const isDisabled = /\.(ts|js)\.disabled$/i.test(fileName);

  if (!isEnabled && !isDisabled) return undefined;

  const activePath = join(root, isDisabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName);
  const disabledPath = join(root, isEnabled ? `${fileName}${DISABLED_SUFFIX}` : fileName);
  const relativePath = isDisabled ? fileName.slice(0, -DISABLED_SUFFIX.length) : fileName;

  return {
    path: relativePath,
    state: isDisabled ? "disabled" : "enabled",
    activePath,
    disabledPath,
  };
}

/**
 * Parse a directory for extension entrypoints (index.ts or manifest-declared).
 */
async function parseDirectoryExtensions(
  root: string,
  dirName: string,
): Promise<LocalExtensionEntry[]> {
  const dir = join(root, dirName);
  const entrypoints = ["index.ts", "index.js"];

  const results: LocalExtensionEntry[] = [];

  for (const entrypoint of entrypoints) {
    const activePath = join(dir, entrypoint);
    const disabledPath = join(dir, `${entrypoint}${DISABLED_SUFFIX}`);

    let state: LocalExtensionEntry["state"] | undefined;

    try {
      await readdir(dir); // check dir exists
      // Check if the entrypoint file exists (enabled or disabled)
      let dirFiles: Dirent[];
      try {
        dirFiles = await readdir(dir, { withFileTypes: true });
      } catch {
        return results; // dir got deleted mid-scan
      }

      const hasActive = dirFiles.some((f) => f.isFile() && f.name === entrypoint);
      const hasDisabled = dirFiles.some((f) => f.isFile() && f.name === `${entrypoint}${DISABLED_SUFFIX}`);

      if (hasActive) state = "enabled";
      else if (hasDisabled) state = "disabled";
      else continue; // no index file found in this dir
    } catch {
      continue; // not a directory or doesn't exist
    }

    const relativePath = `${dirName}/`;

    results.push({
      path: relativePath,
      state,
      activePath,
      disabledPath,
    });

    // Only one entrypoint per directory
    break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

/**
 * Compare desired local extensions against current state and produce
 * enable/disable actions.
 *
 * @param desired  The list of extension paths the profile wants enabled.
 * @param current  The current state of the filesystem.
 * @returns A reconcile result with actions and warnings.
 */
export function reconcileLocalExtensions(
  desired: string[],
  current: LocalExtensionEntry[],
): ReconcileLocalExtensionsResult {
  const enables: LocalExtensionAction[] = [];
  const disables: LocalExtensionAction[] = [];
  const warnings: string[] = [];

  // Build a map of current state by path
  const currentByPath = new Map<string, LocalExtensionEntry>();
  for (const entry of current) {
    currentByPath.set(entry.path, entry);
  }

  // Determine which extensions should be enabled
  const desiredSet = new Set(desired);

  // For each desired extension: enable if currently disabled
  for (const desiredPath of desired) {
    const currentEntry = currentByPath.get(desiredPath);
    if (!currentEntry) {
      warnings.push(`Extension not found: ${desiredPath}`);
      continue;
    }
    if (currentEntry.state === "disabled") {
      enables.push({
        type: "enable",
        path: desiredPath,
        activePath: currentEntry.activePath,
        disabledPath: currentEntry.disabledPath,
      });
    }
    // If already enabled, no action needed
  }

  // For each currently enabled extension: disable if not in desired set
  for (const [path, entry] of currentByPath) {
    if (entry.state === "enabled" && !desiredSet.has(path)) {
      disables.push({
        type: "disable",
        path,
        activePath: entry.activePath,
        disabledPath: entry.disabledPath,
      });
    }
  }

  return { enables, disables, warnings };
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

/**
 * Execute a list of local extension rename actions.
 *
 * All errors are collected; execution continues through remaining actions.
 */
export async function executeLocalExtensionActions(
  actions: LocalExtensionAction[],
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  for (const action of actions) {
    try {
      if (action.type === "enable") {
        await rename(action.disabledPath, action.activePath);
      } else {
        await rename(action.activePath, action.disabledPath);
      }
    } catch (err: unknown) {
      errors.push(
        `Failed to ${action.type} ${action.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { success: errors.length === 0, errors };
}
