import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { ensureBinary, launchPersistentContext } from "cloakbrowser";
import { JSDOM } from "jsdom";
import type { LaunchPersistentContextOptions } from "cloakbrowser";

import type { BrowserFetchAdapter, BrowserFetchPayload } from "../fetch";
import type { BrowserSearchAdapter, WebSearchResult } from "../search";
import type { WebAccessConfig } from "../types";
import { createPlaywrightRuntime, type BrowserRuntime } from "./runtime";
import { guardBrowserNavigation } from "./navigation";
import { ensureProfileDir } from "./session";

export interface CloakRuntimeOptions {
  headless?: boolean;
  profile?: string;
}

export async function createCloakBrowserRuntime(
  config: WebAccessConfig,
  options: CloakRuntimeOptions = {},
): Promise<BrowserRuntime> {
  const profile = options.profile ?? "default";
  const userDataDir = await ensureProfileDir(config, profile);
  await ensureBinary();
  const context = await launchPersistentContext(buildCloakBrowserLaunchOptions(config, { ...options, profile, userDataDir }));
  return createPlaywrightRuntime(context, config.fetchTimeoutMs);
}

export function buildCloakBrowserLaunchOptions(
  config: WebAccessConfig,
  options: CloakRuntimeOptions & { profile?: string; userDataDir: string },
): LaunchPersistentContextOptions {
  const profile = options.profile ?? "default";
  return {
    args: [`--fingerprint=${config.browserFingerprintSeed ?? fingerprintSeedForProfile(profile)}`],
    ...(config.browserGeoip !== undefined ? { geoip: config.browserGeoip } : {}),
    headless: options.headless ?? true,
    humanize: true,
    ...(config.browserHumanPreset ? { humanPreset: config.browserHumanPreset } : {}),
    ...(config.browserLocale ? { locale: config.browserLocale } : {}),
    ...(config.browserProxy ? { proxy: config.browserProxy } : {}),
    ...(config.browserTimezone ? { timezone: config.browserTimezone } : {}),
    userDataDir: options.userDataDir,
    viewport: { height: 900, width: 1440 },
  };
}

export function createCloakBrowserFetchAdapter(
  config: WebAccessConfig,
  options: CloakRuntimeOptions = {},
): BrowserFetchAdapter {
  return {
    async fetch(fetchOptions): Promise<BrowserFetchPayload> {
      if (fetchOptions.signal?.aborted) {
        throw new Error("Browser fetch aborted");
      }
      const runtime = await createCloakBrowserRuntime(config, options);
      const abort = () => {
        void runtime.close();
      };
      fetchOptions.signal?.addEventListener("abort", abort, { once: true });
      const page = await runtime.newPage();
      try {
        await page.goto(await guardBrowserNavigation(fetchOptions.url, config));
        const screenshotPath = fetchOptions.screenshot ? await takeScreenshot(page, config.outputDir) : undefined;
        return {
          contentType: "text/html",
          finalUrl: page.url(),
          html: await page.content(),
          screenshotPath,
          status: 200,
          title: await page.title(),
        };
      } finally {
        fetchOptions.signal?.removeEventListener("abort", abort);
        await runtime.close();
      }
    },
  };
}

export function createCloakBrowserSearchAdapter(
  config: WebAccessConfig,
  options: CloakRuntimeOptions = {},
): BrowserSearchAdapter {
  return {
    async search(provider, query, searchOptions): Promise<WebSearchResult[]> {
      if (searchOptions.signal?.aborted) {
        throw new Error("Browser search aborted");
      }
      const runtime = await createCloakBrowserRuntime(config, options);
      const abort = () => {
        void runtime.close();
      };
      searchOptions.signal?.addEventListener("abort", abort, { once: true });
      const page = await runtime.newPage();
      try {
        await page.goto(await guardBrowserNavigation(browserSearchUrl(provider, query), config));
        await sleep(1000);
        return parseBrowserSearchResults(provider, await page.content(), searchOptions.maxResults);
      } finally {
        searchOptions.signal?.removeEventListener("abort", abort);
        await runtime.close();
      }
    },
  };
}

function fingerprintSeedForProfile(profile: string): string {
  const digest = createHash("sha256").update(profile).digest();
  return String((digest.readUInt32BE(0) % 90_000) + 10_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function takeScreenshot(page: Awaited<ReturnType<BrowserRuntime["newPage"]>>, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const screenshotPath = path.join(outputDir, `web-fetch-${randomUUID()}.png`);
  await page.screenshot(screenshotPath);
  return screenshotPath;
}

function browserSearchUrl(provider: "bing" | "google", query: string): string {
  const url = new URL(provider === "google" ? "https://www.google.com/search" : "https://www.bing.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

function parseBrowserSearchResults(provider: "bing" | "google", html: string, maxResults: number): WebSearchResult[] {
  const document = new JSDOM(html).window.document;
  const anchors =
    provider === "bing"
      ? [...document.querySelectorAll<HTMLAnchorElement>("li.b_algo h2 a[href], h2 a[href]")]
      : [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].filter((anchor) => anchor.querySelector("h3"));

  const results: WebSearchResult[] = [];
  for (const anchor of anchors) {
    const url = normalizeBrowserResultUrl(anchor.getAttribute("href") ?? "");
    const title = cleanText(anchor.textContent ?? "");
    if (!url || !title) continue;
    results.push({
      snippet: browserResultSnippet(anchor),
      source: provider,
      title,
      url,
    });
    if (results.length >= maxResults) break;
  }
  return results;
}

function normalizeBrowserResultUrl(href: string): string | undefined {
  try {
    const url = new URL(href, "https://www.google.com/");
    const redirected = url.searchParams.get("q") ?? url.searchParams.get("url");
    const target = redirected && /^https?:\/\//i.test(redirected) ? new URL(redirected) : url;
    if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
    if (target.hostname.endsWith("google.com") && target.pathname === "/search") return undefined;
    target.hash = "";
    return target.toString();
  } catch {
    return undefined;
  }
}

function browserResultSnippet(anchor: HTMLAnchorElement): string | undefined {
  const container = anchor.closest("li, div");
  return cleanText(container?.querySelector(".b_caption p, .VwiC3b, .IsZvec, [data-sncf]")?.textContent ?? "") || undefined;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
