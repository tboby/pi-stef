/**
 * S-401: RED tests for mode-aware tdd-policy API.
 *
 * Verifies:
 *   1. composeTddContract({tddMode:'auto',gitMode:'on'}) — identical to today's output
 *   2. composeTddContract({tddMode:'on',gitMode:'on'}) — same + forbidden no-test-needed clause
 *   3. composeTddContract({tddMode:'off',gitMode:'on'}) — TDD section absent
 *   4. PLANNER_TDD_REMINDER({tddMode:'auto',gitMode:'on'}) — same as today
 *   5. REVIEWER_TDD_POLICY({tddMode:'on',gitMode:'on'}) — stronger enforcement
 *   6. tddRequiresProof / tddAllowsSkipShortcut helpers
 *
 * Uses regex assertions so minor wording tweaks don't churn this file.
 */
import { describe, expect, it } from "vitest";
import {
  composeTddContract,
  PLANNER_TDD_REMINDER,
  REVIEWER_TDD_POLICY,
  tddRequiresProof,
  tddAllowsSkipShortcut,
} from "../../src/tools/tdd-policy";

describe("composeTddContract — mode-aware", () => {
  it("auto mode emits mandatory test-first section", () => {
    const out = composeTddContract({ tddMode: "auto", gitMode: "on" });
    expect(out).toMatch(/Mandatory test-first contract/);
    expect(out).toMatch(/no-test-needed/);
    expect(out).toMatch(/Stage only files you touched/);
  });

  it("on mode emits test-first section + forbidden no-test-needed clause", () => {
    const out = composeTddContract({ tddMode: "on", gitMode: "on" });
    expect(out).toMatch(/Mandatory test-first contract/);
    expect(out).toMatch(/no-test-needed.*forbidden|forbidden.*no-test-needed|NOT.*no-test-needed|no-test-needed.*NOT allowed/i);
  });

  it("off mode does NOT emit TDD section", () => {
    const out = composeTddContract({ tddMode: "off", gitMode: "on" });
    expect(out).not.toMatch(/Mandatory test-first contract/);
    expect(out).not.toMatch(/TDD proof/);
    expect(out).toBe("");
  });

  it("auto+gitMode=off uses changes-block wording instead of staging", () => {
    const out = composeTddContract({ tddMode: "auto", gitMode: "off" });
    expect(out).toMatch(/Mandatory test-first contract/);
    expect(out).not.toMatch(/Stage only files you touched/);
    expect(out).toMatch(/## Changes/);
  });
});

describe("PLANNER_TDD_REMINDER — mode-aware", () => {
  it("auto mode emits test-first reminder", () => {
    const out = PLANNER_TDD_REMINDER({ tddMode: "auto", gitMode: "on" });
    expect(out).toMatch(/Test-first planning reminder/);
  });

  it("off mode returns empty string", () => {
    const out = PLANNER_TDD_REMINDER({ tddMode: "off", gitMode: "on" });
    expect(out).toBe("");
  });
});

describe("REVIEWER_TDD_POLICY — mode-aware", () => {
  it("auto mode emits TDD enforcement section", () => {
    const out = REVIEWER_TDD_POLICY({ tddMode: "auto", gitMode: "on" });
    expect(out).toMatch(/TDD enforcement/);
    expect(out).toMatch(/no-test-needed/);
  });

  it("on mode emits enforcement + no no-test-needed escape hatch text", () => {
    const out = REVIEWER_TDD_POLICY({ tddMode: "on", gitMode: "on" });
    expect(out).toMatch(/TDD enforcement/);
    expect(out).toMatch(/no-test-needed.*not.*acceptable|not.*acceptable.*no-test-needed|escape hatch.*not|hatch.*disallowed|NOT.*no-test-needed/i);
  });

  it("off mode returns empty string", () => {
    const out = REVIEWER_TDD_POLICY({ tddMode: "off", gitMode: "on" });
    expect(out).toBe("");
  });
});

describe("helper functions", () => {
  it("tddRequiresProof: auto=true, on=true, off=false", () => {
    expect(tddRequiresProof("auto")).toBe(true);
    expect(tddRequiresProof("on")).toBe(true);
    expect(tddRequiresProof("off")).toBe(false);
  });

  it("tddAllowsSkipShortcut: auto=true, off=true, on=false", () => {
    expect(tddAllowsSkipShortcut("auto")).toBe(true);
    expect(tddAllowsSkipShortcut("off")).toBe(true);
    expect(tddAllowsSkipShortcut("on")).toBe(false);
  });
});
