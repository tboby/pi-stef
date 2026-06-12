import type { CatalogYaml, CatalogPackage } from "../config/schema.js";
import { isValidSource } from "./ratings.js";

// ---------------------------------------------------------------------------
// Immutable helpers
// ---------------------------------------------------------------------------

/** Shallow-clone the catalog and deep-clone the packages record. */
function cloneCatalog(catalog: CatalogYaml): CatalogYaml {
  return {
    ...catalog,
    packages: { ...catalog.packages },
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Add a new package to the catalog.
 *
 * @throws if a package with the same name already exists
 * @throws if the source format is invalid
 */
export function addPackage(
  catalog: CatalogYaml,
  name: string,
  source: string,
  type?: "skill" | "pi-native",
): CatalogYaml {
  if (catalog.packages[name]) {
    throw new Error(`Package "${name}" already exists`);
  }

  if (!isValidSource(source)) {
    throw new Error(
      `Invalid source "${source}": must start with "npm:" or "git:"`,
    );
  }

  const entry: CatalogPackage = { source };
  if (type !== undefined) {
    entry.type = type;
  }

  const next = cloneCatalog(catalog);
  next.packages[name] = entry;
  return next;
}

/**
 * Remove a package from the catalog.
 *
 * @throws if the package is not found
 */
export function removePackage(
  catalog: CatalogYaml,
  name: string,
): CatalogYaml {
  if (!catalog.packages[name]) {
    throw new Error(`Package "${name}" not found`);
  }

  const next = cloneCatalog(catalog);
  delete next.packages[name];
  return next;
}

/**
 * Toggle a package's enabled state: enabled ↔ disabled.
 *
 * @throws if the package is not found
 */
export function togglePackage(
  catalog: CatalogYaml,
  name: string,
): CatalogYaml {
  const entry = catalog.packages[name];
  if (!entry) {
    throw new Error(`Package "${name}" not found`);
  }

  const next = cloneCatalog(catalog);
  next.packages[name] = {
    ...entry,
    enabled: entry.enabled === false ? true : false,
  };
  return next;
}

/**
 * Enable a disabled package.
 * No-op when the package is already enabled.
 *
 * @throws if the package is not found
 */
export function enablePackage(
  catalog: CatalogYaml,
  name: string,
): CatalogYaml {
  const entry = catalog.packages[name];
  if (!entry) {
    throw new Error(`Package "${name}" not found`);
  }

  // No-op if already enabled
  if (entry.enabled !== false) {
    return catalog;
  }

  const next = cloneCatalog(catalog);
  next.packages[name] = { ...entry, enabled: true };
  return next;
}

/**
 * Disable a package.
 *
 * @throws if the package is not found
 */
export function disablePackage(
  catalog: CatalogYaml,
  name: string,
): CatalogYaml {
  const entry = catalog.packages[name];
  if (!entry) {
    throw new Error(`Package "${name}" not found`);
  }

  const next = cloneCatalog(catalog);
  next.packages[name] = { ...entry, enabled: false };
  return next;
}
