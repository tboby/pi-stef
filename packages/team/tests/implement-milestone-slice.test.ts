import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { planFolderPath } from "../src/plan/paths";
import { extractMilestoneSection } from "../src/tools/implement";
import { readImplementPlanFolder } from "../src/tools/implement-reader";

const PLAN = `# Some Plan

## Overview
- Goal: x

## Milestones

### M1: First milestone
**Description:** does the first thing.

**Acceptance Criteria:**
- [ ] aaa
- [ ] bbb

### M2: Second milestone
**Description:** does the second thing.

**Acceptance Criteria:**
- [ ] ccc
- [ ] ddd

### M10: Tenth milestone
**Description:** does the tenth thing.

**Acceptance Criteria:**
- [ ] eee

---

## Risks
- something
`;

describe("extractMilestoneSection", () => {
  it("returns just the M1 block, stopping at ### M2:", () => {
    const slice = extractMilestoneSection(PLAN, "M1")!;
    expect(slice).toContain("### M1: First milestone");
    expect(slice).toContain("does the first thing");
    expect(slice).toContain("aaa");
    expect(slice).toContain("bbb");
    // Must NOT leak the next milestone's body.
    expect(slice).not.toContain("### M2:");
    expect(slice).not.toContain("Second milestone");
    expect(slice).not.toContain("ccc");
  });

  it("returns the M2 block, stopping at the next ### M-heading", () => {
    const slice = extractMilestoneSection(PLAN, "M2")!;
    expect(slice).toContain("### M2: Second milestone");
    expect(slice).toContain("ccc");
    expect(slice).not.toContain("### M1:");
    expect(slice).not.toContain("### M10:");
    expect(slice).not.toContain("eee");
  });

  it("does not match M1 prefix when asked for M10 (regex anchored on `:` separator)", () => {
    const slice = extractMilestoneSection(PLAN, "M10")!;
    expect(slice).toContain("### M10: Tenth milestone");
    expect(slice).toContain("eee");
    expect(slice).not.toContain("### M1:");
    expect(slice).not.toContain("First milestone");
  });

  it("returns undefined when the milestone heading is missing", () => {
    expect(extractMilestoneSection(PLAN, "M99")).toBeUndefined();
  });

  it("trims trailing whitespace from the slice", () => {
    const slice = extractMilestoneSection(PLAN, "M2")!;
    expect(slice.endsWith("\n")).toBe(false);
    expect(slice.endsWith("ddd")).toBe(true);
  });

  it("stops the LAST milestone at a top-level `## ` heading (e.g. ## Risks)", () => {
    // M10 is the last milestone — without the heading boundary it would
    // bleed into ## Risks. The trim should also drop the `---` separator.
    const slice = extractMilestoneSection(PLAN, "M10")!;
    expect(slice).toContain("### M10: Tenth milestone");
    expect(slice).toContain("eee");
    expect(slice).not.toContain("## Risks");
    expect(slice).not.toContain("something");
    // Trailing horizontal rule is stripped.
    expect(slice.trimEnd().endsWith("---")).toBe(false);
  });

  it("accepts ## (level-2) milestone heading shape", () => {
    const plan = `## M1: Two-hash milestone\nbody-1\n\n## M2: Two-hash next\nbody-2\n`;
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("body-1");
    expect(slice).not.toContain("body-2");
  });

  it("accepts em-dash separator (### M1 — Title) instead of colon", () => {
    const plan = `### M1 — Em-dash heading\nbody-1\n\n### M2 — Em-dash next\nbody-2\n`;
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("Em-dash heading");
    expect(slice).toContain("body-1");
    expect(slice).not.toContain("body-2");
  });

  it("accepts hyphen separator (### M1 - Title)", () => {
    const plan = `### M1 - Hyphen heading\nbody-1\n\n### M2 - Hyphen next\nbody-2\n`;
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("Hyphen heading");
    expect(slice).toContain("body-1");
    expect(slice).not.toContain("body-2");
  });

  it("M1 still does NOT match M10 across all separator shapes (boundary-safe)", () => {
    const plan = `### M10 — Tenth\nbody-ten\n`;
    expect(extractMilestoneSection(plan, "M1")).toBeUndefined();
  });

  it("KEEPS subsection headings inside a ### milestone (#### Stories etc. must not truncate)", () => {
    const plan = [
      "### M1: With subsections",
      "**Description:** does the thing.",
      "",
      "**Acceptance Criteria:**",
      "- [ ] aaa",
      "",
      "**Stories:**",
      "#### Stories",
      "- S-101 something",
      "- S-102 something else",
      "",
      "### M2: Next milestone",
      "body-2",
    ].join("\n");
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("### M1: With subsections");
    // Subsection survived (#### is deeper than the ### start heading).
    expect(slice).toContain("#### Stories");
    expect(slice).toContain("S-101 something");
    expect(slice).toContain("S-102 something else");
    // Next milestone correctly excluded.
    expect(slice).not.toContain("### M2:");
    expect(slice).not.toContain("body-2");
  });

  it("KEEPS deeper-level subsections inside a ## milestone (### / #### must not truncate)", () => {
    const plan = [
      "## M1: Level-2 milestone",
      "body intro",
      "",
      "### Acceptance Criteria",
      "- [ ] criterion 1",
      "",
      "### Stories",
      "- S-101 do x",
      "",
      "#### Story details",
      "- nested detail",
      "",
      "## M2: Next level-2 milestone",
      "body-2",
    ].join("\n");
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("body intro");
    // ### and #### are deeper than the ## start → kept.
    expect(slice).toContain("### Acceptance Criteria");
    expect(slice).toContain("### Stories");
    expect(slice).toContain("#### Story details");
    expect(slice).toContain("nested detail");
    // Same-level ## boundary respected.
    expect(slice).not.toContain("## M2:");
    expect(slice).not.toContain("body-2");
  });

  it("a non-milestone heading AT THE SAME LEVEL as the start does end the slice (e.g. ## Risks)", () => {
    const plan = [
      "## M1: Two-hash",
      "body-1",
      "",
      "## Risks",
      "- some risk",
    ].join("\n");
    const slice = extractMilestoneSection(plan, "M1")!;
    expect(slice).toContain("body-1");
    expect(slice).not.toContain("## Risks");
    expect(slice).not.toContain("some risk");
  });
});

describe("readImplementPlanFolder execution strategy compatibility", () => {
  it("returns a validated sequential fallback for old five-file folders without execution-strategy.json", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ct-impl-reader-"));
    const slug = "2026-05-04-old-plan";
    try {
      const folder = planFolderPath(root, slug);
      mkdirSync(folder, { recursive: true });
      writeFileSync(path.join(folder, "milestone-plan.md"), PLAN);
      writeFileSync(path.join(folder, "continuation-runbook.md"), "# Runbook");
      writeFileSync(path.join(folder, "story-tracker.md"), `# Story Tracker

## Milestones

### M1: First milestone

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-101 | a | pending | |
| S-102 | b | pending | |

**Approval Status:** pending

### M2: Second milestone

| Story | Description | Status | Notes |
|-------|-------------|--------|-------|
| S-201 | c | pending | |

**Approval Status:** pending
`);
      const read = await readImplementPlanFolder(root, slug);
      expect(read.executionStrategy.source).toBe("sequential-fallback");
      expect(read.executionStrategy.milestoneWaves.map((w) => w.milestones)).toEqual([["M1"], ["M2"]]);
      expect(read.executionStrategy.stories.M1.storyWaves.map((w) => w.stories)).toEqual([["S-101"], ["S-102"]]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
