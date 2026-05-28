import { describe, expect, it, vi } from "vitest";

import { buildStoryContext, renderStoryContextMarkdown } from "../src/context/AtlassianContextWalker";
import { extractLinks } from "../src/links/extractLinks";
import { resolveAtlassianLinks } from "../src/links/resolveAtlassianLinks";
import { plainTextToAdf } from "../src/text/adf";
import { registerJiraPlatformTools } from "../src/jira/tools";

class FakePi {
  tools: Array<{ name: string; execute: (_id: string, params: any, signal?: AbortSignal) => Promise<any>; parameters?: unknown }> = [];

  registerTool(tool: { name: string; execute: (_id: string, params: any, signal?: AbortSignal) => Promise<any>; parameters?: unknown }): void {
    this.tools.push(tool);
  }
}

describe("extractLinks", () => {
  it("extracts and dedupes links from ADF, HTML anchors, raw URLs, Jira keys, and punctuation", () => {
    const links = extractLinks({
      html: '<a href="https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec">Spec</a>',
      adf: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "ABC-1" },
              { type: "text", text: "design", marks: [{ type: "link", attrs: { href: "https://figma.com/file/abc?node-id=1" } }] },
            ],
          },
        ],
      },
      text: "See https://acme.atlassian.net/browse/ABC-2, https://example.com/spec). and ABC-1",
    });

    expect(links.urls).toEqual([
      "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec",
      "https://figma.com/file/abc?node-id=1",
      "https://acme.atlassian.net/browse/ABC-2",
      "https://example.com/spec",
    ]);
    expect(links.figmaUrls).toEqual(["https://figma.com/file/abc?node-id=1"]);
    expect(links.confluenceUrls).toEqual(["https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec"]);
    expect(links.jiraUrls).toEqual(["https://acme.atlassian.net/browse/ABC-2"]);
    expect(links.jiraKeys).toEqual(["ABC-1", "ABC-2"]);
    expect(links.externalUrls).toEqual(["https://example.com/spec"]);
  });
});

describe("resolveAtlassianLinks", () => {
  it("resolves same-site Jira and Confluence links while leaving external links as inventory", () => {
    const resolved = resolveAtlassianLinks(
      extractLinks("ABC-9 https://acme.atlassian.net/browse/ABC-1 https://other.atlassian.net/browse/XYZ-1 https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec https://figma.com/file/abc"),
      { baseUrl: "https://acme.atlassian.net" },
    );

    expect(resolved.jiraKeys).toEqual(["ABC-9", "ABC-1"]);
    expect(resolved.confluencePages).toEqual([{ url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec", pageId: "123" }]);
    expect(resolved.figmaUrls).toEqual(["https://figma.com/file/abc"]);
    expect(resolved.externalUrls).toEqual(["https://other.atlassian.net/browse/XYZ-1"]);
  });
});

describe("AtlassianContextWalker", () => {
  it("follows bounded Jira and Confluence links, dedupes cycles, and inventories external URLs", async () => {
    const issueCalls: string[] = [];
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async ({ issueIdOrKey }: { issueIdOrKey: string }) => {
        issueCalls.push(issueIdOrKey);
        return issue(issueIdOrKey);
      }),
      getComments: vi.fn(async ({ issueIdOrKey }: { issueIdOrKey: string }) => ({
        comments: issueIdOrKey === "ABC-1" ? [{ id: "c1", body: plainTextToAdf("Comment links ABC-4"), author: { displayName: "Ada" } }] : [],
      })),
      getRemoteLinks: vi.fn(async () => [{ object: { url: "https://external.example/spec" } }]),
    };
    const confluence = {
      getPage: vi.fn(async () => ({
        id: "123",
        title: "Spec",
        body: { storage: { value: '<h1>Spec</h1><p>Mentions ABC-5 and <a href="https://figma.com/file/page">page design</a></p>' } },
        _links: { base: "https://acme.atlassian.net", webui: "/wiki/spaces/ENG/pages/123/Spec" },
      })),
      getPageChildren: vi.fn(async () => ({ results: [] })),
    };

    const context = await buildStoryContext(
      {
        key: "ABC-1",
        maxDepth: 1,
        maxJiraIssues: 3,
        maxConfluencePages: 1,
        includeExternalUrls: true,
      },
      { jira: jira as never, confluence: confluence as never },
    );

    expect(context.issue.key).toBe("ABC-1");
    expect(new Set(context.jiraIssues.map((item) => item.key))).toEqual(new Set(["ABC-1", "ABC-2", "ABC-3"]));
    expect(issueCalls.filter((key) => key === "ABC-1")).toHaveLength(1);
    expect(context.confluencePages).toHaveLength(1);
    expect(context.designLinks).toEqual(["https://figma.com/file/root", "https://figma.com/file/page"]);
    expect(context.externalUrls).toEqual(["https://external.example/spec"]);
    expect(context.relatedJiraKeys).toContain("ABC-5");
    expect(renderStoryContextMarkdown(context)).toContain("## Linked Confluence Pages");
  });

  it("reports inaccessible same-site links without exceeding caps", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => ({
        id: "1",
        key: "ABC-1",
        fields: {
          summary: "Root",
          description: plainTextToAdf("https://acme.atlassian.net/wiki/spaces/ENG/pages/1/One https://acme.atlassian.net/wiki/spaces/ENG/pages/2/Two"),
        },
        names: {},
      })),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const confluence = {
      getPage: vi.fn(async () => {
        throw new Error("Forbidden");
      }),
      getPageChildren: vi.fn(),
    };

    const context = await buildStoryContext(
      { key: "ABC-1", maxConfluencePages: 1, includeExternalUrls: true },
      { jira: jira as never, confluence: confluence as never },
    );

    expect(confluence.getPage).toHaveBeenCalledTimes(1);
    expect(context.confluencePages).toEqual([]);
    expect(context.inaccessibleLinks).toEqual([
      { type: "confluence", target: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1/One", reason: "Forbidden" },
    ]);
  });

  it("scans user-authored Jira fields without polluting external URLs with REST metadata", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => ({
        id: "1",
        key: "ABC-1",
        fields: {
          summary: "Root",
          description: plainTextToAdf("No external links here"),
          assignee: { self: "https://acme.atlassian.net/rest/api/3/user?accountId=123", displayName: "Ada" },
          customfield_10000: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "design", marks: [{ type: "link", attrs: { href: "https://figma.com/file/custom" } }] }] }],
          },
        },
        names: { customfield_10000: "Design Link" },
      })),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };

    const context = await buildStoryContext(
      { key: "ABC-1", maxJiraIssues: 1, includeConfluence: false, includeExternalUrls: true },
      { jira: jira as never, confluence: { getPage: vi.fn(), getPageChildren: vi.fn() } as never },
    );

    expect(context.designLinks).toEqual(["https://figma.com/file/custom"]);
    expect(context.externalUrls).toEqual([]);
  });

  it("adds bounded linked Figma context when Figma auth is configured", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => issue("ABC-1")),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const figma = {
      isConfigured: () => true,
      build: vi.fn(async ({ url }: { url: string }) => ({
        url,
        mode: "overview" as const,
        markdown: `Figma summary for ${url}`,
        details: { ok: true },
      })),
    };

    const context = await buildStoryContext(
      { key: "ABC-1", includeConfluence: false, maxJiraIssues: 1, maxFigmaLinks: 1 },
      { jira: jira as never, confluence: { getPage: vi.fn(), getPageChildren: vi.fn() } as never, figma },
    );

    expect(figma.build).toHaveBeenCalledTimes(1);
    expect(context.figmaContexts).toHaveLength(1);
    expect(renderStoryContextMarkdown(context)).toContain("## Linked Figma Context");
  });

  it("skips Figma calls by default when auth is absent but records explicit missing-auth feedback", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => issue("ABC-1")),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const figma = { isConfigured: () => false, build: vi.fn() };
    const deps = { jira: jira as never, confluence: { getPage: vi.fn(), getPageChildren: vi.fn() } as never, figma };

    const autoContext = await buildStoryContext({ key: "ABC-1", includeConfluence: false, maxJiraIssues: 1 }, deps);
    const explicitContext = await buildStoryContext(
      { key: "ABC-1", includeConfluence: false, maxJiraIssues: 1, includeFigmaContext: true },
      deps,
    );

    expect(autoContext.figmaContexts).toEqual([]);
    expect(figma.build).not.toHaveBeenCalled();
    expect(explicitContext.inaccessibleLinks).toContainEqual({
      type: "figma",
      target: "https://figma.com/file/root",
      reason: "Figma token is not configured.",
    });
  });

  it("honors includeFigmaContext=false", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => issue("ABC-1")),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const figma = { isConfigured: () => true, build: vi.fn() };

    const context = await buildStoryContext(
      { key: "ABC-1", includeConfluence: false, maxJiraIssues: 1, includeFigmaContext: false },
      { jira: jira as never, confluence: { getPage: vi.fn(), getPageChildren: vi.fn() } as never, figma },
    );

    expect(context.figmaContexts).toEqual([]);
    expect(figma.build).not.toHaveBeenCalled();
  });

  it("keeps Jira context when configured Figma calls fail", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => issue("ABC-1")),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const figma = {
      isConfigured: () => true,
      build: vi.fn(async () => {
        throw new Error("Figma forbidden");
      }),
    };

    const context = await buildStoryContext(
      { key: "ABC-1", includeConfluence: false, maxJiraIssues: 1 },
      { jira: jira as never, confluence: { getPage: vi.fn(), getPageChildren: vi.fn() } as never, figma },
    );

    expect(context.issue.key).toBe("ABC-1");
    expect(context.figmaContexts).toEqual([]);
    expect(context.inaccessibleLinks).toContainEqual({
      type: "figma",
      target: "https://figma.com/file/root",
      reason: "Figma forbidden",
    });
  });

  it("caps Figma enrichment across Jira and Confluence Figma URLs", async () => {
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async () => ({
        id: "1",
        key: "ABC-1",
        fields: {
          summary: "Root",
          description: plainTextToAdf(
            "https://figma.com/file/root-one https://figma.com/file/root-two https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec",
          ),
        },
        names: {},
      })),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const confluence = {
      getPage: vi.fn(async () => ({
        id: "123",
        title: "Spec",
        body: { storage: { value: '<p><a href="https://figma.com/file/from-confluence">design</a></p>' } },
        _links: { base: "https://acme.atlassian.net", webui: "/wiki/spaces/ENG/pages/123/Spec" },
      })),
      getPageChildren: vi.fn(async () => ({ results: [] })),
    };
    const figma = {
      isConfigured: () => true,
      build: vi.fn(async ({ url }: { url: string }) => ({
        url,
        mode: "overview" as const,
        markdown: url,
        details: {},
      })),
    };

    const context = await buildStoryContext(
      { key: "ABC-1", maxJiraIssues: 1, maxConfluencePages: 1, maxFigmaLinks: 2 },
      { jira: jira as never, confluence: confluence as never, figma },
    );

    expect(context.designLinks).toEqual([
      "https://figma.com/file/root-one",
      "https://figma.com/file/root-two",
      "https://figma.com/file/from-confluence",
    ]);
    expect(figma.build).toHaveBeenCalledTimes(2);
    expect(context.figmaContexts.map((item) => item.url)).toEqual([
      "https://figma.com/file/root-one",
      "https://figma.com/file/root-two",
    ]);
  });
});

describe("context tool wiring", () => {
  it("registers story_context and lets jira_get_issue return context when includeContext is true", async () => {
    const pi = new FakePi();
    const jira = {
      baseUrl: "https://acme.atlassian.net",
      getIssue: vi.fn(async ({ issueIdOrKey }: { issueIdOrKey: string }) => issue(issueIdOrKey)),
      getComments: vi.fn(async () => ({ comments: [] })),
      getRemoteLinks: vi.fn(async () => []),
    };
    const confluence = { getPage: vi.fn(), getPageChildren: vi.fn() };

    registerJiraPlatformTools(pi as never, { jira: jira as never, confluence: confluence as never });

    expect(pi.tools.map((tool) => tool.name)).toContain("story_context");
    const getIssue = pi.tools.find((tool) => tool.name === "jira_get_issue");
    const result = await getIssue?.execute("call-1", { issueIdOrKey: "ABC-1", includeContext: true, maxJiraIssues: 1 });

    expect(result?.content[0].text).toContain("# ABC-1");
    expect(result?.details.issue.key).toBe("ABC-1");
  });
});

function issue(key: string): unknown {
  const linked = key === "ABC-1" ? [{ type: { name: "relates to" }, outwardIssue: { key: "ABC-3", fields: { summary: "Linked" } } }] : [];
  return {
    id: key.replace(/\D/g, "") || "1",
    key,
    fields: {
      summary: key === "ABC-1" ? "Root" : `Summary ${key}`,
      description: plainTextToAdf(key === "ABC-1" ? "Root links ABC-2, ABC-1, https://figma.com/file/root and https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Spec" : "Leaf"),
      issuelinks: linked,
    },
    names: {},
  };
}
