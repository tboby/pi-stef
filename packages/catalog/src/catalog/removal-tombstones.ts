import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { catalogDir } from "../config/paths";
import type { CatalogYaml } from "../config/schema";

/** Apply tombstones to a catalog: drop any packages named in the log. */
export function applyRemovalTombstones(
  catalog: CatalogYaml,
  home?: string,
): CatalogYaml {
  const removed = new Set(readTombstones(home));
  for (const key of removed) {
    delete catalog.packages[key];
  }
  return catalog;
}

/**
 * Lightweight tombstone log for packages explicitly removed via ct remove.
 *
 * Problem: ct remove deletes the package from the local cat.yaml. The next
 * ct sync pulls the remote catalog (which still has the package) and the
 * reconcile step has no way to know the local deletion was intentional vs.
 * a package the user never had. The result: the removed package gets
 * re-installed.
 *
 * Solution: ct remove writes a tombstone record. ct sync reads it, drops
 * matching packages from the merged catalog, and deletes the tombstones
 * (they've served their purpose — the next push will remove them from the
 * remote too).
 */

const TOMBSTONE_FILE = "removed.json";

function tombstonePath(home?: string): string {
  return path.join(catalogDir(home), TOMBSTONE_FILE);
}

/** Write a tombstone for a removed package name. */
export function recordRemoval(name: string, home?: string): void {
  const existing = readTombstones(home);
  existing.push(name);
  writeFileSync(tombstonePath(home), JSON.stringify(existing), "utf8");
}

/** Read all tombstone records. */
export function readTombstones(home?: string): string[] {
  const p = tombstonePath(home);
  if (!existsSync(p)) return [];
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Corrupt file — nuke it.
  }
  return [];
}

/** Clear the tombstone log after a successful push. */
export function clearTombstones(home?: string): void {
  const p = tombstonePath(home);
  try {
    if (existsSync(p)) unlinkSync(p);
  } catch {
    // best effort
  }
}
