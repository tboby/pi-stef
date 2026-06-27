/**
 * Migration: rating → enabled boolean.
 *
 * Operates on raw YAML output (before Zod validation) so that the `rating`
 * field — which Zod would strip — is still available for conversion.
 *
 * Rules:
 *   - rating "disabled" → enabled: false
 *   - any other rating → enabled: true (or omit, since Zod defaults to true)
 *   - Remove `rating` and `previousRating` fields
 */

interface RawPackage {
  source: string;
  rating?: string;
  previousRating?: string;
  enabled?: boolean;
  type?: string;
  profile?: string;
  [key: string]: unknown;
}

interface RawCatalog {
  meta: Record<string, unknown>;
  packages: Record<string, RawPackage>;
  profiles?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Migrate a raw YAML catalog object from rating-based to enabled-based.
 *
 * Returns the mutated object (in-place) for chaining. If the catalog has
 * no `packages` key or is not an object, returns it unchanged.
 */
export function migrateRatingToEnabledRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const catalog = raw as RawCatalog;
  if (!catalog.packages || typeof catalog.packages !== "object") return raw;

  for (const [_name, pkg] of Object.entries(catalog.packages)) {
    if (!pkg || typeof pkg !== "object") continue;

    if ("rating" in pkg) {
      const rating = pkg.rating;
      if (rating === "disabled") {
        pkg.enabled = false;
      }
      // For non-disabled ratings, don't set enabled — Zod defaults to true
      delete pkg.rating;
    }

    if ("previousRating" in pkg) {
      delete pkg.previousRating;
    }
  }

  return raw;
}
