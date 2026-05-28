import { describe, expect, it, vi } from "vitest";

import {
  AtlassianCliStdinValidationError,
  executeAtlassianCliRequest,
  executeAtlassianCliStdinRequest,
  helpText,
  parseAtlassianCliArgs,
  parseAtlassianCliStdinRequest,
  type AtlassianCliDeps,
} from "../bin/atlassian";
import type { ConfluencePageContext } from "../src/confluence/ConfluenceContext";
import type { JiraIssueContext } from "../src/jira/JiraContext";
import type { StoryContext } from "../src/context/AtlassianContextWalker";

describe("atlassian development CLI contract", () => {
  it("parses compact Jira and context Jira commands", () => {
    expect(parseAtlassianCliArgs(["jira", "ABC-123"])).toEqual({
      mode: "human",
      tool: "jira_issue",
      key: "ABC-123",
      includeContext: false,
    });
    expect(parseAtlassianCliArgs(["jira", "ABC-123", "--context"])).toEqual({
      mode: "human",
      tool: "jira_issue",
      key: "ABC-123",
      includeContext: true,
    });
  });

  it("parses story, confluence, and stdin modes", () => {
    expect(parseAtlassianCliArgs(["story", "ABC-123"])).toEqual({
      mode: "human",
      tool: "story_context",
      key: "ABC-123",
    });
    expect(parseAtlassianCliArgs(["confluence", "12345"])).toEqual({
      mode: "human",
      tool: "confluence_page",
      target: "12345",
    });
    expect(parseAtlassianCliArgs(["--stdin"])).toEqual({ mode: "stdin" });
  });

  it("exposes human-readable usage for help and bad commands", () => {
    expect(helpText()).toContain("jira <KEY> [--context]");
    expect(() => parseAtlassianCliArgs(["unknown", "ABC-123"])).toThrow(/Unknown command/);
  });
});

describe("atlassian development CLI execution", () => {
  function fakeJiraIssue(key: string): JiraIssueContext {
    return {
      key,
      id: "10001",
      url: `https://acme.atlassian.net/browse/${key}`,
      summary: `Stub summary for ${key}`,
      issueType: "Story",
      status: "Open",
      assignee: undefined,
      reporter: undefined,
      parent: undefined,
      subtasks: [],
      linkedIssues: [],
      labels: [],
      components: [],
      fixVersions: [],
      description: "",
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
    };
  }
  function fakeStoryContext(key: string): StoryContext {
    return {
      issue: fakeJiraIssue(key) as unknown as StoryContext["issue"],
      jiraIssues: [],
      parentIssue: undefined,
      subtaskIssues: [],
      linkedIssueContexts: [],
      confluencePages: [],
      figmaContexts: [],
      designLinks: [],
      externalUrls: [],
      relatedJiraKeys: [],
      inaccessibleLinks: [],
    };
  }
  function fakeConfluencePage(id: string): ConfluencePageContext {
    return {
      id,
      title: `Stub title ${id}`,
      url: `https://acme.atlassian.net/wiki/pages/${id}`,
      spaceId: "100",
      version: 1,
      updatedAt: undefined,
      markdown: "stub body",
      headings: [],
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
      childPages: [],
    };
  }

  it("`jira KEY` without --context dispatches to getJiraIssueContext + renderJiraIssueMarkdown", async () => {
    const getJiraIssueContext = vi.fn(async (opts: { key: string }) => fakeJiraIssue(opts.key));
    const buildStoryContext = vi.fn();
    const getConfluencePageContext = vi.fn();
    const renderJiraIssueMarkdown = vi.fn(() => "RENDERED-JIRA");
    const renderStoryContextMarkdown = vi.fn();
    const renderConfluencePageMarkdown = vi.fn();
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: getJiraIssueContext as never,
      buildStoryContext: buildStoryContext as never,
      getConfluencePageContext: getConfluencePageContext as never,
      renderJiraIssueMarkdown: renderJiraIssueMarkdown as never,
      renderStoryContextMarkdown: renderStoryContextMarkdown as never,
      renderConfluencePageMarkdown: renderConfluencePageMarkdown as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliRequest(
      { mode: "human", tool: "jira_issue", key: "ABC-123", includeContext: false },
      deps,
    );

    expect(getJiraIssueContext).toHaveBeenCalledWith({ key: "ABC-123" });
    expect(buildStoryContext).not.toHaveBeenCalled();
    expect(renderJiraIssueMarkdown).toHaveBeenCalledOnce();
    expect(writes.join("")).toContain("RENDERED-JIRA");
  });

  it("`jira KEY --context` dispatches to buildStoryContext + renderStoryContextMarkdown", async () => {
    const getJiraIssueContext = vi.fn();
    const buildStoryContext = vi.fn(async (opts: { key: string }) => fakeStoryContext(opts.key));
    const renderJiraIssueMarkdown = vi.fn();
    const renderStoryContextMarkdown = vi.fn(() => "RENDERED-STORY");
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: getJiraIssueContext as never,
      buildStoryContext: buildStoryContext as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: renderJiraIssueMarkdown as never,
      renderStoryContextMarkdown: renderStoryContextMarkdown as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliRequest(
      { mode: "human", tool: "jira_issue", key: "ABC-123", includeContext: true },
      deps,
    );

    expect(buildStoryContext).toHaveBeenCalledOnce();
    expect(buildStoryContext.mock.calls[0][0]).toMatchObject({ key: "ABC-123" });
    expect(getJiraIssueContext).not.toHaveBeenCalled();
    expect(writes.join("")).toContain("RENDERED-STORY");
  });

  it("`story KEY` dispatches to buildStoryContext + renderStoryContextMarkdown", async () => {
    const buildStoryContext = vi.fn(async (opts: { key: string }) => fakeStoryContext(opts.key));
    const renderStoryContextMarkdown = vi.fn(() => "RENDERED-STORY");
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: buildStoryContext as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: renderStoryContextMarkdown as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliRequest(
      { mode: "human", tool: "story_context", key: "ABC-123" },
      deps,
    );

    expect(buildStoryContext).toHaveBeenCalledOnce();
    expect(writes.join("")).toContain("RENDERED-STORY");
  });

  it("`confluence URL|PAGE_ID` dispatches to getConfluencePageContext + renderConfluencePageMarkdown", async () => {
    const calls: Array<{ pageId?: string; url?: string }> = [];
    const getConfluencePageContext = vi.fn(async (params: { pageId?: string; url?: string }) => {
      calls.push(params);
      return fakeConfluencePage("12345");
    });
    const renderConfluencePageMarkdown = vi.fn(() => "RENDERED-CONFLUENCE");
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: getConfluencePageContext as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: renderConfluencePageMarkdown as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliRequest(
      { mode: "human", tool: "confluence_page", target: "https://acme.atlassian.net/wiki/spaces/ENG/pages/12345/Title" },
      deps,
    );

    expect(getConfluencePageContext).toHaveBeenCalledOnce();
    expect(calls[0].url).toContain("12345");
    expect(writes.join("")).toContain("RENDERED-CONFLUENCE");
  });

  it("`confluence 12345` (numeric id) passes pageId rather than url", async () => {
    const calls: Array<{ pageId?: string; url?: string }> = [];
    const getConfluencePageContext = vi.fn(async (params: { pageId?: string; url?: string }) => {
      calls.push(params);
      return fakeConfluencePage("12345");
    });
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: getConfluencePageContext as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn(() => "OUT") as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliRequest(
      { mode: "human", tool: "confluence_page", target: "12345" },
      deps,
    );

    expect(calls[0].pageId).toBe("12345");
    expect(calls[0].url).toBeUndefined();
  });
});

describe("atlassian development CLI --stdin mode", () => {
  function fakeJiraIssue(key: string): JiraIssueContext {
    return {
      key,
      id: "10001",
      url: `https://acme.atlassian.net/browse/${key}`,
      summary: `Stub for ${key}`,
      issueType: "Story",
      status: "Open",
      assignee: undefined,
      reporter: undefined,
      parent: undefined,
      subtasks: [],
      linkedIssues: [],
      labels: [],
      components: [],
      fixVersions: [],
      description: "",
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
    };
  }
  function fakeStoryContext(key: string): StoryContext {
    return {
      issue: fakeJiraIssue(key) as unknown as StoryContext["issue"],
      jiraIssues: [],
      parentIssue: undefined,
      subtaskIssues: [],
      linkedIssueContexts: [],
      confluencePages: [],
      figmaContexts: [],
      designLinks: [],
      externalUrls: [],
      relatedJiraKeys: [],
      inaccessibleLinks: [],
    };
  }
  function fakeConfluencePage(id: string): ConfluencePageContext {
    return {
      id,
      title: `Stub ${id}`,
      url: `https://acme.atlassian.net/wiki/pages/${id}`,
      spaceId: "100",
      version: 1,
      updatedAt: undefined,
      markdown: "stub",
      headings: [],
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
      childPages: [],
    };
  }

  it("parses jira_issue stdin payloads with and without includeContext", () => {
    expect(parseAtlassianCliStdinRequest({ tool: "jira_issue", key: "ABC-1" })).toEqual({
      tool: "jira_issue",
      key: "ABC-1",
      includeContext: false,
    });
    expect(parseAtlassianCliStdinRequest({ tool: "jira_issue", key: "ABC-1", includeContext: true })).toEqual({
      tool: "jira_issue",
      key: "ABC-1",
      includeContext: true,
    });
  });

  it("parses story_context and confluence_page stdin payloads", () => {
    expect(parseAtlassianCliStdinRequest({ tool: "story_context", key: "ABC-1" })).toEqual({
      tool: "story_context",
      key: "ABC-1",
    });
    expect(parseAtlassianCliStdinRequest({ tool: "confluence_page", pageId: "12345" })).toEqual({
      tool: "confluence_page",
      pageId: "12345",
      url: undefined,
    });
    expect(parseAtlassianCliStdinRequest({ tool: "confluence_page", url: "https://x/wiki/pages/9" })).toEqual({
      tool: "confluence_page",
      pageId: undefined,
      url: "https://x/wiki/pages/9",
    });
  });

  it("rejects malformed stdin payloads with a typed error", () => {
    expect(() => parseAtlassianCliStdinRequest("not an object")).toThrow(AtlassianCliStdinValidationError);
    expect(() => parseAtlassianCliStdinRequest({ tool: "unknown" })).toThrow(/Unknown tool/);
    expect(() => parseAtlassianCliStdinRequest({ tool: "jira_issue" })).toThrow(/non-empty `key`/);
    expect(() => parseAtlassianCliStdinRequest({ tool: "confluence_page" })).toThrow(/either `url` or `pageId`/);
  });

  it("dispatches stdin jira_issue (no context) to getJiraIssueContext and writes JSON", async () => {
    const getJiraIssueContext = vi.fn(async () => fakeJiraIssue("ABC-1"));
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: getJiraIssueContext as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliStdinRequest({ tool: "jira_issue", key: "ABC-1" }, deps);

    expect(getJiraIssueContext).toHaveBeenCalledOnce();
    const output = writes.join("");
    // JSON output, NOT markdown — automation expects parseable JSON.
    const parsed = JSON.parse(output);
    expect(parsed).toMatchObject({ key: "ABC-1", id: "10001" });
  });

  it("dispatches stdin story_context to buildStoryContext and writes the StoryContext as JSON", async () => {
    const buildStoryContext = vi.fn(async () => fakeStoryContext("ABC-2"));
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: buildStoryContext as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliStdinRequest({ tool: "story_context", key: "ABC-2" }, deps);

    expect(buildStoryContext).toHaveBeenCalledOnce();
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.issue.key).toBe("ABC-2");
  });

  it("forwards story-walker options through stdin (story_context and jira_issue+includeContext)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const buildStoryContext = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      return fakeStoryContext("ABC-3");
    });
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: buildStoryContext as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    // story_context with caps
    await executeAtlassianCliStdinRequest(
      parseAtlassianCliStdinRequest({
        tool: "story_context",
        key: "ABC-3",
        maxDepth: 2,
        maxJiraIssues: 5,
        maxConfluencePages: 3,
        includeExternalUrls: true,
        includeRemoteLinks: false,
      }),
      deps,
    );
    expect(calls[0]).toMatchObject({
      key: "ABC-3",
      maxDepth: 2,
      maxJiraIssues: 5,
      maxConfluencePages: 3,
      includeExternalUrls: true,
      includeRemoteLinks: false,
    });

    // jira_issue + includeContext routes through buildStoryContext too
    await executeAtlassianCliStdinRequest(
      parseAtlassianCliStdinRequest({
        tool: "jira_issue",
        key: "ABC-4",
        includeContext: true,
        maxComments: 7,
        includeSubtasks: false,
      }),
      deps,
    );
    expect(calls[1]).toMatchObject({
      key: "ABC-4",
      maxComments: 7,
      includeSubtasks: false,
    });
  });

  it("forwards getJiraIssueContext options on jira_issue without context", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const getJiraIssueContext = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      return fakeJiraIssue("ABC-5");
    });
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: getJiraIssueContext as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: vi.fn() as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliStdinRequest(
      parseAtlassianCliStdinRequest({
        tool: "jira_issue",
        key: "ABC-5",
        includeComments: false,
        maxComments: 12,
      }),
      deps,
    );

    expect(calls[0]).toMatchObject({ key: "ABC-5", includeComments: false, maxComments: 12 });
  });

  it("forwards confluence_page options (includeChildPages, maxChildPages)", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const getConfluencePageContext = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      return fakeConfluencePage("12345");
    });
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: getConfluencePageContext as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliStdinRequest(
      parseAtlassianCliStdinRequest({
        tool: "confluence_page",
        pageId: "12345",
        includeChildPages: true,
        maxChildPages: 7,
      }),
      deps,
    );

    expect(calls[0]).toMatchObject({ pageId: "12345", includeChildPages: true, maxChildPages: 7 });
  });

  it("rejects malformed option types in stdin payloads", () => {
    expect(() => parseAtlassianCliStdinRequest({ tool: "story_context", key: "X-1", maxDepth: "deep" })).toThrow(
      /maxDepth.*integer/,
    );
    expect(() => parseAtlassianCliStdinRequest({ tool: "story_context", key: "X-1", includeComments: "yes" })).toThrow(
      /includeComments.*boolean/,
    );
  });

  it("rejects non-boolean includeContext in stdin (was silently coerced to false before fix)", () => {
    expect(() =>
      parseAtlassianCliStdinRequest({ tool: "jira_issue", key: "ABC-1", includeContext: "true" }),
    ).toThrow(/includeContext.*boolean/);
  });

  it("enforces integer + minimum constraints to match registered tool schemas", () => {
    // maxDepth must be an integer
    expect(() => parseAtlassianCliStdinRequest({ tool: "story_context", key: "X-1", maxDepth: 1.5 })).toThrow(
      /maxDepth.*integer/,
    );
    // maxJiraIssues has a minimum of 1
    expect(() => parseAtlassianCliStdinRequest({ tool: "story_context", key: "X-1", maxJiraIssues: 0 })).toThrow(
      /maxJiraIssues.*integer >= 1/,
    );
    // Negative is rejected for fields with min=0 too
    expect(() => parseAtlassianCliStdinRequest({ tool: "story_context", key: "X-1", maxComments: -1 })).toThrow(
      /maxComments.*integer >= 0/,
    );
    // confluence_page maxChildPages is integer >= 0
    expect(() =>
      parseAtlassianCliStdinRequest({ tool: "confluence_page", pageId: "1", maxChildPages: 2.5 }),
    ).toThrow(/maxChildPages.*integer/);
  });

  it("dispatches stdin confluence_page (pageId form) to getConfluencePageContext and writes JSON", async () => {
    const calls: Array<{ pageId?: string; url?: string }> = [];
    const getConfluencePageContext = vi.fn(async (params: { pageId?: string; url?: string }) => {
      calls.push(params);
      return fakeConfluencePage("12345");
    });
    const writes: string[] = [];
    const deps: AtlassianCliDeps = {
      getJiraIssueContext: vi.fn() as never,
      buildStoryContext: vi.fn() as never,
      getConfluencePageContext: getConfluencePageContext as never,
      renderJiraIssueMarkdown: vi.fn() as never,
      renderStoryContextMarkdown: vi.fn() as never,
      renderConfluencePageMarkdown: vi.fn() as never,
      write: (s) => writes.push(s),
    };

    await executeAtlassianCliStdinRequest({ tool: "confluence_page", pageId: "12345" }, deps);

    expect(calls[0].pageId).toBe("12345");
    const parsed = JSON.parse(writes.join(""));
    expect(parsed.id).toBe("12345");
  });
});
