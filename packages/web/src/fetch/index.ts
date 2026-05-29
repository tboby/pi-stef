import { loadWebAccessConfig } from "../config";
import { createTextOutput } from "../output";
import type { WebAccessConfig, WebFetchMode, WebOutputFormat } from "../types";
import { fetchGuardedText } from "./httpFetch";
import { detectChallengeText, extractHtmlContent } from "./extract";
import type { BrowserFetchAdapter, BrowserFetchPayload, FetchWebOptions, WebFetchResult } from "./types";

const DEFAULT_FORMAT: WebOutputFormat = "markdown";
const DEFAULT_MODE: WebFetchMode = "auto";

export async function fetchWeb(options: FetchWebOptions): Promise<WebFetchResult> {
  const config = await loadWebAccessConfig(options.configParams);
  const format = options.format ?? DEFAULT_FORMAT;
  const mode = options.mode ?? DEFAULT_MODE;

  if (mode === "browser") {
    return fetchWithBrowser(options.url, options.browser, {
      config,
      format,
      screenshot: options.screenshot,
      selector: options.selector,
      signal: options.signal,
    });
  }

  const fetchText = options.fetchText ?? ((url, fetchOptions) => fetchGuardedText(url, { config, signal: fetchOptions?.signal }));
  const fastResponse = await fetchText(options.url, { signal: options.signal });
  if (fastResponse.status < 200 || fastResponse.status >= 300) {
    if (mode === "auto" && options.browser && shouldUseBrowserFallback(fastResponse.status, fastResponse.text)) {
      return fetchWithBrowser(options.url, options.browser, {
        challengeDetected: detectChallengeText(fastResponse.text),
        config,
        format,
        screenshot: options.screenshot,
        selector: options.selector,
        signal: options.signal,
      });
    }
    throw new Error(`Fetch returned HTTP ${fastResponse.status} for ${fastResponse.url}`);
  }

  const fastChallengeDetected = detectChallengeText(fastResponse.text);
  if (mode === "auto" && fastChallengeDetected && options.browser) {
    return fetchWithBrowser(options.url, options.browser, {
      challengeDetected: true,
      config,
      format,
      screenshot: options.screenshot,
      selector: options.selector,
      signal: options.signal,
    });
  }

  return renderFetchedBody({
    challengeDetected: fastChallengeDetected,
    config,
    contentType: fastResponse.contentType,
    finalUrl: fastResponse.url,
    format,
    modeUsed: "fast",
    requestedUrl: options.url,
    selector: options.selector,
    status: fastResponse.status,
    text: fastResponse.text,
  });
}

function shouldUseBrowserFallback(status: number, text: string): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500 || detectChallengeText(text);
}

export function renderFetchResult(result: WebFetchResult): string {
  const lines = [
    `# Web fetch: ${result.title ?? result.finalUrl}`,
    "",
    `- URL: ${result.finalUrl}`,
    `- Mode: ${result.modeUsed}`,
    `- Status: ${result.status ?? "unknown"}`,
    `- Content type: ${result.contentType ?? "unknown"}`,
  ];
  if (result.extractor) {
    lines.push(`- Extractor: ${result.extractor}`);
  }
  if (result.challengeDetected) {
    lines.push("- Challenge or JavaScript shell detected");
  }
  if (result.screenshotPath) {
    lines.push(`- Screenshot: ${result.screenshotPath}`);
  }
  if (result.output.fullOutputPath) {
    lines.push(`- Full output: ${result.output.fullOutputPath}`);
  }
  lines.push("", result.output.text);
  return lines.join("\n");
}

async function fetchWithBrowser(
  url: string,
  browser: BrowserFetchAdapter | undefined,
  options: {
    challengeDetected?: boolean;
    config: WebAccessConfig;
    format: WebOutputFormat;
    screenshot?: boolean;
    selector?: string;
    signal?: AbortSignal;
  },
): Promise<WebFetchResult> {
  if (!browser) {
    throw new Error("Browser mode requires a browser adapter");
  }

  const payload = await browser.fetch({
    format: options.format,
    screenshot: options.screenshot,
    selector: options.selector,
    signal: options.signal,
    url,
  });

  return renderBrowserPayload(url, payload, options);
}

async function renderBrowserPayload(
  requestedUrl: string,
  payload: BrowserFetchPayload,
  options: {
    challengeDetected?: boolean;
    config: WebAccessConfig;
    format: WebOutputFormat;
    selector?: string;
  },
): Promise<WebFetchResult> {
  const body = payload.html ?? payload.text ?? "";
  const contentType = payload.contentType ?? (payload.html ? "text/html" : "text/plain");
  return renderFetchedBody({
    challengeDetected: options.challengeDetected ?? detectChallengeText(body),
    config: options.config,
    contentType,
    finalUrl: payload.finalUrl,
    format: options.format,
    modeUsed: "browser",
    requestedUrl,
    screenshotPath: payload.screenshotPath,
    selector: options.selector,
    status: payload.status,
    text: body,
    title: payload.title,
  });
}

async function renderFetchedBody(options: {
  challengeDetected: boolean;
  config: WebAccessConfig;
  contentType?: string;
  finalUrl: string;
  format: WebOutputFormat;
  modeUsed: "browser" | "fast";
  requestedUrl: string;
  screenshotPath?: string;
  selector?: string;
  status?: number;
  text: string;
  title?: string;
}): Promise<WebFetchResult> {
  const normalizedContentType = normalizeContentType(options.contentType);
  const extracted = await extractByContentType({
    contentType: normalizedContentType,
    format: options.format,
    selector: options.selector,
    text: options.text,
    url: options.finalUrl,
  });
  const rendered = renderContentForFormat({
    contentType: normalizedContentType,
    extracted,
    finalUrl: options.finalUrl,
    format: options.format,
    status: options.status,
    text: options.text,
  });
  const output = await createTextOutput(rendered, {
    filePrefix: "web-fetch",
    maxBytes: options.config.maxBytes,
    maxLines: options.config.maxLines,
    outputDir: options.config.outputDir,
  });

  return {
    challengeDetected: options.challengeDetected || extracted.challengeDetected,
    contentType: normalizedContentType,
    extractor: extracted.extractor,
    finalUrl: options.finalUrl,
    format: options.format,
    modeUsed: options.modeUsed,
    output,
    requestedUrl: options.requestedUrl,
    screenshotPath: options.screenshotPath,
    status: options.status,
    title: options.title ?? extracted.title,
  };
}

async function extractByContentType(options: {
  contentType?: string;
  format: WebOutputFormat;
  selector?: string;
  text: string;
  url: string;
}) {
  if (isHtml(options.contentType)) {
    return extractHtmlContent({ html: options.text, selector: options.selector, url: options.url });
  }
  return {
    challengeDetected: detectChallengeText(options.text),
    extractor: isJson(options.contentType) ? "json" : isText(options.contentType) ? "text" : "raw",
    html: "",
    markdown: options.text,
    text: options.text,
    title: undefined,
  };
}

function renderContentForFormat(options: {
  contentType?: string;
  extracted: Awaited<ReturnType<typeof extractByContentType>>;
  finalUrl: string;
  format: WebOutputFormat;
  status?: number;
  text: string;
}): string {
  if (options.format === "raw") {
    return options.text;
  }
  if (options.format === "html") {
    return options.extracted.html || options.text;
  }
  if (options.format === "text") {
    return options.extracted.text;
  }
  if (options.format === "json") {
    return JSON.stringify(
      {
        content: parseJsonContent(options.text, options.contentType),
        contentType: options.contentType,
        extractor: options.extracted.extractor,
        finalUrl: options.finalUrl,
        status: options.status,
        title: options.extracted.title,
      },
      null,
      2,
    );
  }
  return options.extracted.markdown;
}

function parseJsonContent(text: string, contentType?: string): unknown {
  if (!isJson(contentType)) {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeContentType(value: string | undefined): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase();
}

function isHtml(contentType: string | undefined): boolean {
  return contentType === undefined || contentType === "text/html" || contentType.endsWith("+html");
}

function isJson(contentType: string | undefined): boolean {
  return contentType === "application/json" || contentType?.endsWith("+json") === true;
}

function isText(contentType: string | undefined): boolean {
  return contentType?.startsWith("text/") === true;
}

export type { BrowserFetchAdapter, BrowserFetchPayload, FetchWebOptions, WebFetchResult };
