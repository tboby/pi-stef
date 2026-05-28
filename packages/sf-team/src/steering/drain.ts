/**
 * M5 re-export shim. The drain pipeline implementation moved into
 * `./drain/index.ts`. Consumers importing `from ".../steering/drain"`
 * continue to work because this file forwards every public name; no
 * consumer import path needed to change for the internal split.
 */
export * from "./drain/index";
