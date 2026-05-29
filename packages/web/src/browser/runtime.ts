import type { BrowserContext, Page } from "playwright-core";

export interface BrowserRuntime {
  close(): Promise<void>;
  newPage(): Promise<BrowserPage>;
}

export interface BrowserPage {
  click(selector: string): Promise<void>;
  content(): Promise<string>;
  fill(selector: string, text: string): Promise<void>;
  goto(url: string): Promise<void>;
  press(selector: string | undefined, key: string): Promise<void>;
  roleClick(role: string, name: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  selectorTexts(selector?: string): Promise<string[]>;
  text(selector?: string): Promise<string>;
  title(): Promise<string>;
  url(): string;
  wait(ms: number): Promise<void>;
}

export function createPlaywrightRuntime(context: BrowserContext, timeoutMs: number): BrowserRuntime {
  return {
    async close() {
      await context.close();
    },
    async newPage() {
      const page = context.pages()[0] ?? (await context.newPage());
      return createPlaywrightPage(page, timeoutMs);
    },
  };
}

function createPlaywrightPage(page: Page, timeoutMs: number): BrowserPage {
  return {
    async click(selector) {
      await page.locator(selector).first().click({ timeout: timeoutMs });
    },
    async content() {
      return page.content();
    },
    async fill(selector, text) {
      await page.locator(selector).first().fill(text, { timeout: timeoutMs });
    },
    async goto(url) {
      await page.goto(url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
    },
    async press(selector, key) {
      if (selector) {
        await page.locator(selector).first().press(key, { timeout: timeoutMs });
        return;
      }
      await page.keyboard.press(key);
    },
    async roleClick(role, name) {
      await page.getByRole(role as never, { name: new RegExp(escapeRegExp(name), "i") }).first().click({ timeout: timeoutMs });
    },
    async screenshot(path) {
      await page.screenshot({ fullPage: true, path, timeout: timeoutMs });
    },
    async selectorTexts(selector = "body") {
      return page.locator(selector).allTextContents();
    },
    async text(selector = "body") {
      return (await page.locator(selector).first().textContent({ timeout: timeoutMs })) ?? "";
    },
    async title() {
      return page.title();
    },
    url() {
      return page.url();
    },
    async wait(ms) {
      await sleep(ms);
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
