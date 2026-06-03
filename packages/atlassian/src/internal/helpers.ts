import type { QueryValue } from "../http/AtlassianClient";

/**
 * Cast an unknown value to Record<string, unknown> safely.
 * Returns an empty object for null, undefined, and non-object values.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Extract a string from an unknown value.
 * Returns an empty string for non-string values.
 */
export function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Extract a number from an unknown value.
 * Returns undefined for non-number values.
 */
export function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Get the error message from an unknown error value.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Remove entries with undefined values from a record.
 */
export function clean<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

/**
 * Build query options for HTTP client calls.
 * Returns only the `query` key when there are non-empty cleaned params.
 */
export function options(query: Record<string, unknown>, signal?: AbortSignal): { query?: Record<string, QueryValue>; signal?: AbortSignal } {
  const cleaned = clean(query) as Record<string, QueryValue>;
  return Object.keys(cleaned).length ? { query: cleaned, signal } : { signal };
}
