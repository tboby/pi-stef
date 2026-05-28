import { describe, expect, it } from "vitest";

import { resolveDefaults } from "../src/config/load";
import { DEFAULT_CONFIG } from "../src/config/schema";

describe("steering config", () => {
  it("provides documented steering defaults", () => {
    expect(DEFAULT_CONFIG.steering).toEqual({
      enabled: true,
      max_instruction_chars: 4000,
      child_active_tick_ms: 5000,
    });
  });

  it("resolves sparse steering config over defaults", () => {
    const resolved = resolveDefaults({
      steering: {
        enabled: false,
        max_instruction_chars: 250,
      },
    });

    expect(resolved.steering).toEqual({
      enabled: false,
      max_instruction_chars: 250,
      child_active_tick_ms: 5000,
    });
  });
});
