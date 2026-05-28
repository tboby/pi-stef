import { describe, expect, it } from "vitest";

import { getNextCursor } from "../src/http/pagination";

describe("pagination helpers", () => {
  it("prefers Jira enhanced search nextPageToken", () => {
    expect(getNextCursor({ nextPageToken: "jira-token", _links: { next: "/wiki/api/v2/pages?cursor=conf" } })).toBe(
      "jira-token",
    );
  });

  it("extracts Confluence cursor links from _links.next and next", () => {
    expect(getNextCursor({ _links: { next: "/wiki/api/v2/pages?cursor=from-links" } })).toBe("from-links");
    expect(getNextCursor({ next: "/wiki/api/v2/pages?cursor=from-next" })).toBe("from-next");
  });
});
