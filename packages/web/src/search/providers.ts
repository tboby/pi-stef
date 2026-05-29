import { JSDOM } from "jsdom";

import { redactText } from "../redact";
import type { BrowserSearchAdapter, FetchText, ProviderAttempt, WebSearchResult } from "./types";

export interface ProviderContext {
  browser?: BrowserSearchAdapter;
  fetchText: FetchText;
  maxResults: number;
  query: string;
  searxngUrl?: string;
  signal?: AbortSignal;
}

export async function runProvider(
  provider: string,
  context: ProviderContext,
): Promise<{ attempt: ProviderAttempt; results: WebSearchResult[] }> {
  const started = Date.now();
  try {
    const results = await searchProvider(provider, context);
    const normalized = normalizeResults(results, provider, context.maxResults);
    return {
      attempt: {
        elapsedMs: Date.now() - started,
        ok: true,
        provider,
        resultCount: normalized.length,
      },
      results: normalized,
    };
  } catch (error) {
    return {
      attempt: {
        elapsedMs: Date.now() - started,
        error: redactText(error instanceof Error ? error.message : String(error)),
        ok: false,
        provider,
      },
      results: [],
    };
  }
}

export function normalizeResults(
  results: WebSearchResult[],
  provider: string,
  maxResults: number,
): WebSearchResult[] {
  const seen = new Set<string>();
  const normalized: WebSearchResult[] = [];
  for (const result of results) {
    const title = cleanText(result.title);
    const url = normalizeResultUrl(result.url);
    if (!title || !url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    normalized.push({
      publishedAt: cleanText(result.publishedAt ?? "") || undefined,
      snippet: cleanText(result.snippet ?? "") || undefined,
      source: result.source ?? provider,
      title,
      url,
    });
    if (normalized.length >= maxResults) {
      break;
    }
  }
  return normalized;
}

async function searchProvider(provider: string, context: ProviderContext): Promise<WebSearchResult[]> {
  if (provider === "searxng") {
    return searchSearxngJson(context);
  }
  if (provider === "searxng-html") {
    return searchSearxngHtml(context);
  }
  if (provider === "duckduckgo") {
    return searchDuckDuckGo(context);
  }
  if (provider === "google" || provider === "bing") {
    if (!context.browser) {
      throw new Error(`${provider} browser search requires a browser adapter`);
    }
    return context.browser.search(provider, context.query, { maxResults: context.maxResults, signal: context.signal });
  }
  throw new Error(`Unknown search provider: ${provider}`);
}

async function searchSearxngJson(context: ProviderContext): Promise<WebSearchResult[]> {
  const url = searxngSearchUrl(context, true);
  const response = await context.fetchText(url.toString(), { signal: context.signal });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`SearXNG JSON returned HTTP ${response.status} for ${url}`);
  }
  const parsed = JSON.parse(response.text) as { results?: Array<Record<string, unknown>> };
  return (parsed.results ?? []).map((result) => ({
    publishedAt: stringValue(result.publishedDate ?? result.published_at),
    snippet: stringValue(result.content ?? result.snippet),
    title: stringValue(result.title),
    url: stringValue(result.url),
  }));
}

async function searchSearxngHtml(context: ProviderContext): Promise<WebSearchResult[]> {
  const url = searxngSearchUrl(context, false);
  const response = await context.fetchText(url.toString(), { signal: context.signal });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`SearXNG HTML returned HTTP ${response.status} for ${url}`);
  }
  const document = new JSDOM(response.text).window.document;
  return [...document.querySelectorAll("article.result, .result")]
    .map((node) => {
      const anchor = node.querySelector<HTMLAnchorElement>("h3 a[href], a[href]");
      return {
        snippet: textFrom(node.querySelector(".content, .result-content, p")),
        title: textFrom(anchor),
        url: anchor?.href ?? "",
      };
    })
    .filter((result) => result.title && result.url);
}

async function searchDuckDuckGo(context: ProviderContext): Promise<WebSearchResult[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", context.query);
  const response = await context.fetchText(url.toString(), { signal: context.signal });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`DuckDuckGo returned HTTP ${response.status} for ${url}`);
  }
  const document = new JSDOM(response.text).window.document;
  return [...parseDuckDuckGoResultContainers(document), ...parseDuckDuckGoLiteRows(document)]
    .filter((result) => result.title && result.url);
}

function parseDuckDuckGoResultContainers(document: Document): WebSearchResult[] {
  return [...document.querySelectorAll(".result, .web-result")].map((node) => {
    const anchor = node.querySelector<HTMLAnchorElement>("a.result__a[href], a.result-link[href], a[href]");
    return {
      snippet: textFrom(node.querySelector(".result__snippet, .result-snippet, .snippet")),
      title: textFrom(anchor),
      url: normalizeDuckDuckGoUrl(anchor?.getAttribute("href") ?? ""),
    };
  });
}

function parseDuckDuckGoLiteRows(document: Document): WebSearchResult[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a.result-link[href], tr.result-link a[href]")]
    .filter((anchor) => !anchor.closest(".result, .web-result"))
    .map((anchor) => {
      const row = anchor.closest("tr");
      const snippetRow = row?.nextElementSibling;
      return {
        snippet: textFrom(snippetRow?.querySelector(".result-snippet, .snippet") ?? snippetRow),
        title: textFrom(anchor),
        url: normalizeDuckDuckGoUrl(anchor.getAttribute("href") ?? ""),
      };
    });
}

function searxngSearchUrl(context: ProviderContext, json: boolean): URL {
  if (!context.searxngUrl) {
    throw new Error("SearXNG URL is not configured");
  }
  const url = new URL("search", ensureTrailingSlash(context.searxngUrl));
  url.searchParams.set("q", context.query);
  if (json) {
    url.searchParams.set("format", "json");
  }
  return url;
}

function normalizeDuckDuckGoUrl(href: string): string {
  if (!href) return "";
  const absolute = href.startsWith("//") ? `https:${href}` : href.startsWith("/") ? `https://duckduckgo.com${href}` : href;
  try {
    const url = new URL(absolute);
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return "";
  }
}

function normalizeResultUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textFrom(node: Element | null | undefined): string {
  return cleanText(node?.textContent ?? "");
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
