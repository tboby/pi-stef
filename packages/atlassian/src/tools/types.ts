/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unified tool execute function signature.
 * Used across all Atlassian tool registration modules.
 *
 * `params` is `any` because the typebox schema validates at runtime;
 * the tool framework does not carry static parameter types through
 * registration.
 */
export type ExecuteFn = (params: any, signal?: AbortSignal) => Promise<unknown>;
