import { describe, expect, it } from "vitest";

import { followupSlug, slugify } from "../src/plan/slug";

describe("plan slug helpers", () => {
  it("slugify yields <date>-<kebab>", () => {
    expect(slugify("Better anim", new Date("2026-05-08T00:00:00Z"))).toBe("2026-05-08-better-anim");
  });

  it("followupSlug prefixes with `followup-` after the date", () => {
    expect(followupSlug("better anim", new Date("2026-05-08T00:00:00Z"))).toBe(
      "2026-05-08-followup-better-anim",
    );
    expect(followupSlug("Tighten OpenAPI", new Date("2026-05-15T12:34:56Z"))).toBe(
      "2026-05-15-followup-tighten-openapi",
    );
  });

  it("followupSlug rejects empty / unslug-able titles by delegating to slugify", () => {
    // slugify throws when no slug-able characters exist; followupSlug's
    // only defense is the literal "followup " prefix, which IS slug-able.
    expect(followupSlug("", new Date("2026-05-08T00:00:00Z"))).toBe("2026-05-08-followup");
    // A title made entirely of unslug-able characters reduces to just "followup".
    expect(followupSlug("!!!", new Date("2026-05-08T00:00:00Z"))).toBe("2026-05-08-followup");
  });
});
