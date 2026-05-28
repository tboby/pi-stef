export interface ExtractedLinks {
  urls: string[];
  figmaUrls: string[];
  confluenceUrls: string[];
  jiraUrls: string[];
  jiraKeys: string[];
  jiraKeysFromText: string[];
  jiraKeysFromUrls: string[];
  externalUrls: string[];
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const JIRA_BROWSE_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)\b/;
const HTML_HREF_RE = /href\s*=\s*(["'])(.*?)\1/gi;

export function extractLinks(value: unknown): ExtractedLinks {
  const corpus: string[] = [];
  collectLinkText(value, corpus, new WeakSet<object>());
  const text = corpus.join("\n");
  const urls = unique((text.match(URL_RE) ?? []).map(trimUrl));
  const jiraKeysFromText = unique((text.replace(URL_RE, " ").match(JIRA_KEY_RE) ?? []));
  const jiraKeysFromUrls = unique(urls.flatMap((url) => jiraKeyFromBrowseUrl(url) ?? []));
  const jiraKeys = unique([...jiraKeysFromText, ...jiraKeysFromUrls]);
  const figmaUrls = urls.filter((url) => url.includes("figma.com"));
  const confluenceUrls = urls.filter((url) => url.includes("/wiki/"));
  const jiraUrls = urls.filter((url) => JIRA_BROWSE_RE.test(url));

  return {
    urls,
    figmaUrls,
    confluenceUrls,
    jiraUrls,
    jiraKeys,
    jiraKeysFromText,
    jiraKeysFromUrls,
    externalUrls: urls.filter((url) => !figmaUrls.includes(url) && !confluenceUrls.includes(url) && !jiraUrls.includes(url)),
  };
}

export function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function jiraKeyFromBrowseUrl(url: string): string | undefined {
  return url.match(JIRA_BROWSE_RE)?.[1];
}

function collectLinkText(value: unknown, corpus: string[], seen: WeakSet<object>): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    corpus.push(value);
    collectHtmlHrefs(value, corpus);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    corpus.push(String(value));
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectLinkText(item, corpus, seen);
    return;
  }

  const record = value as Record<string, unknown>;
  const attrs = isRecord(record.attrs) ? record.attrs : {};
  const href = attrs.href;
  const url = attrs.url;
  if (typeof href === "string") corpus.push(href);
  if (typeof url === "string") corpus.push(url);

  for (const item of Object.values(record)) collectLinkText(item, corpus, seen);
}

function collectHtmlHrefs(value: string, corpus: string[]): void {
  for (const match of value.matchAll(HTML_HREF_RE)) {
    if (match[2]) corpus.push(decodeHtml(match[2]));
  }
}

function trimUrl(value: string): string {
  let url = decodeHtml(value);
  while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
  while (/[)\]}]$/.test(url)) url = url.slice(0, -1);
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
