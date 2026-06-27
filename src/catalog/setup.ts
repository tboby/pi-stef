/**
 * Setup detection for packages that need additional configuration.
 *
 * Packages can include a `.pi-setup.json` file in their install directory
 * declaring requirements:
 *   - `env`: required environment variables
 *   - `files`: required config files (relative to config dir ~/.pi/sf/<pkg>/)
 *   - `cli`: required CLI tools (checked via `which`)
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { parseSource } from "./source.js";
import { npmNodeModulesDir } from "../config/paths.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const SetupCheckSchema = z.object({
  /** Required environment variables. */
  env: z.array(z.string()).optional(),
  /** Required config files (relative to config dir). */
  files: z.array(z.string()).optional(),
  /** Required CLI tools (checked via `which`). */
  cli: z.array(z.string()).optional(),
});

export type SetupCheck = z.infer<typeof SetupCheckSchema>;

export interface SetupStatus {
  /** Whether all requirements are met. */
  ok: boolean;
  /** Missing environment variables. */
  missingEnv: string[];
  /** Missing config files. */
  missingFiles: string[];
  /** Missing CLI tools. */
  missingCli: string[];
}

// ---------------------------------------------------------------------------
// checkSetup
// ---------------------------------------------------------------------------

/**
 * Check setup requirements for a package.
 *
 * @param installDir - The package's installed directory (where .pi-setup.json lives)
 * @param configDir - The package's config directory (~/.pi/sf/<pkg>/)
 * @returns Setup status with missing requirements, or undefined if no .pi-setup.json
 */
export function checkSetup(
  installDir: string,
  configDir: string,
): SetupStatus | undefined {
  const setupPath = path.join(installDir, ".pi-setup.json");

  if (!fs.existsSync(setupPath)) {
    return undefined;
  }

  let raw: unknown;
  try {
    const content = fs.readFileSync(setupPath, "utf-8");
    raw = JSON.parse(content);
  } catch {
    console.warn(`Warning: malformed .pi-setup.json in ${installDir}`);
    return undefined;
  }

  const parsed = SetupCheckSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`Warning: invalid .pi-setup.json in ${installDir}: ${parsed.error.message}`);
    return undefined;
  }

  const check = parsed.data;
  const missingEnv: string[] = [];
  const missingFiles: string[] = [];
  const missingCli: string[] = [];

  // Check environment variables
  if (check.env) {
    for (const varName of check.env) {
      if (!process.env[varName]) {
        missingEnv.push(varName);
      }
    }
  }

  // Check config files
  if (check.files) {
    for (const filePath of check.files) {
      const fullPath = path.join(configDir, filePath);
      if (!fs.existsSync(fullPath)) {
        missingFiles.push(filePath);
      }
    }
  }

  // Check CLI tools
  if (check.cli) {
    for (const tool of check.cli) {
      const result = spawnSync("which", [tool], {
        stdio: "pipe",
        timeout: 5000,
      });
      if (result.status !== 0) {
        missingCli.push(tool);
      }
    }
  }

  const ok =
    missingEnv.length === 0 &&
    missingFiles.length === 0 &&
    missingCli.length === 0;

  return { ok, missingEnv, missingFiles, missingCli };
}

/**
 * Format a setup status as a human-readable message.
 */
export function formatSetupStatus(status: SetupStatus): string {
  const parts: string[] = [];
  if (status.missingEnv.length > 0) {
    parts.push(`Missing env: ${status.missingEnv.join(", ")}`);
  }
  if (status.missingFiles.length > 0) {
    parts.push(`Missing files: ${status.missingFiles.join(", ")}`);
  }
  if (status.missingCli.length > 0) {
    parts.push(`Missing CLI: ${status.missingCli.join(", ")}`);
  }
  return parts.join("; ");
}

/**
 * Check setup requirements for a package by source string.
 *
 * Derives install dir from source type and config dir from home.
 * Returns undefined if no .pi-setup.json exists.
 */
export function checkSetupForSource(
  source: string,
  home?: string,
): SetupStatus | undefined {
  const parsed = parseSource(source);
  const resolvedHome = home ?? os.homedir();

  let installDir: string | undefined;
  if (parsed.type === "npm") {
    installDir = path.join(npmNodeModulesDir(resolvedHome), parsed.npmName!);
  } else if (parsed.type === "local") {
    const settingsDir = path.join(resolvedHome, ".pi", "agent");
    installDir = path.resolve(settingsDir, source);
  } else {
    // git sources — no known install dir
    return undefined;
  }

  const configDir = path.join(resolvedHome, ".pi", "sf", parsed.name);
  return checkSetup(installDir, configDir);
}
