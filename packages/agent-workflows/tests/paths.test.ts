import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DIAGNOSTICS_FOLDER_NAME,
  LEGACY_RESEARCH_ANSWERS_FILE,
  REPORTS_FOLDER_NAME,
  RESEARCH_ANSWERS_FILE,
  TRANSCRIPT_FOLDER_NAME,
  diagnosticsFolderPath,
  legacyResearchAnswersPath,
  reportsFolderPath,
  researchAnswersPath,
  transcriptFolderPath,
  transcriptPhaseFolderPath,
} from "../src/artifacts/paths";

const REPO = "/repo";
const SLUG = "demo";
const PLAN = path.join(REPO, "ai_plan", SLUG);

describe("plan-folder path helpers", () => {
  it("builds transcript folder under plan root", () => {
    expect(transcriptFolderPath(REPO, SLUG)).toBe(path.join(PLAN, TRANSCRIPT_FOLDER_NAME));
  });

  it("buckets transcripts by phase", () => {
    expect(transcriptPhaseFolderPath(REPO, SLUG, "planning")).toBe(
      path.join(PLAN, TRANSCRIPT_FOLDER_NAME, "planning"),
    );
    expect(transcriptPhaseFolderPath(REPO, SLUG, "implementation")).toBe(
      path.join(PLAN, TRANSCRIPT_FOLDER_NAME, "implementation"),
    );
  });

  it("places diagnostics and reports at plan root", () => {
    expect(diagnosticsFolderPath(REPO, SLUG)).toBe(path.join(PLAN, DIAGNOSTICS_FOLDER_NAME));
    expect(reportsFolderPath(REPO, SLUG)).toBe(path.join(PLAN, REPORTS_FOLDER_NAME));
  });

  it("returns dotless research-answers.json + legacy dotted alias", () => {
    expect(researchAnswersPath(REPO, SLUG)).toBe(path.join(PLAN, RESEARCH_ANSWERS_FILE));
    expect(legacyResearchAnswersPath(REPO, SLUG)).toBe(
      path.join(PLAN, LEGACY_RESEARCH_ANSWERS_FILE),
    );
    expect(RESEARCH_ANSWERS_FILE.startsWith(".")).toBe(false);
    expect(LEGACY_RESEARCH_ANSWERS_FILE.startsWith(".")).toBe(true);
  });
});
