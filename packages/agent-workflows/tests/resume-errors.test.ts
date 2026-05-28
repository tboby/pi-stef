import { describe, expect, it } from "vitest";
import { ResumeTargetNotFoundError } from "../src/resume/errors";

describe("ResumeTargetNotFoundError", () => {
  it("kind='not-found' produces a message naming the slug", () => {
    const err = new ResumeTargetNotFoundError({
      kind: "not-found",
      slug: "2026-05-26-my-task",
      candidates: ["/workspace/ai_plan"],
      message: "slug `2026-05-26-my-task` not found. Searched: /workspace/ai_plan",
    });
    expect(err.kind).toBe("not-found");
    expect(err.slug).toBe("2026-05-26-my-task");
    expect(err.candidates).toEqual(["/workspace/ai_plan"]);
    expect(err.message).toContain("2026-05-26-my-task");
    expect(err.name).toBe("ResumeTargetNotFoundError");
    expect(err).toBeInstanceOf(Error);
  });

  it("kind='ambiguous' lists all candidate planRoots", () => {
    const candidates = ["/plans/one", "/plans/two"];
    const err = new ResumeTargetNotFoundError({
      kind: "ambiguous",
      slug: "2026-05-26-my-task",
      candidates,
      message:
        "slug `2026-05-26-my-task` found at multiple planRoots; pass `aiPlanPath` explicitly. Candidates:\n  - /plans/one\n  - /plans/two",
    });
    expect(err.kind).toBe("ambiguous");
    expect(err.candidates).toHaveLength(2);
    expect(err.candidates).toContain("/plans/one");
    expect(err.candidates).toContain("/plans/two");
    expect(err.message).toContain("/plans/one");
    expect(err.message).toContain("/plans/two");
  });
});
