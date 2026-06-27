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
