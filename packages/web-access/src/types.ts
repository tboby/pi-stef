export type WebSearchProviderName = "bing" | "duckduckgo" | "google" | "searxng" | "searxng-html";
export type WebFetchMode = "auto" | "browser" | "fast";
export type WebOutputFormat = "html" | "json" | "markdown" | "raw" | "text";
export type WebBrowserHumanPreset = "careful" | "default";

export interface WebAccessConfig {
  allowPrivateNetworks: boolean;
  browserFingerprintSeed?: string;
  browserGeoip?: boolean;
  browserHumanPreset?: WebBrowserHumanPreset;
  browserLocale?: string;
  browserProxy?: string;
  browserTimezone?: string;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  maxBytes: number;
  maxLines: number;
  maxResults: number;
  outputDir: string;
  profilesDir: string;
  searchProviders: WebSearchProviderName[];
  searxngUrl?: string;
  sensitiveQueryKeys: string[];
  userAgent: string;
}

export interface WebAccessConfigParams {
  allowPrivateNetworks?: boolean;
  browserFingerprintSeed?: string;
  browserGeoip?: boolean;
  browserHumanPreset?: WebBrowserHumanPreset;
  browserLocale?: string;
  browserProxy?: string;
  browserTimezone?: string;
  fetchMaxBytes?: number;
  fetchTimeoutMs?: number;
  maxBytes?: number;
  maxLines?: number;
  maxResults?: number;
  outputDir?: string;
  profilesDir?: string;
  searchProviders?: WebSearchProviderName[];
  searxngUrl?: string;
  sensitiveQueryKeys?: string[];
  userAgent?: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface TruncatedText {
  fullOutputPath?: string;
  originalBytes: number;
  returnedBytes: number;
  text: string;
  truncated: boolean;
}
