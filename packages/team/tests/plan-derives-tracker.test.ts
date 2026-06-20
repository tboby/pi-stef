import { describe, expect, it } from "vitest";

import { composeContinuationRunbook, composeFinalTranscript, deriveStoryTracker, hasRealMilestones, hasRealStories } from "../src/tools/plan";
import { parseTrackerText } from "../src/plan/tracker";

describe("M11 plan derives a real tracker (P1.1 fix)", () => {
  it("emits one milestone block per ## M<N>: <title> heading", () => {
    const plan = `# Plan

## Goal
Build it.

## M0: Bootstrap
Things.

## M1: Core
Stuff.

## M2: Polish
Done.
`;
    const tracker = deriveStoryTracker(plan);
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M0", "M1", "M2"]);
    for (const m of parsed.milestones) {
      expect(m.stories).toHaveLength(1);
      expect(m.stories[0].status).toBe("pending");
    }
  });

  it("falls back to a single M0 row when no milestones found", () => {
    const tracker = deriveStoryTracker("Plan with no milestone headings.");
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M0"]);
  });

  it("detects milestones in BULLET-LIST form under a Milestones section", () => {
    const plan = `# Plan
## Milestones
- M0: Bootstrap
- M1: Core
- M2: Polish
`;
    const tracker = deriveStoryTracker(plan);
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M0", "M1", "M2"]);
    expect(parsed.milestones[0].title).toBe("Bootstrap");
  });

  it("detects milestones in NUMBERED-LIST form", () => {
    const plan = `## Milestones
1. M0 — Bootstrap
2. M1 — Core
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M0", "M1"]);
  });

  it("deduplicates and sorts numerically", () => {
    const plan = `## M2: Polish
## M0: Bootstrap
- M0: Bootstrap dup
## M1: Core
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M0", "M1", "M2"]);
  });
});

describe("M11 plan derives a real tracker — parses ACTUAL S-N* stories from `**Stories:**` bullets (not just placeholders)", () => {
  it("emits one row per S-N… bullet under each milestone (real plan format)", () => {
    // Mirrors the format `superpowers:writing-plans` actually produces.
    const plan = `# Plan

## Milestones

### M1: README And Repository-Layout Truth

**Description:** ...

**Acceptance Criteria:**
- [ ] some criterion that mentions S-103 should NOT become a story
- [ ] another criterion

**Stories:**
- **S-101 — Audit README layout drift.** Diff README's claimed paths against the on-disk tree; produce a precise removal/addition list.
- **S-102 — Rewrite README "Repository layout" block.** Replace stale paths with the real tree.
- **S-103 — Add \`scripts/verify-repo-layout.sh\`.** Implement the verifier.
- **S-104 — Wire \`verify:layout\` into npm scripts (mandatory).** Add the script.
- **S-105 — Smoke-test on macOS and Linux.** Run the verifier in both.

### M2: Per-Doc Content Corrections

**Stories:**
- **S-201 — Correct DO-TASK template count.** Update the relevant paragraph.
- **S-202 — Add Pi to TELEGRAM-NOTIFICATIONS.** Insert a Pi bullet/section.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones.map((m) => m.id)).toEqual(["M1", "M2"]);

    const m1 = parsed.milestones[0];
    expect(m1.stories.map((s) => s.id)).toEqual(["S-101", "S-102", "S-103", "S-104", "S-105"]);
    expect(m1.stories[0].description).toBe("Audit README layout drift");
    expect(m1.stories[1].description).toContain("Rewrite README");
    // Acceptance-criteria checkbox lines that *mention* S-103 must NOT
    // produce phantom story rows — story id appears once.
    expect(m1.stories.filter((s) => s.id === "S-103")).toHaveLength(1);

    const m2 = parsed.milestones[1];
    expect(m2.stories.map((s) => s.id)).toEqual(["S-201", "S-202"]);
    expect(m2.stories[0].description).toBe("Correct DO-TASK template count");
  });

  it("falls back to a single S-N01 placeholder when a milestone has no story bullets", () => {
    // Old behavior preserved for plans that don't use the bullet format.
    const plan = `## M1: Lonely
Just a description, no Stories: section.

## M2: Also Lonely
Another no-stories milestone.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones[0].stories).toEqual([
      { id: "S-101", description: "Lonely", status: "pending", notes: "" },
    ]);
    expect(parsed.milestones[1].stories).toEqual([
      { id: "S-201", description: "Also Lonely", status: "pending", notes: "" },
    ]);
  });

  it("ignores S-… mentions outside the milestone they belong to (cross-milestone references)", () => {
    // S-101 mentioned in M2's prose must NOT be added as an M2 story.
    const plan = `## M1: First
**Stories:**
- **S-101 — Audit.** Diff README.

## M2: Second
**Stories:**
- **S-201 — Other work.** Build on S-101's outputs.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones[0].stories.map((s) => s.id)).toEqual(["S-101"]);
    expect(parsed.milestones[1].stories.map((s) => s.id)).toEqual(["S-201"]);
  });

  it("survives pipe characters in the description (encoded as &#124;)", () => {
    const plan = `## M1: First
**Stories:**
- **S-101 — Use \`grep | head\` to filter.** Body prose.
`;
    const tracker = deriveStoryTracker(plan);
    // Raw tracker text encodes the pipe.
    expect(tracker).toMatch(/grep &#124; head/);
    // Round-trip through parseTrackerText still yields one story.
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones[0].stories).toHaveLength(1);
    expect(parsed.milestones[0].stories[0].id).toBe("S-101");
  });

  it("title containing periods (file extensions, version dots) survives — bounded by close-bold, not by `.`", () => {
    const plan = `## M1: First
**Stories:**
- **S-101 — Add \`scripts/verify-repo-layout.sh\`.** Implement the verifier.
- **S-102 — Align docs/PI.md's surface description.** Reword that section.
- **S-103 — Bump pnpm to v10.18.1.** Update package.json.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    const m1 = parsed.milestones[0];
    expect(m1.stories.map((s) => s.description)).toEqual([
      "Add `scripts/verify-repo-layout.sh`",
      "Align docs/PI.md's surface description",
      "Bump pnpm to v10.18.1",
    ]);
  });

  it("subsections AFTER `**Stories:**` end the Stories block (e.g. **Milestone Completion Rule:**)", () => {
    // Lock in that bullets in a post-story subsection don't get harvested
    // even though they appear AFTER the Stories header.
    const plan = `## M1: First
**Stories:**
- **S-101 — Real story.** Body.
- **S-102 — Another real story.** Body.

**Milestone Completion Rule:**
- Run \`pnpm test\` for S-999 verification.
- Then commit S-998 changes locally.

**Risks:**
- Ignored S-997 risk bullet.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones[0].stories.map((s) => s.id)).toEqual(["S-101", "S-102"]);
    // None of the post-story subsection bullets leak through.
    expect(parsed.milestones[0].stories.every((s) => !["S-997", "S-998", "S-999"].includes(s.id))).toBe(true);
  });

  it("non-bold format falls back to first-period truncation (defensive)", () => {
    const plan = `## M1: First
**Stories:**
- S-101: Audit. Diff README.
- S-102 — Rewrite. Replace stale paths.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones[0].stories.map((s) => s.description)).toEqual([
      "Audit",
      "Rewrite",
    ]);
  });

  it("dedupes a story id repeated within the same milestone", () => {
    const plan = `## M1: First
**Stories:**
- **S-101 — Audit.** Diff README.
- **S-101 — Duplicate of audit.** This duplicate must NOT add a second row.
`;
    const parsed = parseTrackerText(deriveStoryTracker(plan));
    expect(parsed.milestones[0].stories.filter((s) => s.id === "S-101")).toHaveLength(1);
    // First-occurrence wins.
    expect(parsed.milestones[0].stories[0].description).toBe("Audit");
  });
});

describe("hasRealMilestones (S-101)", () => {
  it("returns true on heading form `### M1: Title`", () => {
    expect(hasRealMilestones("# Plan\n## Milestones\n### M1: Bootstrap\nbody")).toBe(true);
  });
  it("returns true on bullet form `- M0: Title`", () => {
    expect(hasRealMilestones("## Milestones\n- M0: Bootstrap\n- M1: Core\n")).toBe(true);
  });
  it("returns false on prose without any M\\d+ marker (the synthetic M0 fallback must not count)", () => {
    expect(hasRealMilestones("Just some prose.\nNo milestone markers here.\n")).toBe(false);
  });
});

describe("plan shape tolerates Global Constraints + Interfaces (S-304)", () => {
  it("hasRealMilestones passes with new sections", () => {
    const plan = `# Plan\n## Global Constraints\n- Constraint A\n- Constraint B\n\n## Milestones\n### M1: Bootstrap\n**Interfaces:**\n- Consumes: nothing\n- Produces: core lib\n\n**Stories:**\n- **S-101 — First.** Body.\n`;
    expect(hasRealMilestones(plan)).toBe(true);
    expect(hasRealStories(plan)).toBe(true);
  });
});

describe("hasRealStories (S-102)", () => {
  it("returns true on `**Stories:**` real bullets", () => {
    const plan = `## M1: First
**Stories:**
- **S-101 — Real story.** Body.
`;
    expect(hasRealStories(plan)).toBe(true);
  });

  it("returns true on `### Stories` real bullets", () => {
    const plan = `## M1: First
### Stories
- **S-101 — Real story.** Body.
`;
    expect(hasRealStories(plan)).toBe(true);
  });

  it("returns true on `#### Stories` real bullets", () => {
    const plan = `## M1: First
#### Stories
- **S-101 — Real story.** Body.
`;
    expect(hasRealStories(plan)).toBe(true);
  });

  it("returns false on placeholder-only plan (no Stories section, only milestone heading)", () => {
    const plan = `## M1: Lonely
A milestone without any Stories block at all.
`;
    expect(hasRealStories(plan)).toBe(false);
  });

  it("returns true on a mixed plan: one milestone with real bullets, others with no Stories", () => {
    const plan = `## M0: Empty milestone
description only

## M1: With stories
**Stories:**
- **S-101 — Real story.** Body.
`;
    expect(hasRealStories(plan)).toBe(true);
  });

  it("returns false when no Stories markers at all are present (even with valid `M\\d+` headings)", () => {
    const plan = `# Plan
## Milestones
### M0: Bootstrap
just description, no Stories block

### M1: Core
more description
`;
    expect(hasRealStories(plan)).toBe(false);
  });
});

describe("extractMilestonesAndStories also recognizes `### Stories` and `#### Stories` markers (S-102)", () => {
  it("harvests bullets under `### Stories` heading", () => {
    const plan = `## M1: First
### Stories
- **S-101 — Story one.** Body.
- **S-102 — Story two.** Body.
`;
    const tracker = deriveStoryTracker(plan);
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones[0].stories.map((s) => s.id)).toEqual(["S-101", "S-102"]);
  });

  it("harvests bullets under `#### Stories` heading", () => {
    const plan = `## M1: First
#### Stories
- **S-101 — Story one.** Body.
`;
    const tracker = deriveStoryTracker(plan);
    const parsed = parseTrackerText(tracker);
    expect(parsed.milestones[0].stories.map((s) => s.id)).toEqual(["S-101"]);
  });
});

describe("plan generated handoff files mention the execution strategy artifact", () => {
  it("adds execution-strategy.json to the continuation runbook references and workflow", () => {
    const runbook = composeContinuationRunbook({
      slug: "2026-05-04-sample",
      title: "Sample",
      milestones: [{ id: "M1", title: "One" }],
      planReviewRounds: 1,
      generatedAt: new Date("2026-05-04T00:00:00.000Z"),
    });
    expect(runbook).toMatch(/execution-strategy\.json/);
    expect(runbook).toMatch(/parallel/i);
    expect(runbook).toMatch(/sequential fallback/i);
  });

  it("adds execution strategy summary pointers to final-transcript.md", () => {
    const transcript = composeFinalTranscript({
      slug: "2026-05-04-sample",
      title: "Sample",
      milestones: [{ id: "M1", title: "One" }],
      planReviewRounds: 1,
      generatedAt: new Date("2026-05-04T00:00:00.000Z"),
    });
    expect(transcript).toMatch(/execution-strategy\.json/);
    expect(transcript).toMatch(/Execution strategy/i);
  });
});
