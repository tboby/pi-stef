import type { TruncatedText, WebAccessConfigParams, WebFetchMode, WebOutputFormat } from "../types";
import type { FetchText } from "../search/types";

export interface BrowserFetchPayload {
  contentType?: string;
  finalUrl: string;
  html?: string;
  screenshotPath?: string;
  status?: number;
  text?: string;
  title?: string;
}

export interface BrowserFetchAdapter {
  fetch(options: {
    format: WebOutputFormat;
    screenshot?: boolean;
    selector?: string;
    signal?: AbortSignal;
    url: string;
  }): Promise<BrowserFetchPayload>;
}

export interface FetchWebOptions {
  browser?: BrowserFetchAdapter;
  configParams?: WebAccessConfigParams;
  fetchText?: FetchText;
  format?: WebOutputFormat;
  mode?: WebFetchMode;
  screenshot?: boolean;
  selector?: string;
  signal?: AbortSignal;
  url: string;
}

export interface WebFetchResult {
  challengeDetected: boolean;
  contentType?: string;
  extractor?: string;
  finalUrl: string;
  format: WebOutputFormat;
  modeUsed: "browser" | "fast";
  output: TruncatedText;
  requestedUrl: string;
  screenshotPath?: string;
  status?: number;
  title?: string;
}

export interface ExtractedContent {
  challengeDetected: boolean;
  extractor: string;
  html: string;
  markdown: string;
  text: string;
  title?: string;
}
