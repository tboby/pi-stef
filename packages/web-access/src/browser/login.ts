import type { BrowserRuntime } from "./runtime";

const USERNAME_SELECTOR =
  'input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i], input[autocomplete="username"], input[type="text"]';
const PASSWORD_SELECTOR =
  'input[type="password"], input[name*="password" i], input[id*="password" i], input[autocomplete="current-password"]';
const SUBMIT_SELECTOR =
  'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Submit")';

export interface WebLoginOptions {
  env?: Record<string, string | undefined>;
  guardNavigation?: (url: string) => Promise<string> | string;
  interactive?: boolean;
  interactiveWaitMs?: number;
  passwordEnv?: string;
  runtime: BrowserRuntime;
  signal?: AbortSignal;
  url: string;
  usernameEnv?: string;
}

export interface WebLoginResult {
  finalUrl: string;
  interactive: boolean;
  message: string;
  success: boolean;
}

export async function runWebLogin(options: WebLoginOptions): Promise<WebLoginResult> {
  const page = await options.runtime.newPage();
  let abort: (() => void) | undefined;
  try {
    if (options.signal?.aborted) throw new Error("Browser login aborted");
    abort = () => {
      void options.runtime.close();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    await page.goto(await guardNavigation(options.url, options.guardNavigation));
    if (options.interactive) {
      await page.wait(options.interactiveWaitMs ?? 120_000);
      const success = !looksLikeLoginPage(await page.content());
      return {
        finalUrl: page.url(),
        interactive: true,
        message: success
          ? "Interactive login wait completed and login form was not detected."
          : "Interactive login wait completed but login success was not verified.",
        success,
      };
    }

    const credentials = credentialsFromEnv(options.env ?? process.env, options.usernameEnv, options.passwordEnv);
    await page.fill(USERNAME_SELECTOR, credentials.username);
    await page.fill(PASSWORD_SELECTOR, credentials.password);
    await page.click(SUBMIT_SELECTOR);
    await page.wait(1000);
    const success = !looksLikeLoginPage(await page.content());
    return {
      finalUrl: page.url(),
      interactive: false,
      message: success
        ? "Login submitted using credential environment variables; session profile updated."
        : "Login submitted using credential environment variables but success was not verified.",
      success,
    };
  } finally {
    if (abort) options.signal?.removeEventListener("abort", abort);
    await options.runtime.close();
  }
}

async function guardNavigation(url: string, guard: WebLoginOptions["guardNavigation"]): Promise<string> {
  return guard ? guard(url) : url;
}

function looksLikeLoginPage(html: string): boolean {
  return /<input[^>]+type=["']?password/i.test(html) || /(login-error|invalid password|incorrect password|try again)/i.test(html);
}

function credentialsFromEnv(
  env: Record<string, string | undefined>,
  usernameEnv = "FH_WEB_USERNAME",
  passwordEnv = "FH_WEB_PASSWORD",
): { password: string; username: string } {
  const username = env[usernameEnv];
  const password = env[passwordEnv];
  if (!username || !password) {
    throw new Error(`Login credentials are required via env names ${usernameEnv} and ${passwordEnv}`);
  }
  return { password, username };
}
