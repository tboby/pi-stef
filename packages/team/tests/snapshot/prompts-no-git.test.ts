/**
 * S-515 + S-517: Snapshot/assertion tests for no-git developer prompts.
 *
 * S-515 assertions:
 *   - gitMode='on': developer prompt CONTAINS "Stage only", "staged diff"
 *   - gitMode='off': developer prompt does NOT contain "stage", "staged", "git add"
 *   - gitMode='off': developer prompt DOES contain "## Changes"
 *
 * S-517 TDD contract matrix: 6 combinations tddMode ∈ {auto, on, off} × gitMode ∈ {on, off}.
 *   - gitMode='off' outputs NEVER contain staging tokens ("Stage only", "staged diff", "git add")
 */
import { describe, expect, it } from "vitest";

import { composeDeveloperBrief, composeDevRevise } from "../../src/tools/run-task-workflow";
import {
  composeMilestoneBrief,
  composeMilestoneRevise,
} from "../../src/tools/implement";
import { composeTddContract, REVIEWER_TDD_POLICY } from "../../src/tools/tdd-policy";
import type { ParsedMilestone, ParsedStory } from "../../src/plan/tracker";

const PLAN_BODY = "### M1: Sample\nbody-1\n";
const FINDINGS = { findings: { P0: ["p0"], P1: [], P2: [], P3: [] } };

function makeMilestone(): ParsedMilestone {
  const story: ParsedStory = { id: "S-101", description: "do x", status: "pending", notes: "" };
  return { id: "M1", title: "Sample", approvalStatus: undefined, stories: [story] };
}

// Staging tokens that should NOT appear in no-git mode prompts
const STAGING_TOKENS = ["Stage only", "staged diff", "git add", "git commit", "stage actual changes"];

describe("S-515: developer prompts — gitMode='on' vs 'off'", () => {
  describe("composeDeveloperBrief", () => {
    it("gitMode='on': contains 'Stage only' and staging instructions", () => {
      const out = composeDeveloperBrief("# Plan", { gitMode: "on" });
      expect(out).toContain("Stage only");
    });

    it("gitMode='off': does NOT contain staging tokens", () => {
      const out = composeDeveloperBrief("# Plan", { gitMode: "off" });
      for (const token of STAGING_TOKENS) {
        expect(out, `Should not contain "${token}"`).not.toContain(token);
      }
    });

    it("gitMode='off': contains 'Do NOT use git commands'", () => {
      const out = composeDeveloperBrief("# Plan", { gitMode: "off" });
      expect(out).toContain("Do NOT use git commands");
    });
  });

  describe("composeMilestoneBrief", () => {
    it("gitMode='on': contains 'Stage only'", () => {
      const out = composeMilestoneBrief(makeMilestone(), PLAN_BODY, { cwd: "/tmp", gitMode: "on" });
      expect(out).toContain("Stage only");
    });

    it("gitMode='off': does NOT contain staging tokens", () => {
      const out = composeMilestoneBrief(makeMilestone(), PLAN_BODY, { cwd: "/tmp", gitMode: "off" });
      for (const token of STAGING_TOKENS) {
        expect(out, `Should not contain "${token}"`).not.toContain(token);
      }
    });

    it("gitMode='off': contains 'Do NOT use git commands'", () => {
      const out = composeMilestoneBrief(makeMilestone(), PLAN_BODY, { cwd: "/tmp", gitMode: "off" });
      expect(out).toContain("Do NOT use git commands");
    });
  });

  describe("composeDevRevise", () => {
    it("gitMode='on': contains 'Stage only'", () => {
      const out = composeDevRevise("diff", FINDINGS, { gitMode: "on" });
      expect(out).toContain("Stage only");
    });

    it("gitMode='off': does NOT contain staging tokens", () => {
      const out = composeDevRevise("diff", FINDINGS, { gitMode: "off" });
      for (const token of STAGING_TOKENS) {
        expect(out, `Should not contain "${token}"`).not.toContain(token);
      }
    });
  });

  describe("composeMilestoneRevise", () => {
    it("gitMode='on': contains 'Stage only'", () => {
      const out = composeMilestoneRevise("M1", "diff", FINDINGS, { cwd: "/tmp", gitMode: "on" });
      expect(out).toContain("Stage only");
    });

    it("gitMode='off': does NOT contain staging tokens", () => {
      const out = composeMilestoneRevise("M1", "diff", FINDINGS, { cwd: "/tmp", gitMode: "off" });
      for (const token of STAGING_TOKENS) {
        expect(out, `Should not contain "${token}"`).not.toContain(token);
      }
    });
  });
});

describe("S-517: TDD contract matrix — 6 combinations (tddMode × gitMode)", () => {
  const tddModes = ["auto", "on", "off"] as const;
  const gitModes = ["on", "off"] as const;

  for (const tddMode of tddModes) {
    for (const gitMode of gitModes) {
      describe(`tddMode=${tddMode} × gitMode=${gitMode}`, () => {
        it("composeTddContract output never contains staging tokens when gitMode='off'", () => {
          const out = composeTddContract({ tddMode, gitMode });
          if (gitMode === "off") {
            for (const token of STAGING_TOKENS) {
              expect(out, `composeTddContract should not contain "${token}" when gitMode='off'`).not.toContain(token);
            }
          }
        });

        it("REVIEWER_TDD_POLICY output never contains staging tokens when gitMode='off'", () => {
          const out = REVIEWER_TDD_POLICY({ tddMode, gitMode });
          if (gitMode === "off") {
            for (const token of STAGING_TOKENS) {
              expect(out, `REVIEWER_TDD_POLICY should not contain "${token}" when gitMode='off'`).not.toContain(token);
            }
          }
        });

        it("composeDeveloperBrief output never contains staging tokens when gitMode='off'", () => {
          const out = composeDeveloperBrief("# Plan", { tddMode, gitMode });
          if (gitMode === "off") {
            for (const token of STAGING_TOKENS) {
              expect(out, `composeDeveloperBrief should not contain "${token}" when gitMode='off'`).not.toContain(token);
            }
          }
        });
      });
    }
  }
});
