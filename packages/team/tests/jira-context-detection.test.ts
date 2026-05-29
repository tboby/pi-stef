import { describe, expect, it } from "vitest";

import { detectJiraReferences } from "../src/research/jira-context";

describe("detectJiraReferences", () => {
  it("detects a bare Jira key in the brief", () => {
    const result = detectJiraReferences("Please look at ABC-123 and tell me what to do.");
    expect(result.keys).toEqual(["ABC-123"]);
    expect(result.confluenceUrls).toEqual([]);
  });

  it("dedupes a bare key against the same key embedded in a browse URL", () => {
    const result = detectJiraReferences(
      "ABC-123 see https://acme.atlassian.net/browse/ABC-123 and unrelated text",
    );
    expect(result.keys).toEqual(["ABC-123"]);
  });

  it("returns Confluence URLs separately (informational only — not treated as fetch roots)", () => {
    const result = detectJiraReferences(
      "context lives in https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title and ABC-1 ties it",
    );
    expect(result.keys).toEqual(["ABC-1"]);
    expect(result.confluenceUrls).toEqual([
      "https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title",
    ]);
  });

  it("rejects single-letter+digits prefixes (M1, T2, S5 — common milestone/sprint false positives)", () => {
    const result = detectJiraReferences(
      "milestone M1-2026, story T2-1, sprint S5-100 — none of these are Jira keys",
    );
    expect(result.keys).toEqual([]);
  });

  it("rejects lowercase or all-digit candidates that the existing regex already excludes", () => {
    const result = detectJiraReferences("lower-case-99 and all-digits 123-456");
    expect(result.keys).toEqual([]);
  });

  it("accepts multi-letter and letter-digit-letter prefixes", () => {
    const result = detectJiraReferences("ABC-123 and JRA-1 and AB1-99 are all valid");
    expect(result.keys.sort()).toEqual(["AB1-99", "ABC-123", "JRA-1"]);
  });

  it("returns empty arrays on empty input", () => {
    expect(detectJiraReferences("")).toEqual({ keys: [], confluenceUrls: [] });
  });

  it("preserves first-occurrence order for multiple distinct keys", () => {
    const result = detectJiraReferences("Start with PROJ-9, then loop in ABC-123, then JRA-1");
    expect(result.keys).toEqual(["PROJ-9", "ABC-123", "JRA-1"]);
  });
});
