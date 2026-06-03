/**
 * Unified tool execute function signature.
 * Used across all Atlassian tool registration files.
 */
export type ExecuteFn = (params: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
