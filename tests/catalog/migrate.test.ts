import { describe, expect, it } from "vitest";
import { migrateRatingToEnabledRaw } from "../../src/catalog/migrate.js";

describe("migrateRatingToEnabledRaw", () => {
  it("converts rating 'disabled' to enabled: false", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg", rating: "disabled" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    expect(raw.packages["my-pkg"]).toEqual({ source: "npm:my-pkg", enabled: false });
  });

  it("removes rating for non-disabled packages without setting enabled", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg", rating: "core" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    // enabled is not set — Zod defaults to true
    expect(raw.packages["my-pkg"]).toEqual({ source: "npm:my-pkg" });
    expect(raw.packages["my-pkg"]).not.toHaveProperty("rating");
  });

  it("strips previousRating field", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg", rating: "disabled", previousRating: "useful" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    expect(raw.packages["my-pkg"]).toEqual({ source: "npm:my-pkg", enabled: false });
    expect(raw.packages["my-pkg"]).not.toHaveProperty("previousRating");
  });

  it("handles packages without rating field (no-op)", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    expect(raw.packages["my-pkg"]).toEqual({ source: "npm:my-pkg" });
  });

  it("handles packages with enabled already set", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        "my-pkg": { source: "npm:my-pkg", enabled: true, rating: "core" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    // rating is stripped, enabled stays as-is
    expect(raw.packages["my-pkg"]).toEqual({ source: "npm:my-pkg", enabled: true });
  });

  it("returns input unchanged when no packages key", () => {
    const raw = { meta: { pi_version: "1.0.0" } };
    const result = migrateRatingToEnabledRaw(raw);
    expect(result).toBe(raw);
  });

  it("returns non-object input unchanged", () => {
    expect(migrateRatingToEnabledRaw(null)).toBe(null);
    expect(migrateRatingToEnabledRaw(undefined)).toBe(undefined);
    expect(migrateRatingToEnabledRaw("string")).toBe("string");
  });

  it("handles multiple packages with mixed ratings", () => {
    const raw = {
      meta: { pi_version: "1.0.0" },
      packages: {
        a: { source: "npm:a", rating: "core" },
        b: { source: "npm:b", rating: "disabled" },
        c: { source: "npm:c", rating: "useful" },
        d: { source: "npm:d" },
      },
    };
    migrateRatingToEnabledRaw(raw);
    expect(raw.packages.a).toEqual({ source: "npm:a" });
    expect(raw.packages.b).toEqual({ source: "npm:b", enabled: false });
    expect(raw.packages.c).toEqual({ source: "npm:c" });
    expect(raw.packages.d).toEqual({ source: "npm:d" });
  });
});
