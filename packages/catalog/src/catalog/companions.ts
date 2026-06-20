/**
 * Companion-package resolution for the catalog.
 *
 * A package may declare required companion sources in its own
 * `package.json` under `pi.companions` (a string array of npm:/git: sources).
 * When the catalog installs such a package it also installs each companion
 * that is not already installed.
 */

/** A parsed package.json-shaped object (only the fields we read). */
export interface PackageManifest {
  name?: string;
  pi?: {
    companions?: unknown;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Extract the list of companion source strings from a package manifest.
 * Returns an empty array when none are declared or the shape is invalid.
 * Non-string and empty entries are filtered out (defensive).
 */
export function readCompanionsFromManifest(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const pi = (manifest as PackageManifest).pi;
  if (!pi || typeof pi !== "object") return [];
  const raw = (pi as { companions?: unknown }).companions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string" && c.length > 0);
}
