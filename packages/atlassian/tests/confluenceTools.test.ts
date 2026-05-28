import { describe, expect, it, vi } from "vitest";

import { ConfluenceClient } from "../src/confluence/ConfluenceClient";
import { getConfluencePageContext, parseConfluencePageId, renderConfluencePageMarkdown } from "../src/confluence/ConfluenceContext";
import { ConfluenceLegacyClient } from "../src/confluence/ConfluenceLegacyClient";
import { registerConfluenceTools } from "../src/confluence/tools";

class RecordingHttp {
  calls: Array<{ method: string; path: string; body?: unknown; query?: Record<string, unknown> }> = [];
  next: unknown = { ok: true };

  async get<T>(path: string, options: { query?: Record<string, unknown> } = {}): Promise<T> {
    this.calls.push({ method: "GET", path, query: options.query });
    return this.next as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: "POST", path, body });
    return this.next as T;
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    this.calls.push({ method: "PUT", path, body });
    return this.next as T;
  }

  async delete<T>(path: string, options: { query?: Record<string, unknown> } = {}): Promise<T> {
    this.calls.push({ method: "DELETE", path, query: options.query });
    return undefined as T;
  }
}

class FakePi {
  tools: Array<{ name: string; execute: (_id: string, params: any, signal?: AbortSignal) => Promise<any>; parameters?: unknown }> = [];

  registerTool(tool: { name: string; execute: (_id: string, params: any, signal?: AbortSignal) => Promise<any>; parameters?: unknown }): void {
    this.tools.push(tool);
  }
}

describe("ConfluenceClient", () => {
  it("maps v2 page and space operations to full /wiki/api/v2 paths", async () => {
    const http = new RecordingHttp();
    const client = new ConfluenceClient(http as never);

    await client.listSpaces({ limit: 10, cursor: "abc", keys: ["ENG"] });
    await client.listPages({ spaceId: "100", status: "current", bodyFormat: "storage", limit: 25 });
    await client.getPage({ pageId: "123", bodyFormat: "storage", includeLabels: true });
    await client.createPage({ spaceId: "100", title: "Hello", body: "<p>Hi</p>", parentId: "55" });
    await client.updatePage({ pageId: "123", title: "Hello", body: "<p>Hi</p>", version: 7 });
    await client.deletePage({ pageId: "123", purge: true });

    expect(http.calls).toEqual([
      { method: "GET", path: "/wiki/api/v2/spaces", query: { limit: 10, cursor: "abc", keys: ["ENG"] } },
      {
        method: "GET",
        path: "/wiki/api/v2/pages",
        query: { "space-id": "100", status: "current", "body-format": "storage", limit: 25 },
      },
      {
        method: "GET",
        path: "/wiki/api/v2/pages/123",
        query: { "body-format": "storage", "include-labels": true },
      },
      {
        method: "POST",
        path: "/wiki/api/v2/pages",
        body: {
          spaceId: "100",
          status: "current",
          title: "Hello",
          body: { representation: "storage", value: "<p>Hi</p>" },
          parentId: "55",
        },
      },
      {
        method: "PUT",
        path: "/wiki/api/v2/pages/123",
        body: {
          id: "123",
          status: "current",
          title: "Hello",
          body: { representation: "storage", value: "<p>Hi</p>" },
          version: { number: 8 },
        },
      },
      { method: "DELETE", path: "/wiki/api/v2/pages/123", query: { purge: true } },
    ]);
  });

  it("maps children, comments, labels, and footer comment creation", async () => {
    const http = new RecordingHttp();
    const client = new ConfluenceClient(http as never);

    await client.getPageChildren({ pageId: "123", cursor: "c", sort: "title", limit: 5 });
    await client.getComments({ pageId: "123", bodyFormat: "storage", status: "current", limit: 3 });
    await client.getLabels({ pageId: "123", prefix: "global", limit: 2 });
    await client.addComment({ pageId: "123", body: "<p>Comment</p>", parentCommentId: "999" });
    await client.addComment({ pageId: "123", body: "<p>Top level</p>" });

    expect(http.calls).toEqual([
      { method: "GET", path: "/wiki/api/v2/pages/123/children", query: { cursor: "c", sort: "title", limit: 5 } },
      {
        method: "GET",
        path: "/wiki/api/v2/pages/123/footer-comments",
        query: { "body-format": "storage", status: "current", limit: 3 },
      },
      { method: "GET", path: "/wiki/api/v2/pages/123/labels", query: { prefix: "global", limit: 2 } },
      {
        method: "POST",
        path: "/wiki/api/v2/footer-comments",
        body: {
          body: { representation: "storage", value: "<p>Comment</p>" },
          parentCommentId: "999",
        },
      },
      {
        method: "POST",
        path: "/wiki/api/v2/footer-comments",
        body: {
          body: { representation: "storage", value: "<p>Top level</p>" },
          pageId: "123",
        },
      },
    ]);
  });
});

describe("ConfluenceLegacyClient", () => {
  it("isolates verified v1-only operations", async () => {
    const http = new RecordingHttp();
    const client = new ConfluenceLegacyClient(http as never);

    await client.search({ cql: 'type = "page"', limit: 4, start: 2, expand: "content.body.storage" });
    await client.searchUser({ cql: 'user.fullname ~ "Ada"', limit: 3, start: 1 });
    await client.addLabel({ pageId: "123", labels: [{ prefix: "global", name: "roadmap" }] });

    expect(http.calls).toEqual([
      {
        method: "GET",
        path: "/wiki/rest/api/search",
        query: { cql: 'type = "page"', limit: 4, start: 2, expand: "content.body.storage" },
      },
      {
        method: "GET",
        path: "/wiki/rest/api/search/user",
        query: { cql: 'user.fullname ~ "Ada"', limit: 3, start: 1 },
      },
      {
        method: "POST",
        path: "/wiki/rest/api/content/123/label",
        body: [{ prefix: "global", name: "roadmap" }],
      },
    ]);
  });
});

describe("Confluence context helpers", () => {
  it("parses page ids from common Confluence URLs", () => {
    expect(parseConfluencePageId("https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title")).toBe("12345");
    expect(parseConfluencePageId("https://acme.atlassian.net/wiki/pages/viewpage.action?pageId=456")).toBe("456");
    expect(parseConfluencePageId("789")).toBe("789");
  });

  it("renders compact markdown from a v2 page response", async () => {
    const client = {
      getPage: vi.fn(async () => ({
        id: "123",
        title: "Specs",
        spaceId: "100",
        version: { number: 3, createdAt: "2026-01-01T00:00:00.000Z" },
        body: { storage: { value: '<h1>Heading</h1><p>See ABC-123 and <a href="https://figma.com/file/abc">design</a></p>' } },
        _links: { webui: "/wiki/spaces/ENG/pages/123/Specs", base: "https://acme.atlassian.net" },
      })),
      getPageChildren: vi.fn(async () => ({ results: [{ id: "124", title: "Child", _links: { webui: "/child", base: "https://acme.atlassian.net" } }] })),
    };

    const page = await getConfluencePageContext({ url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Specs", includeChildPages: true }, client as never);

    expect(page).toMatchObject({
      id: "123",
      title: "Specs",
      url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Specs",
      markdown: expect.stringContaining("# Heading"),
      headings: ["Heading"],
      links: { urls: ["https://figma.com/file/abc"], figmaUrls: ["https://figma.com/file/abc"], jiraKeys: ["ABC-123"] },
      childPages: [{ id: "124", title: "Child", url: "https://acme.atlassian.net/child" }],
    });
    expect(renderConfluencePageMarkdown(page)).toContain("## Jira Keys");
    expect(renderConfluencePageMarkdown(page)).toContain("ABC-123");
    expect(page.markdown).toContain("[design](https://figma.com/file/abc)");
  });
});

describe("Confluence tool registration", () => {
  it("registers all upstream Confluence tools plus confluence_page compatibility", async () => {
    const pi = new FakePi();
    const raw = new ConfluenceClient(new RecordingHttp() as never);
    const legacy = new ConfluenceLegacyClient(new RecordingHttp() as never);

    registerConfluenceTools(pi as never, { confluence: raw, legacy });

    expect(pi.tools.map((tool) => tool.name)).toEqual([
      "confluence_list_spaces",
      "confluence_list_pages",
      "confluence_create_page",
      "confluence_update_page",
      "confluence_search",
      "confluence_get_page",
      "confluence_get_page_children",
      "confluence_get_comments",
      "confluence_get_labels",
      "confluence_search_user",
      "confluence_delete_page",
      "confluence_add_label",
      "confluence_add_comment",
      "confluence_page",
    ]);
  });
});
