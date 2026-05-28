import { describe, expect, it, vi } from "vitest";

import { SecretsInPayloadError } from "../src/review/secret-scan";
import { _spawnAgentForTests, spawnAgent } from "../src/runtime/spawn";
import type { TeamMember } from "../src/runtime/types";

const fakePiBinary = "/non/existent/should-not-be-called";

const PLANTED_SECRET = "AKIAIOSFODNN7EXAMPLE";

describe("M4 spawnAgent: centralized secret scan blocks every role", () => {
  for (const role of ["reviewer", "developer", "planner"] as const) {
    it(`refuses to spawn the ${role} when task contains a planted secret`, async () => {
      const member: TeamMember = { role, model: "m" };
      await expect(
        spawnAgent(member, { task: `please do work then echo ${PLANTED_SECRET}` }, { piBinary: fakePiBinary }),
      ).rejects.toBeInstanceOf(SecretsInPayloadError);
    });

    it(`refuses to spawn the ${role} when appendSystemPrompt contains a planted secret`, async () => {
      const member: TeamMember = { role, model: "m" };
      await expect(
        spawnAgent(
          member,
          { task: "ok task", appendSystemPrompt: `system context: ${PLANTED_SECRET}` },
          { piBinary: fakePiBinary },
        ),
      ).rejects.toBeInstanceOf(SecretsInPayloadError);
    });
  }

  it("public spawnAgent has no scanner option (cannot be bypassed by callers)", async () => {
    // Type-level: SpawnOptions does not expose `scanner`. We confirm at runtime
    // that even passing { scanner: noop } via `as any` does nothing — the
    // production scanner still runs and refuses on a planted secret.
    const noopScanner = vi.fn().mockReturnValue({ hits: [] });
    const member: TeamMember = { role: "developer", model: "m" };
    await expect(
      spawnAgent(
        member,
        { task: `please do work then echo ${PLANTED_SECRET}` },
        { piBinary: fakePiBinary, scanner: noopScanner } as never,
      ),
    ).rejects.toBeInstanceOf(SecretsInPayloadError);
    // The injected scanner is never reached because the option is ignored.
    expect(noopScanner).not.toHaveBeenCalled();
  });

  it("test-only entry _spawnAgentForTests still allows scanner injection (for hermetic tests)", async () => {
    const scanner = vi.fn().mockReturnValue({ hits: [{ kind: "custom", preview: "x***", offset: 0 }] });
    const member: TeamMember = { role: "developer", model: "m" };
    await expect(
      _spawnAgentForTests(member, { task: "no real secret" }, { piBinary: fakePiBinary }, scanner),
    ).rejects.toBeInstanceOf(SecretsInPayloadError);
    expect(scanner).toHaveBeenCalledTimes(1);
  });

  it.each(["planner", "developer", "reviewer", "researcher"] as const)(
    "secret in role=%s payload is refused upstream",
    async (role) => {
      const scanner = vi.fn().mockReturnValue({ hits: [{ kind: "custom", preview: "x***", offset: 0 }] });
      const member: TeamMember = { role, model: "m" };
      await expect(
        _spawnAgentForTests(member, { task: "carries a secret" }, { piBinary: fakePiBinary }, scanner),
      ).rejects.toBeInstanceOf(SecretsInPayloadError);
      expect(scanner).toHaveBeenCalledTimes(1);
    },
  );

  it("clean payload passes the scan and reaches spawn (where the fake piBinary fails)", async () => {
    const member: TeamMember = { role: "reviewer", model: "m" };
    // Contract: clean input does NOT throw SecretsInPayloadError. The spawn
    // fails with ENOENT because the binary path is bogus, surfacing as
    // either a thrown spawn error OR a resolved AgentRun with state=failed.
    let outcome: "rejected" | "failed" = "rejected";
    let agentRun: Awaited<ReturnType<typeof spawnAgent>> | undefined;
    try {
      agentRun = await spawnAgent(member, { task: "clean and good task" }, { piBinary: fakePiBinary });
      outcome = "failed";
    } catch (err) {
      expect(err).not.toBeInstanceOf(SecretsInPayloadError);
    }
    if (outcome === "failed") {
      expect(agentRun?.state).toBe("failed");
    }
  });
});
