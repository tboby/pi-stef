import { describe, expect, it } from "vitest";

import { createDefaultExternalFetcher } from "../src/research/default-fetcher";
import type { ExternalRef } from "../src/research/types";

// All tests use injected stubs so nothing reaches the network. The default
// resolvers (fetchGuardedText / getJiraIssueContext / getConfluencePageContext)
// are exercised at integration time and through other tests, not here.

describe("createDefaultExternalFetcher: URL refs", () => {
  it("happy path: returns content + title for a 200 OK HTML response", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({
        text: "<html><head><title>Hello World</title></head><body>Body text here</body></html>",
        status: 200,
        url: "https://example.com/",
        contentType: "text/html",
      }),
    });
    const ref: ExternalRef = { kind: "url", raw: "https://example.com/", id: "https://example.com/" };
    const hit = await fetcher(ref);
    expect(hit).not.toBeNull();
    expect(hit!.title).toBe("Hello World");
    expect(hit!.content).toContain("Body text here");
    expect(hit!.content).not.toContain("<title>");
  });

  it("returns null when fetchUrl rejects a non-http(s) scheme (SSRF guard)", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => { throw new Error("Only http and https URLs are allowed: file:"); },
    });
    const ref: ExternalRef = { kind: "url", raw: "file:///etc/passwd", id: "file:///etc/passwd" };
    const hit = await fetcher(ref);
    expect(hit).toBeNull();
  });

  it("returns null on non-2xx status", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({ text: "server error", status: 500, url: "https://example.com/", contentType: "text/plain" }),
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" });
    expect(hit).toBeNull();
  });

  it("caps rendered content to maxRenderedBytes", async () => {
    const big = "x".repeat(200 * 1024);
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({ text: big, status: 200, url: "https://example.com/", contentType: "text/plain" }),
      maxRenderedBytes: 1024,
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" });
    expect(hit).not.toBeNull();
    expect(hit!.content.length).toBeLessThanOrEqual(1024);
  });

  it("strips <script>...</script> and <style>...</style> from extracted text", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({
        text: "<html><head><style>body{}</style></head><body>visible<script>alert(1)</script>more visible</body></html>",
        status: 200,
        url: "https://example.com/",
        contentType: "text/html",
      }),
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" });
    expect(hit).not.toBeNull();
    expect(hit!.content).toContain("visible");
    expect(hit!.content).toContain("more visible");
    expect(hit!.content).not.toContain("alert");
    expect(hit!.content).not.toContain("body{}");
  });

  it("extracts title from <title>...</title>", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({
        text: "<html><head><title>  My Page  </title></head><body>x</body></html>",
        status: 200,
        url: "https://example.com/",
        contentType: "text/html",
      }),
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" });
    expect(hit).not.toBeNull();
    expect(hit!.title).toBe("My Page");
  });

  it("propagates signal abort by returning null (never throws)", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async (_url, signal) => {
        if (signal?.aborted) throw new Error("aborted");
        throw new Error("aborted before fetch completed");
      },
    });
    const ctrl = new AbortController();
    ctrl.abort();
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" }, ctrl.signal);
    expect(hit).toBeNull();
  });

  it("does NOT strip angle brackets from non-HTML content types (regression for impl-review round-1 P2)", async () => {
    // Plain-text / markdown / JSON / source files may legitimately contain
    // `<` and `>` characters (generics, JSX, JSON strings, comparison ops).
    // HTML extraction must be gated on contentType to avoid corrupting these.
    const source = 'function f<T>(x: T) { return x > 0; }\n<div>this is real text</div>';
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({
        text: source,
        status: 200,
        url: "https://example.com/raw/file.ts",
        contentType: "text/plain; charset=utf-8",
      }),
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/raw/file.ts", id: "https://example.com/raw/file.ts" });
    expect(hit).not.toBeNull();
    // The raw body must come through verbatim (modulo the rendered cap).
    expect(hit!.content).toContain("function f<T>(x: T)");
    expect(hit!.content).toContain("x > 0");
    expect(hit!.content).toContain("<div>this is real text</div>");
    // Title comes from the URL fallback because we did not parse HTML.
    expect(hit!.title).toBe("https://example.com/raw/file.ts");
  });

  it("HTML extraction still runs for application/xhtml+xml", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => ({
        text: "<html><head><title>XHTML</title></head><body>x</body></html>",
        status: 200,
        url: "https://example.com/",
        contentType: "application/xhtml+xml",
      }),
    });
    const hit = await fetcher({ kind: "url", raw: "https://example.com/", id: "https://example.com/" });
    expect(hit).not.toBeNull();
    expect(hit!.title).toBe("XHTML");
    expect(hit!.content).not.toContain("<html>");
  });
});

describe("createDefaultExternalFetcher: Jira refs", () => {
  it("happy path: returns rendered markdown + key/summary title", async () => {
    const fetcher = createDefaultExternalFetcher({
      getJiraContext: (async () => ({
        key: "DIGENG-17720",
        id: "10000",
        summary: "Fix the thing",
        url: "https://example.atlassian.net/browse/DIGENG-17720",
        issueType: "Task",
        status: "To Do",
        description: "details here",
        subtasks: [],
        linkedIssues: [],
        labels: [],
        components: [],
        fixVersions: [],
        acceptanceCriteria: [],
        customFields: {},
        comments: [],
        links: {
          urls: [],
          figmaUrls: [],
          confluenceUrls: [],
          jiraUrls: [],
          jiraKeys: [],
          jiraKeysFromText: [],
          jiraKeysFromUrls: [],
          externalUrls: [],
        },
      }) as unknown) as never,
    });
    const hit = await fetcher({ kind: "jira", raw: "DIGENG-17720", id: "DIGENG-17720" });
    expect(hit).not.toBeNull();
    expect(hit!.title).toBe("DIGENG-17720: Fix the thing");
    expect(hit!.content).toContain("DIGENG-17720");
    expect(hit!.content).toContain("Fix the thing");
  });

  it("returns null when AtlassianAuth is not configured (helper throws)", async () => {
    const fetcher = createDefaultExternalFetcher({
      getJiraContext: (async () => {
        throw new Error("Atlassian credentials not found. Set ATLASSIAN_BASE_URL ...");
      }) as never,
    });
    const hit = await fetcher({ kind: "jira", raw: "DIGENG-17720", id: "DIGENG-17720" });
    expect(hit).toBeNull();
  });
});

describe("createDefaultExternalFetcher: Confluence refs", () => {
  it("happy path: returns rendered markdown + page title", async () => {
    const fetcher = createDefaultExternalFetcher({
      getConfluenceContext: (async () => ({
        id: "12345",
        title: "Design Doc",
        url: "https://example.atlassian.net/wiki/spaces/ENG/pages/12345/Design+Doc",
        markdown: "## Section\n\nBody",
        spaceId: "ENG",
        version: 4,
        updatedAt: "2026-05-01T00:00:00Z",
        headings: [],
        childPages: [],
        links: {
          urls: [],
          figmaUrls: [],
          confluenceUrls: [],
          jiraUrls: [],
          jiraKeys: [],
          jiraKeysFromText: [],
          jiraKeysFromUrls: [],
          externalUrls: [],
        },
      }) as unknown) as never,
    });
    const hit = await fetcher({
      kind: "confluence",
      raw: "https://example.atlassian.net/wiki/spaces/ENG/pages/12345/Design+Doc",
      id: "https://example.atlassian.net/wiki/spaces/ENG/pages/12345/Design+Doc",
    });
    expect(hit).not.toBeNull();
    expect(hit!.title).toBe("Design Doc");
    expect(hit!.content).toContain("Design Doc");
  });

  it("returns null for tinyLink URLs (helper throws 'Confluence pageId is required')", async () => {
    const fetcher = createDefaultExternalFetcher({
      getConfluenceContext: (async () => {
        throw new Error("Confluence pageId is required. Pass pageId or a URL containing a page ID.");
      }) as never,
    });
    const hit = await fetcher({
      kind: "confluence",
      raw: "https://example.atlassian.net/wiki/x/ABC",
      id: "https://example.atlassian.net/wiki/x/ABC",
    });
    expect(hit).toBeNull();
  });
});

describe("createDefaultExternalFetcher: file refs (defensive — scanRefs no longer emits these)", () => {
  it("returns null without performing any I/O", async () => {
    const fetcher = createDefaultExternalFetcher({
      fetchUrl: async () => { throw new Error("must not be called for kind=file"); },
      getJiraContext: (async () => { throw new Error("must not be called for kind=file"); }) as never,
      getConfluenceContext: (async () => { throw new Error("must not be called for kind=file"); }) as never,
    });
    const hit = await fetcher({ kind: "file", raw: "x.ts", id: "x.ts" });
    expect(hit).toBeNull();
  });
});
