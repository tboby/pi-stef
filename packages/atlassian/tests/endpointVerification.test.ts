import { describe, expect, it } from "vitest";

import {
  VERIFIED_CONFLUENCE_V1_ONLY_ENDPOINTS,
  VERIFIED_CONFLUENCE_V2_ENDPOINTS,
  VERIFIED_JIRA_PLATFORM_V3_ENDPOINTS,
  VERIFIED_JIRA_SOFTWARE_ENDPOINTS,
  UNSUPPORTED_JIRA_SOFTWARE_ENDPOINTS,
} from "../src/endpointVerification";

describe("verified Atlassian endpoint inventory", () => {
  it("keeps Confluence v2 endpoints under the full /wiki/api/v2 prefix", () => {
    expect(VERIFIED_CONFLUENCE_V2_ENDPOINTS).toContain("GET /wiki/api/v2/pages/{id}");
    expect(VERIFIED_CONFLUENCE_V2_ENDPOINTS.every((endpoint) => endpoint.includes("/wiki/api/v2/"))).toBe(true);
  });

  it("isolates Confluence v1-only compatibility endpoints", () => {
    expect(VERIFIED_CONFLUENCE_V1_ONLY_ENDPOINTS).toEqual([
      "GET /wiki/rest/api/search",
      "GET /wiki/rest/api/search/user",
      "POST /wiki/rest/api/content/{id}/label",
    ]);
  });

  it("uses enhanced Jira search and attachment content endpoints", () => {
    expect(VERIFIED_JIRA_PLATFORM_V3_ENDPOINTS).toContain("POST /rest/api/3/search/jql");
    expect(VERIFIED_JIRA_PLATFORM_V3_ENDPOINTS).toContain("GET /rest/api/3/attachment/content/{id}");
  });

  it("documents unsupported Jira board updates explicitly", () => {
    expect(VERIFIED_JIRA_SOFTWARE_ENDPOINTS).toContain("GET /rest/agile/1.0/board/{boardId}/configuration");
    expect(UNSUPPORTED_JIRA_SOFTWARE_ENDPOINTS[0]?.operation).toBe("jira_update_board");
  });
});
