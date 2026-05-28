import { parseConfluencePageId } from "../confluence/ConfluenceContext";
import type { ExtractedLinks } from "./extractLinks";
import { jiraKeyFromBrowseUrl, unique } from "./extractLinks";

export interface ResolvedConfluencePageLink {
  url: string;
  pageId?: string;
}

export interface ResolvedAtlassianLinks {
  jiraKeys: string[];
  confluencePages: ResolvedConfluencePageLink[];
  figmaUrls: string[];
  externalUrls: string[];
}

export function resolveAtlassianLinks(links: ExtractedLinks, options: { baseUrl?: string } = {}): ResolvedAtlassianLinks {
  const jiraKeys = [...links.jiraKeysFromText];
  const confluencePages: ResolvedConfluencePageLink[] = [];
  const externalUrls = [...links.externalUrls];

  for (const url of links.jiraUrls) {
    if (!isSameSite(url, options.baseUrl)) {
      externalUrls.push(url);
      continue;
    }
    const key = jiraKeyFromBrowseUrl(url);
    if (key) jiraKeys.push(key);
  }

  for (const url of links.confluenceUrls) {
    if (!isSameSite(url, options.baseUrl)) {
      externalUrls.push(url);
      continue;
    }
    confluencePages.push({ url, pageId: parseConfluencePageId(url) ?? undefined });
  }

  return {
    jiraKeys: unique(jiraKeys),
    confluencePages: dedupeConfluence(confluencePages),
    figmaUrls: unique(links.figmaUrls),
    externalUrls: unique(externalUrls.filter((url) => !links.figmaUrls.includes(url))),
  };
}

function isSameSite(url: string, baseUrl: string | undefined): boolean {
  if (!baseUrl) return true;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function dedupeConfluence(values: ResolvedConfluencePageLink[]): ResolvedConfluencePageLink[] {
  const seen = new Set<string>();
  const result: ResolvedConfluencePageLink[] = [];
  for (const value of values) {
    const key = value.pageId ?? value.url;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
