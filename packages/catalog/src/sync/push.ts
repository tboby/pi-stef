import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { catalogDir } from "../config/paths.js";
import type { CatalogYaml, LockFile } from "../config/schema.js";
import {
  createGist,
  updateGist,
  findGistByDescription,
} from "./gist.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a push operation. */
export interface PushResult {
  gistId: string;
  gistUrl: string;
}

// ---------------------------------------------------------------------------
// Gist ID cache
// ---------------------------------------------------------------------------

/**
 * Path to the `.gist` file that caches the gist ID for a profile.
 * Located inside `~/.pi/sf/catalog/.gist`.
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

/** Persist the gist ID to the cache file. */
function writeCachedGistId(gistId: string, home?: string): void {
  const cacheFile = gistCachePath(home);
  const dir = path.dirname(cacheFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(cacheFile, gistId, "utf-8");
}

// ---------------------------------------------------------------------------
// pushCatalog
// ---------------------------------------------------------------------------

/**
 * Serialize a catalog and lock file, then push them to a GitHub Gist.
 *
 * Strategy:
 *  1. Check for a cached gist ID in `~/.pi/sf/catalog/.gist`.
 *  2. If no cached ID, search for an existing gist by description.
 *  3. If found, update the gist; otherwise create a new one.
 *  4. Cache the gist ID for future lookups.
 *
 * The gist description format is `catalog-<profile>`.
 * The gist contains two files: `cat.yaml` and `catalog.lock.json`.
 */
export async function pushCatalog(
  catalog: CatalogYaml,
  lock: LockFile,
  profile: string,
  home?: string,
): Promise<PushResult> {
  const description = `catalog-${profile}`;

  const files: Record<string, string> = {
    "cat.yaml": yaml.dump(catalog),
    "catalog.lock.json": JSON.stringify(lock, null, 2),
  };

  // 1. Check for cached gist ID
  let gistId = readCachedGistId(home);

  // 2. If no cached ID, find existing gist by description
  if (!gistId) {
    const existing = await findGistByDescription(description);
    if (existing) {
      gistId = existing.id;
    }
  }

  let result;

  if (gistId) {
    // 3a. Update existing gist
    result = await updateGist(gistId, files);
  } else {
    // 3b. Create new gist
    result = await createGist(files, description);
  }

  // 4. Cache the gist ID
  writeCachedGistId(result.id, home);

  return {
    gistId: result.id,
    gistUrl: result.url ?? `https://gist.github.com/${result.id}`,
  };
}
