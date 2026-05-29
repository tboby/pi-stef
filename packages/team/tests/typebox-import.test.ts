import { describe, expect, it } from "vitest";

/**
 * Regression guard: @sinclair/typebox MUST be a runtime `dependencies` entry of
 * @pi-stef/team. fh-agent installs published packages with
 * `--omit=peer`, so a future move of typebox into peerDependencies would break
 * runtime config validation in production. This test imports the schema
 * builder under the same module-resolution rules pnpm uses for the package as
 * installed (workspace symlink today, frozen install tomorrow).
 */
describe("M1: typebox runtime dependency guard", () => {
  it("imports `Type` from @sinclair/typebox via the package's own dependency path", async () => {
    const mod = await import("@sinclair/typebox");
    expect(typeof mod.Type).toBe("object");
    const schema = mod.Type.Object({ foo: mod.Type.String() });
    expect(schema).toMatchObject({ type: "object" });
  });

  it("declares @sinclair/typebox in dependencies, not peerDependencies", async () => {
    const pkg = await import("../package.json", { with: { type: "json" } });
    const deps = (pkg as unknown as { default: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> } }).default;
    expect(deps.dependencies?.["@sinclair/typebox"]).toBeDefined();
    expect(deps.peerDependencies?.["@sinclair/typebox"]).toBeUndefined();
  });
});
