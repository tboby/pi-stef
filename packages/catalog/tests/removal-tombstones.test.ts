import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordRemoval,
  readTombstones,
  applyRemovalTombstones,
  clearTombstones,
} from "../src/catalog/removal-tombstones";

describe("removal tombstones", () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "pi-catalog-tombstones-"));
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("reads empty when no tombstone file exists", () => {
    expect(readTombstones(tmpHome)).toEqual([]);
  });

  it("records and reads a removal", () => {
    recordRemoval("superpowers-adapter", tmpHome);
    expect(readTombstones(tmpHome)).toEqual(["superpowers-adapter"]);
  });

  it("accumulates multiple removals", () => {
    recordRemoval("pkg-a", tmpHome);
    recordRemoval("pkg-b", tmpHome);
    expect(readTombstones(tmpHome)).toEqual(["pkg-a", "pkg-b"]);
  });

  it("clearTombstones removes the file", () => {
    recordRemoval("x", tmpHome);
    clearTombstones(tmpHome);
    expect(readTombstones(tmpHome)).toEqual([]);
  });

  it("applyRemovalTombstones drops named packages from catalog", () => {
    recordRemoval("superpowers-adapter", tmpHome);
    const catalog = {
      meta: { pi_version: "0.0.0" },
      packages: {
        pair: { source: "npm:@pi-stef/pair" },
        "superpowers-adapter": { source: "npm:@pi-stef/superpowers-adapter" },
        team: { source: "npm:@pi-stef/team" },
      },
    };
    applyRemovalTombstones(catalog, tmpHome);
    expect(catalog.packages).toEqual({
      pair: { source: "npm:@pi-stef/pair" },
      team: { source: "npm:@pi-stef/team" },
    });
  });

  it("applyRemovalTombstones is a no-op when no tombstones exist", () => {
    const catalog = {
      meta: { pi_version: "0.0.0" },
      packages: { pair: { source: "npm:@pi-stef/pair" } },
    };
    applyRemovalTombstones(catalog, tmpHome);
    expect(Object.keys(catalog.packages)).toEqual(["pair"]);
  });
});
