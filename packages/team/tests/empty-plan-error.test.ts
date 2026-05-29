import { describe, expect, it } from "vitest";

import { EmptyPlanError, type EmptyPlanReason } from "../src/orchestrator/empty-plan-error";

describe("EmptyPlanError", () => {
  it("captures rawPayload + reason + optional diagnosticsPath", () => {
    const e = new EmptyPlanError({
      rawPayload: "garbage",
      reason: "too-short",
      diagnosticsPath: "/tmp/d.log",
    });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("EmptyPlanError");
    expect(e.rawPayload).toBe("garbage");
    expect(e.reason).toBe("too-short");
    expect(e.diagnosticsPath).toBe("/tmp/d.log");
    expect(e.message).toContain("too-short");
  });

  it("toJSON() omits the rawPayload bytes (only its length)", () => {
    const e = new EmptyPlanError({ rawPayload: "x".repeat(10_000), reason: "no-stories" });
    const json = e.toJSON();
    expect(json.name).toBe("EmptyPlanError");
    expect(json.reason).toBe("no-stories");
    expect(json.rawPayloadBytes).toBe(10_000);
    // Make sure we never accidentally serialize the payload itself.
    expect(JSON.stringify(json)).not.toContain("xxxxxxxxxxxxxx");
  });

  it("each reason in the union is accepted by the constructor", () => {
    const reasons: EmptyPlanReason[] = ["no-milestones", "no-stories", "too-short"];
    for (const r of reasons) {
      const e = new EmptyPlanError({ rawPayload: "p", reason: r });
      expect(e.reason).toBe(r);
    }
  });
});
