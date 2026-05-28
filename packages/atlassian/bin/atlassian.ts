#!/usr/bin/env tsx
import { pathToFileURL } from "node:url";

import {
  buildStoryContext as defaultBuildStoryContext,
  renderStoryContextMarkdown as defaultRenderStoryContextMarkdown,
} from "../src/context/AtlassianContextWalker";
import {
  getConfluencePageContext as defaultGetConfluencePageContext,
  renderConfluencePageMarkdown as defaultRenderConfluencePageMarkdown,
} from "../src/confluence/ConfluenceContext";
import {
  getJiraIssueContext as defaultGetJiraIssueContext,
  renderJiraIssueMarkdown as defaultRenderJiraIssueMarkdown,
} from "../src/jira/JiraContext";

export type AtlassianCliRequest =
  | { mode: "stdin" }
  | { mode: "human"; tool: "jira_issue"; key: string; includeContext: boolean }
  | { mode: "human"; tool: "story_context"; key: string }
  | { mode: "human"; tool: "confluence_page"; target: string };

export interface AtlassianCliDeps {
  getJiraIssueContext: typeof defaultGetJiraIssueContext;
  buildStoryContext: typeof defaultBuildStoryContext;
  getConfluencePageContext: typeof defaultGetConfluencePageContext;
  renderJiraIssueMarkdown: typeof defaultRenderJiraIssueMarkdown;
  renderStoryContextMarkdown: typeof defaultRenderStoryContextMarkdown;
  renderConfluencePageMarkdown: typeof defaultRenderConfluencePageMarkdown;
  write: (text: string) => void;
}

export function parseAtlassianCliArgs(argv: string[]): AtlassianCliRequest {
  if (argv.length === 1 && argv[0] === "--stdin") return { mode: "stdin" };
  if (argv[0] === "--stdin") throw new Error("--stdin does not accept additional arguments.");

  const [command, target, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    throw new Error(helpText());
  }
  if (!target) throw new Error(`Missing target for ${command}.\n\n${helpText()}`);

  if (command === "jira") {
    return {
      mode: "human",
      tool: "jira_issue",
      key: target,
      includeContext: rest.includes("--context"),
    };
  }
  if (command === "story") {
    return { mode: "human", tool: "story_context", key: target };
  }
  if (command === "confluence") {
    return { mode: "human", tool: "confluence_page", target };
  }

  throw new Error(`Unknown command: ${command}.\n\n${helpText()}`);
}

export function helpText(): string {
  return `Usage: atlassian <command> [args]

Commands:
  jira <KEY> [--context]       Fetch compact Jira issue context
  story <KEY>                  Fetch deep Jira story context
  confluence <URL|PAGE_ID>     Fetch compact Confluence page context
  --stdin                      Read JSON tool input from stdin`;
}

const defaultCliDeps: AtlassianCliDeps = {
  getJiraIssueContext: defaultGetJiraIssueContext,
  buildStoryContext: defaultBuildStoryContext,
  getConfluencePageContext: defaultGetConfluencePageContext,
  renderJiraIssueMarkdown: defaultRenderJiraIssueMarkdown,
  renderStoryContextMarkdown: defaultRenderStoryContextMarkdown,
  renderConfluencePageMarkdown: defaultRenderConfluencePageMarkdown,
  write: (text) => process.stdout.write(text),
};

/**
 * Stdin-mode JSON request. Mirrors the human-mode tool dispatch but the
 * response is the raw context object as JSON (no Markdown rendering),
 * suitable for downstream automation.
 *
 * Each variant carries the same optional traversal/cap parameters that
 * the underlying helpers (getJiraIssueContext / buildStoryContext /
 * getConfluencePageContext) accept, so callers can bound a request
 * exactly the way they would when calling the registered Pi tools.
 */
export type AtlassianCliStdinRequest =
  | {
      tool: "jira_issue";
      key: string;
      includeContext?: boolean;
      // jira_issue (no context) → forwarded to getJiraIssueContext
      includeComments?: boolean;
      maxComments?: number;
      // jira_issue + includeContext → forwarded to buildStoryContext (story-walker traversal options)
      includeConfluence?: boolean;
      includeJiraLinks?: boolean;
      includeParent?: boolean;
      includeSubtasks?: boolean;
      includeLinkedIssues?: boolean;
      includeRemoteLinks?: boolean;
      includeExternalUrls?: boolean;
      includeConfluenceChildren?: boolean;
      maxDepth?: number;
      maxConfluencePages?: number;
      maxJiraIssues?: number;
      maxExternalUrls?: number;
      maxChildPages?: number;
    }
  | {
      tool: "story_context";
      key: string;
      // forwarded to buildStoryContext
      includeComments?: boolean;
      includeConfluence?: boolean;
      includeJiraLinks?: boolean;
      includeParent?: boolean;
      includeSubtasks?: boolean;
      includeLinkedIssues?: boolean;
      includeRemoteLinks?: boolean;
      includeExternalUrls?: boolean;
      includeConfluenceChildren?: boolean;
      maxComments?: number;
      maxDepth?: number;
      maxConfluencePages?: number;
      maxJiraIssues?: number;
      maxExternalUrls?: number;
      maxChildPages?: number;
    }
  | {
      tool: "confluence_page";
      url?: string;
      pageId?: string;
      // forwarded to getConfluencePageContext
      includeChildPages?: boolean;
      maxChildPages?: number;
    };

export class AtlassianCliStdinValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AtlassianCliStdinValidationError";
  }
}

const STORY_BOOL_KEYS = [
  "includeComments",
  "includeConfluence",
  "includeJiraLinks",
  "includeParent",
  "includeSubtasks",
  "includeLinkedIssues",
  "includeRemoteLinks",
  "includeExternalUrls",
  "includeConfluenceChildren",
] as const;
const STORY_NUMBER_KEYS = [
  "maxComments",
  "maxDepth",
  "maxConfluencePages",
  "maxJiraIssues",
  "maxExternalUrls",
  "maxChildPages",
] as const;

function validatedBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new AtlassianCliStdinValidationError(`stdin field \`${key}\` must be a boolean if present.`);
  }
  return value;
}
/**
 * Validate an integer-valued option. The registered Pi tool schemas use
 * integer constraints (and `maxJiraIssues` is documented with a minimum
 * of 1) — accept the same shape here so stdin and the registered tools
 * agree on what's a legal value.
 */
function validatedInt(obj: Record<string, unknown>, key: string, min = 0): number | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    throw new AtlassianCliStdinValidationError(
      `stdin field \`${key}\` must be an integer >= ${min} if present.`,
    );
  }
  return value;
}

/**
 * Per-key minimum so stdin matches the registered tool schemas — see
 * packages/atlassian/src/jira/tools.ts where `maxJiraIssues` is the
 * only field with a documented minimum greater than zero.
 */
const STORY_NUMBER_MIN: Record<(typeof STORY_NUMBER_KEYS)[number], number> = {
  maxComments: 0,
  maxDepth: 0,
  maxConfluencePages: 0,
  maxJiraIssues: 1,
  maxExternalUrls: 0,
  maxChildPages: 0,
};

function pickStoryOptions(
  obj: Record<string, unknown>,
): Partial<Pick<AtlassianCliStdinRequest & { tool: "story_context" }, (typeof STORY_BOOL_KEYS)[number] | (typeof STORY_NUMBER_KEYS)[number]>> {
  const result: Record<string, boolean | number> = {};
  for (const k of STORY_BOOL_KEYS) {
    const v = validatedBool(obj, k);
    if (v !== undefined) result[k] = v;
  }
  for (const k of STORY_NUMBER_KEYS) {
    const v = validatedInt(obj, k, STORY_NUMBER_MIN[k]);
    if (v !== undefined) result[k] = v;
  }
  return result as never;
}

export function parseAtlassianCliStdinRequest(raw: unknown): AtlassianCliStdinRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AtlassianCliStdinValidationError("stdin payload must be a JSON object with a `tool` field.");
  }
  const obj = raw as Record<string, unknown>;
  const tool = obj.tool;
  if (tool === "jira_issue") {
    if (typeof obj.key !== "string" || obj.key.length === 0) {
      throw new AtlassianCliStdinValidationError("jira_issue requires a non-empty `key` string.");
    }
    const includeContext = validatedBool(obj, "includeContext") ?? false;
    return {
      tool,
      key: obj.key,
      includeContext,
      ...pickStoryOptions(obj),
    };
  }
  if (tool === "story_context") {
    if (typeof obj.key !== "string" || obj.key.length === 0) {
      throw new AtlassianCliStdinValidationError("story_context requires a non-empty `key` string.");
    }
    return {
      tool,
      key: obj.key,
      ...pickStoryOptions(obj),
    };
  }
  if (tool === "confluence_page") {
    const url = typeof obj.url === "string" && obj.url.length > 0 ? obj.url : undefined;
    const pageId = typeof obj.pageId === "string" && obj.pageId.length > 0 ? obj.pageId : undefined;
    if (!url && !pageId) {
      throw new AtlassianCliStdinValidationError("confluence_page requires either `url` or `pageId`.");
    }
    return {
      tool,
      url,
      pageId,
      includeChildPages: validatedBool(obj, "includeChildPages"),
      maxChildPages: validatedInt(obj, "maxChildPages", 0),
    };
  }
  throw new AtlassianCliStdinValidationError(`Unknown tool in stdin payload: ${JSON.stringify(tool)}.`);
}

/**
 * Execute a stdin-mode request and write the result as a JSON string
 * (no Markdown). Used by automation pipelines.
 */
export async function executeAtlassianCliStdinRequest(
  request: AtlassianCliStdinRequest,
  deps: AtlassianCliDeps = defaultCliDeps,
): Promise<void> {
  if (request.tool === "jira_issue" && !request.includeContext) {
    const issue = await deps.getJiraIssueContext({
      key: request.key,
      includeComments: request.includeComments,
      maxComments: request.maxComments,
    });
    deps.write(`${JSON.stringify(issue, null, 2)}\n`);
    return;
  }
  if (request.tool === "jira_issue" && request.includeContext) {
    const ctx = await deps.buildStoryContext({
      key: request.key,
      ...storyOptionsFrom(request),
    });
    deps.write(`${JSON.stringify(ctx, null, 2)}\n`);
    return;
  }
  if (request.tool === "story_context") {
    const ctx = await deps.buildStoryContext({
      key: request.key,
      ...storyOptionsFrom(request),
    });
    deps.write(`${JSON.stringify(ctx, null, 2)}\n`);
    return;
  }
  if (request.tool === "confluence_page") {
    const page = request.pageId
      ? await deps.getConfluencePageContext({
          pageId: request.pageId,
          includeChildPages: request.includeChildPages,
          maxChildPages: request.maxChildPages,
        })
      : await deps.getConfluencePageContext({
          url: request.url!,
          includeChildPages: request.includeChildPages,
          maxChildPages: request.maxChildPages,
        });
    deps.write(`${JSON.stringify(page, null, 2)}\n`);
    return;
  }
  throw new Error(`Unhandled stdin tool: ${(request as { tool: string }).tool}`);
}

function storyOptionsFrom(
  request: AtlassianCliStdinRequest & { tool: "jira_issue" | "story_context" },
): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const k of STORY_BOOL_KEYS) {
    const v = (request as Record<string, unknown>)[k];
    if (typeof v === "boolean") out[k] = v;
  }
  for (const k of STORY_NUMBER_KEYS) {
    const v = (request as Record<string, unknown>)[k];
    if (typeof v === "number") out[k] = v;
  }
  return out;
}

/**
 * Execute a parsed CLI request against the real (or injected) clients
 * and render the result as Markdown to the deps.write sink. Tests inject
 * stubs via `deps`; production calls go through the real Atlassian
 * clients which load credentials from env / config files.
 */
export async function executeAtlassianCliRequest(
  request: Exclude<AtlassianCliRequest, { mode: "stdin" }>,
  deps: AtlassianCliDeps = defaultCliDeps,
): Promise<void> {
  if (request.tool === "jira_issue" && !request.includeContext) {
    const issue = await deps.getJiraIssueContext({ key: request.key });
    deps.write(`${deps.renderJiraIssueMarkdown(issue)}\n`);
    return;
  }
  if (request.tool === "jira_issue" && request.includeContext) {
    const ctx = await deps.buildStoryContext({ key: request.key });
    deps.write(`${deps.renderStoryContextMarkdown(ctx)}\n`);
    return;
  }
  if (request.tool === "story_context") {
    const ctx = await deps.buildStoryContext({ key: request.key });
    deps.write(`${deps.renderStoryContextMarkdown(ctx)}\n`);
    return;
  }
  if (request.tool === "confluence_page") {
    // Numeric strings are page ids; anything else is treated as a URL
    // and parseConfluencePageId extracts the id internally.
    const target = request.target;
    const isNumericId = /^\d+$/.test(target);
    const page = isNumericId
      ? await deps.getConfluencePageContext({ pageId: target })
      : await deps.getConfluencePageContext({ url: target });
    deps.write(`${deps.renderConfluencePageMarkdown(page)}\n`);
    return;
  }
  throw new Error(`Unhandled CLI tool: ${(request as { tool: string }).tool}`);
}

async function main(argv: string[]): Promise<void> {
  const request = parseAtlassianCliArgs(argv);
  if (request.mode === "stdin") {
    const input = await readStdin();
    const parsed: unknown = JSON.parse(input);
    const stdinRequest = parseAtlassianCliStdinRequest(parsed);
    await executeAtlassianCliStdinRequest(stdinRequest);
    return;
  }
  await executeAtlassianCliRequest(request);
}

async function readStdin(): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
