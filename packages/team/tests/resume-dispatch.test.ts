import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { findLatestWorkflow, resolveOwnerTool, createSfTeamResume } from "../src/tools/resume-dispatch";

function workflowJson(overrides: Record<string, unknown>) {
  return JSON.stringify({
    schemaVersion: 1,
    slug: "test",
    folderPath: "/tmp/test",
    ownerTool: "sf_team_plan",
    currentTool: "sf_team_plan",
    createdAt: "2026-06-04T10:00:00Z",
    updatedAt: "2026-06-04T10:00:00Z",
    status: "running",
    phase: "planning",
    checkpoints: {},
    commitIntents: {},
    ...overrides,
  });
}

async function createWorkflow(tmpDir: string, slug: string, meta: Record<string, unknown>) {
  const wfDir = path.join(tmpDir, slug, ".pi", "sf", "agent-workflows");
  await fs.mkdir(wfDir, { recursive: true });
  await fs.writeFile(path.join(wfDir, "workflow.json"), workflowJson({ slug, folderPath: path.join(tmpDir, slug), ...meta }));
}

describe("findLatestWorkflow", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "resume-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when planRoot does not exist", async () => {
    const result = await findLatestWorkflow(path.join(tmpDir, "nonexistent"));
    expect(result).toBeUndefined();
  });

  it("returns undefined when planRoot is empty", async () => {
    const result = await findLatestWorkflow(tmpDir);
    expect(result).toBeUndefined();
  });

  it("returns the single workflow when one exists", async () => {
    const slug = "2026-06-04-my-plan";
    await createWorkflow(tmpDir, slug, { updatedAt: "2026-06-04T10:00:00Z" });

    const result = await findLatestWorkflow(tmpDir);
    expect(result).toEqual({ slug, folderPath: path.join(tmpDir, slug) });
  });

  it("returns the most recently updated workflow when multiple exist", async () => {
    const older = "2026-06-03-older";
    const newer = "2026-06-04-newer";

    await createWorkflow(tmpDir, older, { updatedAt: "2026-06-03T10:00:00Z" });
    await createWorkflow(tmpDir, newer, { updatedAt: "2026-06-04T12:00:00Z" });

    const result = await findLatestWorkflow(tmpDir);
    expect(result?.slug).toBe(newer);
  });

  it("skips directories without workflow.json", async () => {
    await fs.mkdir(path.join(tmpDir, "no-metadata"), { recursive: true });

    const slug = "2026-06-04-has-metadata";
    await createWorkflow(tmpDir, slug, { updatedAt: "2026-06-04T10:00:00Z" });

    const result = await findLatestWorkflow(tmpDir);
    expect(result?.slug).toBe(slug);
  });
});

describe("resolveOwnerTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "resolve-owner-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns ownerTool from workflow.json", async () => {
    const slug = "test-plan";
    await createWorkflow(tmpDir, slug, { ownerTool: "sf_team_auto", currentTool: "sf_team_implement" });

    const result = await resolveOwnerTool(path.join(tmpDir, slug), slug);
    expect(result).toBe("sf_team_auto");
  });

  it("throws when workflow.json is missing", async () => {
    const folderPath = path.join(tmpDir, "no-metadata");
    await fs.mkdir(folderPath, { recursive: true });

    await expect(resolveOwnerTool(folderPath, "no-metadata")).rejects.toThrow(
      "workflow metadata not found",
    );
  });
});

// Mock the tool creation modules so we can verify dispatch without running real handlers
vi.mock("../src/tools/plan", () => ({
  createSfTeamPlan: () => vi.fn().mockResolvedValue({ slug: "plan-result", approved: true }),
}));
vi.mock("../src/tools/implement", () => ({
  createSfTeamImplement: () => vi.fn().mockResolvedValue({ slug: "impl-result", branch: "main" }),
}));
vi.mock("../src/tools/task", () => ({
  createSfTeamTask: () => vi.fn().mockResolvedValue({ slug: "task-result", approved: true }),
}));
vi.mock("../src/tools/auto", () => ({
  createSfTeamAuto: () => vi.fn().mockResolvedValue({ slug: "auto-result", planRounds: 1 }),
}));
vi.mock("../src/tools/followup", () => ({
  createSfTeamFollowup: () => vi.fn().mockResolvedValue({ slug: "followup-result", approved: true }),
}));

describe("createSfTeamResume dispatch", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dispatch-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it.each([
    ["sf_team_plan", "plan-result"],
    ["sf_team_implement", "impl-result"],
    ["sf_team_task", "task-result"],
    ["sf_team_auto", "auto-result"],
    ["sf_team_followup", "followup-result"],
  ])("dispatches to %s handler when ownerTool is %s", async (ownerTool, expectedSlug) => {
    const slug = `2026-06-04-test-${ownerTool}`;
    await createWorkflow(tmpDir, slug, { ownerTool, currentTool: ownerTool });

    const handler = createSfTeamResume();
    const result = await handler(
      { resume: slug },
      { repoRoot: tmpDir, planRoot: tmpDir },
    );

    expect(result.ownerTool).toBe(ownerTool);
    expect((result.result as any).slug).toBe(expectedSlug);
  });

  it("throws for unknown ownerTool", async () => {
    const slug = "2026-06-04-unknown";
    const wfDir = path.join(tmpDir, slug, ".pi", "sf", "agent-workflows");
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(path.join(wfDir, "workflow.json"), JSON.stringify({
      schemaVersion: 1,
      slug,
      folderPath: path.join(tmpDir, slug),
      ownerTool: "unknown_tool",
      currentTool: "unknown_tool",
      createdAt: "2026-06-04T10:00:00Z",
      updatedAt: "2026-06-04T10:00:00Z",
      status: "running",
      phase: "test",
      checkpoints: {},
      commitIntents: {},
    }));

    const handler = createSfTeamResume();
    await expect(handler({ resume: slug }, { repoRoot: tmpDir, planRoot: tmpDir })).rejects.toThrow(
      /unknown ownerTool/,
    );
  });

  it("throws when no workflows exist and resume is omitted", async () => {
    const handler = createSfTeamResume();
    await expect(handler({}, { repoRoot: tmpDir, planRoot: tmpDir })).rejects.toThrow(
      /no workflows found/,
    );
  });
});
