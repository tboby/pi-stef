import { ConfluenceClient } from "./ConfluenceClient";
import { extractLinks, type ExtractedLinks } from "../links/extractLinks";

export interface ConfluencePageOptions {
  url?: string;
  pageId?: string;
  includeChildPages?: boolean;
  maxChildPages?: number;
  signal?: AbortSignal;
}

export interface ConfluencePageContext {
  id: string;
  title: string;
  url: string;
  spaceId?: string;
  version?: number;
  updatedAt?: string;
  markdown: string;
  headings: string[];
  links: ExtractedLinks;
  childPages: ConfluencePageReference[];
}

export interface ConfluencePageReference {
  id: string;
  title: string;
  url: string;
}

interface ConfluenceContextClient {
  getPage(params: { pageId: string; bodyFormat?: "storage"; includeVersion?: boolean; signal?: AbortSignal }): Promise<unknown>;
  getPageChildren(params: { pageId: string; limit?: number; signal?: AbortSignal }): Promise<unknown>;
}

export async function getConfluencePageContext(
  options: ConfluencePageOptions,
  client: ConfluenceContextClient = new ConfluenceClient(),
): Promise<ConfluencePageContext> {
  const pageId = options.pageId ?? parseConfluencePageId(options.url);
  if (!pageId) throw new Error("Confluence pageId is required. Pass pageId or a URL containing a page ID.");

  const page = asRecord(await client.getPage({ pageId, bodyFormat: "storage", includeVersion: true, signal: options.signal }));
  const id = getString(page.id) || pageId;
  const title = getString(page.title) || id;
  const html = getString(asRecord(asRecord(page.body).storage).value);
  const markdown = htmlToMarkdown(html);
  const url = pageUrl(page, options.url, id);
  const children = options.includeChildPages
    ? await childPages(id, options.maxChildPages ?? 10, client, options.signal)
    : [];

  return {
    id,
    title,
    url,
    spaceId: getString(page.spaceId) || undefined,
    version: getNumber(asRecord(page.version).number),
    updatedAt: getString(asRecord(page.version).createdAt) || getString(asRecord(page.version).when) || undefined,
    markdown,
    headings: extractHeadings(markdown),
    links: extractLinks(`${title}\n${markdown}`),
    childPages: children,
  };
}

export function parseConfluencePageId(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  if (/^\d+$/.test(urlOrId)) return urlOrId;
  const decoded = decodeURIComponent(urlOrId);
  const patterns = [/[?&]pageId=(\d+)/, /\/pages\/(\d+)/, /\/spaces\/[^/]+\/pages\/(\d+)/];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function renderConfluencePageMarkdown(page: ConfluencePageContext): string {
  const lines = [
    `# ${page.title}`,
    "",
    `- URL: ${page.url}`,
    page.spaceId ? `- Space ID: ${page.spaceId}` : undefined,
    page.version ? `- Version: ${page.version}` : undefined,
    page.updatedAt ? `- Updated: ${page.updatedAt}` : undefined,
  ].filter((line): line is string => Boolean(line));

  if (page.childPages.length) {
    lines.push("", "## Child Pages", ...page.childPages.map((child) => `- ${child.title} (${child.id}): ${child.url}`));
  }
  if (page.headings.length) lines.push("", "## Headings", ...page.headings.map((heading) => `- ${heading}`));
  if (page.links.figmaUrls.length) lines.push("", "## Figma Links", ...page.links.figmaUrls.map((url) => `- ${url}`));
  if (page.links.jiraKeys.length) lines.push("", "## Jira Keys", ...page.links.jiraKeys.map((key) => `- ${key}`));
  if (page.markdown) lines.push("", "## Content", "", page.markdown);

  return `${lines.join("\n")}\n`;
}

async function childPages(
  pageId: string,
  limit: number,
  client: ConfluenceContextClient,
  signal?: AbortSignal,
): Promise<ConfluencePageReference[]> {
  const response = asRecord(await client.getPageChildren({ pageId, limit, signal }));
  const results = Array.isArray(response.results) ? response.results : [];
  return results.map((value) => {
    const page = asRecord(value);
    const id = getString(page.id);
    return {
      id,
      title: getString(page.title) || id,
      url: pageUrl(page, undefined, id),
    };
  });
}

function pageUrl(page: Record<string, unknown>, fallback: string | undefined, id: string): string {
  const links = asRecord(page._links);
  const webui = getString(links.webui);
  const base = getString(links.base);
  if (base && webui) return `${base}${webui}`;
  return fallback ?? `/wiki/pages/${id}`;
}

// Compact context intentionally uses a lossy HTML reduction; preserve links before stripping tags.
function htmlToMarkdown(html: string): string {
  return html
    .replace(/<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis, (_match, _quote: string, href: string, content: string) => {
      const label = decodeHtml(stripTags(content)) || decodeHtml(href);
      return `[${label}](${decodeHtml(href)})`;
    })
    .replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gis, (_match, level: string, content: string) => `${"#".repeat(Number(level))} ${stripTags(content)}\n\n`)
    .replace(/<li[^>]*>(.*?)<\/li>/gis, (_match, content: string) => `- ${stripTags(content)}\n`)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
