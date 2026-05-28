/**
 * S-409: Verify REVIEWER_TDD_POLICY({tddMode:'on'}) text explicitly disallows no-test-needed.
 *
 * The test simulates a developer handoff that contains `no-test-needed:` and
 * verifies that the reviewer policy text (in strict mode) would clearly cause
 * a reviewer to reject it — by checking the policy text itself contains a
 * strong disallowance phrase that no real reviewer could miss.
 */
import { describe, expect, it } from "vitest";
import { REVIEWER_TDD_POLICY, tddAllowsSkipShortcut } from "../../src/tools/tdd-policy";

describe("REVIEWER_TDD_POLICY tddMode=on — strict rejection of no-test-needed", () => {
  it("policy text for on-mode does NOT mention the escape hatch as acceptable", () => {
    const policy = REVIEWER_TDD_POLICY({ tddMode: "on", gitMode: "on" });
    // Must NOT say "acceptable ONLY when" (that's the auto-mode permissive phrasing)
    expect(policy).not.toMatch(/acceptable ONLY when/i);
  });

  it("policy text for on-mode explicitly disallows no-test-needed", () => {
    const policy = REVIEWER_TDD_POLICY({ tddMode: "on", gitMode: "on" });
    // Must say it's not acceptable / disallowed
    expect(policy).toMatch(/no-test-needed.*not.*acceptable|escape hatch.*not|hatch.*disallowed|NOT.*no-test-needed/i);
  });

  it("tddAllowsSkipShortcut returns false for on mode (no shortcut path)", () => {
    expect(tddAllowsSkipShortcut("on")).toBe(false);
  });

  it("auto-mode policy still includes the escape hatch as acceptable", () => {
    const policy = REVIEWER_TDD_POLICY({ tddMode: "auto", gitMode: "on" });
    expect(policy).toMatch(/escape hatch.*acceptable|acceptable ONLY when/i);
  });
});
