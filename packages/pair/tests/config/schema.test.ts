import { describe, it, expect } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  ConfigSchema,
  DEFAULT_CONFIG,
  type PairConfig,
  type ResolvedPairConfig,
} from "../../src/config/schema";

describe("ConfigSchema", () => {
  it("accepts empty object", () => {
    expect(Value.Check(ConfigSchema, {})).toBe(true);
  });

  it("accepts valid reviewer config", () => {
    const config = { reviewer: { model: "anthropic/sonnet-4-6" } };
    expect(Value.Check(ConfigSchema, config)).toBe(true);
  });

  it("accepts reviewer with no model", () => {
    const config = { reviewer: {} };
    expect(Value.Check(ConfigSchema, config)).toBe(true);
  });

  it("rejects empty model string", () => {
    const config = { reviewer: { model: "" } };
    expect(Value.Check(ConfigSchema, config)).toBe(false);
  });

  it("rejects additional top-level properties", () => {
    const config = { reviewer: {}, extra: true };
    expect(Value.Check(ConfigSchema, config)).toBe(false);
  });

  it("rejects additional reviewer properties", () => {
    const config = { reviewer: { model: "test", extra: true } };
    expect(Value.Check(ConfigSchema, config)).toBe(false);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has null reviewer model", () => {
    expect(DEFAULT_CONFIG.reviewer.model).toBeNull();
  });
});
