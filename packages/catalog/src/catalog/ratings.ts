/** The ordered rating cycle: core → useful → debatable → disabled → core */
export const RATING_CYCLE = ["core", "useful", "debatable", "disabled"] as const;

export type RatingValue = (typeof RATING_CYCLE)[number];

/** Returns the next rating in the cycle. */
export function nextRating(rating: RatingValue): RatingValue {
  const idx = RATING_CYCLE.indexOf(rating);
  return RATING_CYCLE[(idx + 1) % RATING_CYCLE.length];
}

/** Returns true when the rating is "disabled". */
export function isDisabled(rating: RatingValue): boolean {
  return rating === "disabled";
}

/**
 * Validates a source string.
 * Accepted formats:
 *   - npm:<package-name>
 *   - git:<url>
 *   - git:<url>#<subpath>
 *   - local paths (relative or absolute)
 */
export function isValidSource(source: string): boolean {
  if (!source) return false;
  if (/^npm:/.test(source)) return true;
  if (/^git:/.test(source)) return true;
  // Local paths (relative or absolute) are also valid
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) return true;
  return false;
}
