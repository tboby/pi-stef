/**
 * M5 re-export shim. The decider implementation moved into
 * `./decider/index.ts` (alongside `./decider/normalize.ts`). Consumers
 * importing `from ".../steering/decider"` continue to work because this
 * file forwards every public name; no consumer import path needed to
 * change for the internal split.
 */
export * from "./decider/index";
