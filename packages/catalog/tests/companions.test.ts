import { describe, it, expect } from "vitest";
import { readCompanionsFromManifest } from "../src/catalog/companions";

describe("readCompanionsFromManifest", () => {
  it("returns the pi.companions array when present", () => {
    const manifest = { name: "@pi-stef/pair", pi: { companions: ["git:github.com/obra/superpowers"] } };
    expect(readCompanionsFromManifest(manifest)).toEqual(["git:github.com/obra/superpowers"]);
  });

  it("returns empty array when pi.companions is absent", () => {
    expect(readCompanionsFromManifest({ name: "x" })).toEqual([]);
  });

  it("returns empty array when pi is absent", () => {
    expect(readCompanionsFromManifest({})).toEqual([]);
  });

  it("ignores malformed companions (keeps only non-empty strings)", () => {
    const manifest = { pi: { companions: ["git:github.com/obra/superpowers", "", 123 as unknown as string] } };
    expect(readCompanionsFromManifest(manifest)).toEqual(["git:github.com/obra/superpowers"]);
  });
});
