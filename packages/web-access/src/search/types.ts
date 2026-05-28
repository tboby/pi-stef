import type { WebSearchProviderName } from "../types";

export interface WebSearchResult {
  publishedAt?: string;
  snippet?: string;
  source?: string;
  title: string;
  url: string;
}

export interface ProviderAttempt {
  elapsedMs: number;
  error?: string;
  ok: boolean;
  provider: string;
  resultCount?: number;
}

export interface WebSearchResponse {
  attempts: ProviderAttempt[];
  query: string;
  results: WebSearchResult[];
}

export interface FetchTextResponse {
  contentType?: string;
  status: number;
  text: string;
  url: string;
}

export type FetchText = (url: string, options?: { signal?: AbortSignal }) => Promise<FetchTextResponse>;

export interface BrowserSearchAdapter {
  search(
    provider: "bing" | "google",
    query: string,
    options: { maxResults: number; signal?: AbortSignal },
  ): Promise<WebSearchResult[]>;
}
