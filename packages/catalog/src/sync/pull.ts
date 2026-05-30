import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { catalogDir } from "../config/paths.js";
import { CatalogYamlSchema, LockFileSchema } from "../config/schema.js";
import type { CatalogYaml, LockFile } from "../config/schema.js";
import { readGist, findGistByDescription } from "./gist.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a pull operation. */
export interface PullResult {
  catalog: CatalogYaml;
  lock: LockFile;
}

// ---------------------------------------------------------------------------
// Gist ID cache
// ---------------------------------------------------------------------------

/**
 * Path to the `.gist` file that caches the gist ID for a profile.
 */
function gistCachePath(home?: string): string {
  return path.join(catalogDir(home), ".gist");
}

/** Read the cached gist ID, or `undefined` if not cached. */
function readCachedGistId(home?: string): string | undefined {
  const cacheFile = gistCachePath(home);
  try {
    if (fs.existsSync(cacheFile)) {
      const id = fs.readFileSync(cacheFile, "utf-8").trim();
      return id.length > 0 ? id : undefined;
    }
  } catch {
    // ignore read errors
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// pullCatalog
// ---------------------------------------------------------------------------

/**
 * Fetch a catalog and lock file from a GitHub Gist and deserialize them.
 *
 * Strategy:
 *  1. Check for a cached gist ID in `~/.pi/sf/catalog/.gist`.
 *  2. If no cached ID, search for an existing gist by description.
 *  3. Fetch the gist and read its files.
 *  4. Deserialize `cat.yaml` → CatalogYaml and `catalog.lock.json` → LockFile.
 *
 * Throws if no gist is found for the given profile.
 */
export async function pullCatalog(
  profile: string,
  home?: string,
): Promise<PullResult> {
  const description = `catalog-${profile}`;

  // 1. Check for cached gist ID
  let gistId = readCachedGistId(home);

  // 2. If no cached ID, find existing gist by description
  if (!gistId) {
    const existing = await findGistByDescription(description);
    if (existing) {
      gistId = existing.id;
    }
  }

  if (!gistId) {
    throw new Error(`No gist found for profile "${profile}" (description: "${description}")`);
  }

  // 3. Fetch gist files
  const gist = await readGist(gistId);

  // 4. Deserialize
  const catYamlContent = gist.files["cat.yaml"]?.content ?? "";
  const lockJsonContent = gist.files["catalog.lock.json"]?.content ?? "";

  const parsedYaml = yaml.load(catYamlContent);
  const catalog: CatalogYaml = CatalogYamlSchema.parse(parsedYaml);

  const parsedLock = JSON.parse(lockJsonContent);
  const lock: LockFile = LockFileSchema.parse(parsedLock);

  return { catalog, lock };
}
