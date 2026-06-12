import { describe, expect, it } from "vitest";

import type { CatalogYaml } from "../../src/config/schema.js";
import {
  addPackage,
  removePackage,
  togglePackage,
  enablePackage,
  disablePackage,
} from "../../src/catalog/crud.js";
import { isValidSource } from "../../src/catalog/ratings.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyCatalog(): CatalogYaml {
  return {
    meta: { pi_version: "1.0.0" },
    packages: {},
  };
}

// ---------------------------------------------------------------------------
// ratings helpers
// ---------------------------------------------------------------------------

describe("isValidSource", () => {
  it("accepts npm: source", () => {
    expect(isValidSource("npm:my-package")).toBe(true);
  });

  it("accepts npm: with scoped package", () => {
    expect(isValidSource("npm:@scope/my-package")).toBe(true);
  });

  it("accepts git: source", () => {
    expect(isValidSource("git:https://github.com/example/repo")).toBe(true);
  });

  it("accepts git: source with #subpath", () => {
    expect(isValidSource("git:https://github.com/example/repo#subpath")).toBe(
      true,
    );
  });

  it("rejects arbitrary string", () => {
    expect(isValidSource("just-a-string")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidSource("")).toBe(false);
  });

  it("rejects https: URL", () => {
    expect(isValidSource("https://github.com/example/repo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// addPackage
// ---------------------------------------------------------------------------

describe("addPackage", () => {
  it("adds a new package entry", () => {
    const catalog = emptyCatalog();
    const result = addPackage(catalog, "my-skill", "npm:my-skill");
    expect(result.packages["my-skill"]).toEqual({
      source: "npm:my-skill",
    });
  });

  it("throws on duplicate package name", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "my-skill",
      "npm:my-skill",
    );
    expect(() =>
      addPackage(catalog, "my-skill", "npm:other"),
    ).toThrow(/already exists/i);
  });

  it("throws on invalid source format", () => {
    const catalog = emptyCatalog();
    expect(() =>
      addPackage(catalog, "skill", "invalid-source"),
    ).toThrow(/source/i);
  });

  it("accepts git: source format", () => {
    const catalog = emptyCatalog();
    const result = addPackage(
      catalog,
      "skill",
      "git:https://github.com/example/repo",
    );
    expect(result.packages["skill"].source).toBe(
      "git:https://github.com/example/repo",
    );
  });

  it("accepts git:#subpath source format", () => {
    const catalog = emptyCatalog();
    const result = addPackage(
      catalog,
      "skill",
      "git:https://github.com/example/repo#skills/mine",
    );
    expect(result.packages["skill"].source).toBe(
      "git:https://github.com/example/repo#skills/mine",
    );
  });

  it("adds with optional type", () => {
    const catalog = emptyCatalog();
    const result = addPackage(catalog, "skill", "npm:pkg", "skill");
    expect(result.packages["skill"].type).toBe("skill");
  });

  it("does not mutate the original catalog", () => {
    const catalog = emptyCatalog();
    const result = addPackage(catalog, "skill", "npm:pkg");
    expect(catalog.packages).toEqual({});
    expect(result).not.toBe(catalog);
  });
});

// ---------------------------------------------------------------------------
// removePackage
// ---------------------------------------------------------------------------

describe("removePackage", () => {
  it("removes an existing package", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = removePackage(catalog, "skill");
    expect(result.packages["skill"]).toBeUndefined();
  });

  it("throws when package not found", () => {
    const catalog = emptyCatalog();
    expect(() => removePackage(catalog, "nonexistent")).toThrow(/not found/i);
  });

  it("does not mutate the original catalog", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = removePackage(catalog, "skill");
    expect(catalog.packages["skill"]).toBeDefined();
    expect(result).not.toBe(catalog);
  });
});

// ---------------------------------------------------------------------------
// togglePackage
// ---------------------------------------------------------------------------

describe("togglePackage", () => {
  it("flips enabled to false when currently enabled (default)", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = togglePackage(catalog, "skill");
    expect(result.packages["skill"].enabled).toBe(false);
  });

  it("flips enabled to true when currently disabled", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    catalog.packages["skill"].enabled = false;
    const result = togglePackage(catalog, "skill");
    expect(result.packages["skill"].enabled).toBe(true);
  });

  it("throws when package not found", () => {
    const catalog = emptyCatalog();
    expect(() => togglePackage(catalog, "nonexistent")).toThrow(/not found/i);
  });

  it("does not mutate the original catalog", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = togglePackage(catalog, "skill");
    expect(catalog.packages["skill"].enabled).toBeUndefined();
    expect(result).not.toBe(catalog);
  });
});

// ---------------------------------------------------------------------------
// enablePackage
// ---------------------------------------------------------------------------

describe("enablePackage", () => {
  it("sets enabled to true when enabling a disabled package", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const disabled = disablePackage(catalog, "skill");
    expect(disabled.packages["skill"].enabled).toBe(false);

    const result = enablePackage(disabled, "skill");
    expect(result.packages["skill"].enabled).toBe(true);
  });

  it("is a no-op when already enabled", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = enablePackage(catalog, "skill");
    expect(result.packages["skill"].enabled).toBeUndefined();
  });

  it("throws when package not found", () => {
    const catalog = emptyCatalog();
    expect(() => enablePackage(catalog, "nonexistent")).toThrow(/not found/i);
  });
});

// ---------------------------------------------------------------------------
// disablePackage
// ---------------------------------------------------------------------------

describe("disablePackage", () => {
  it("sets enabled to false", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = disablePackage(catalog, "skill");
    expect(result.packages["skill"].enabled).toBe(false);
  });

  it("throws when package not found", () => {
    const catalog = emptyCatalog();
    expect(() => disablePackage(catalog, "nonexistent")).toThrow(/not found/i);
  });

  it("does not mutate the original catalog", () => {
    const catalog = addPackage(
      emptyCatalog(),
      "skill",
      "npm:pkg",
    );
    const result = disablePackage(catalog, "skill");
    expect(catalog.packages["skill"].enabled).toBeUndefined();
    expect(result).not.toBe(catalog);
  });
});
