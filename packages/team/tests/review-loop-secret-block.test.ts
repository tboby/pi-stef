import { describe, expect, it } from "vitest";

import { runReviewLoop } from "../src/review/loop";
import { parseReviewerVerdict } from "../src/review/parse";
import { SecretsInPayloadError } from "../src/review/secret-scan";
import { spawnAgent } from "../src/runtime/spawn";
import type { TeamMember } from "../src/runtime/types";

const PLANTED_SECRET = "AKIAIOSFODNN7EXAMPLE";

/**
 * Cross-check: when runReviewLoop is given an initial payload that contains a
 * planted secret, the spawnAgent-backed reviewer call refuses upstream
 * (SecretsInPayloadError). The loop never even reaches the parse step.
 */
describe("M5 runReviewLoop + spawnAgent secret-scan coverage", () => {
  it("spawnAgent refuses any role spawn when the initial payload contains a planted secret", async () => {
    const reviewer: TeamMember = { role: "reviewer", model: "m" };
    const reviewerCallback = async (payload: string) => {
      const run = await spawnAgent(
        reviewer,
        { task: payload },
        { piBinary: "/non/existent/should-not-be-called" },
      );
      return { verdictText: run.finalText, verdict: parseReviewerVerdict(run.finalText) };
    };

    await expect(
      runReviewLoop({
        initialPayload: `please review this plan: secret=${PLANTED_SECRET}`,
        reviewer: reviewerCallback,
        revise: async (_findings, prev) => prev,
        maxRounds: 5,
      }),
    ).rejects.toBeInstanceOf(SecretsInPayloadError);
  });

  it("end-to-end: spawnAgent rejects EACH role on a planted secret payload (even if the loop tries to reach reviewer)", async () => {
    for (const role of ["reviewer", "developer", "planner"] as const) {
      const member: TeamMember = { role, model: "m" };
      await expect(
        spawnAgent(
          member,
          { task: `do work; the input contains ${PLANTED_SECRET}` },
          { piBinary: "/non/existent/pi" },
        ),
      ).rejects.toBeInstanceOf(SecretsInPayloadError);
    }
  });
});
