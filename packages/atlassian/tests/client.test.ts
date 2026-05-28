import { describe, expect, it, vi } from "vitest";

import { AtlassianClient } from "../src/http/AtlassianClient";
import { AtlassianApiError } from "../src/http/errors";
import type { AtlassianConfig } from "../src/auth/AtlassianAuth";

class StaticAuth {
  getConfig(): AtlassianConfig {
    return {
      baseUrl: "https://example.atlassian.net",
      email: "me@example.com",
      apiToken: "token",
    };
  }

  getAuthHeader(): string {
    return "Basic abc123";
  }
}

describe("AtlassianClient", () => {
  it("serializes query strings and JSON bodies with auth headers", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new AtlassianClient(new StaticAuth(), fetchMock);

    await expect(
      client.post(
        "/rest/api/3/search/jql",
        { jql: "project = ABC" },
        { query: { fields: ["summary", "status"], maxResults: 10, empty: undefined } },
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/search/jql?fields=summary&fields=status&maxResults=10",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ jql: "project = ABC" }),
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Basic abc123",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("returns undefined for empty successful responses", async () => {
    const client = new AtlassianClient(new StaticAuth(), vi.fn(async () => new Response(null, { status: 204 })));

    await expect(client.delete("/rest/api/3/issue/ABC-1")).resolves.toBeUndefined();
  });

  it("throws a bounded AtlassianApiError on non-2xx responses", async () => {
    const client = new AtlassianClient(
      new StaticAuth(),
      vi.fn(async () => new Response("x".repeat(1000), { status: 403, statusText: "Forbidden" })),
    );

    await expect(client.get("/rest/api/3/project/search")).rejects.toMatchObject({
      name: "AtlassianApiError",
      status: 403,
      statusText: "Forbidden",
      method: "GET",
      path: "/rest/api/3/project/search",
    });
    await client.get("/rest/api/3/project/search").catch((error: unknown) => {
      expect(error).toBeInstanceOf(AtlassianApiError);
      expect((error as AtlassianApiError).responseText.length).toBeLessThanOrEqual(520);
    });
  });

  it("supports absolute Atlassian URLs without prefixing baseUrl", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const client = new AtlassianClient(new StaticAuth(), fetchMock);

    await client.get("https://example.atlassian.net/wiki/api/v2/pages/123");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.atlassian.net/wiki/api/v2/pages/123",
      expect.any(Object),
    );
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
