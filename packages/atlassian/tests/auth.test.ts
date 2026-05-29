import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AtlassianAuth } from "../src/auth/AtlassianAuth";

const ORIGINAL_ENV = { ...process.env };
let homeDir = "";
let cwdDir = "";

beforeEach(async () => {
  homeDir = await fsTemp("fh-atlassian-home-");
  cwdDir = await fsTemp("fh-atlassian-cwd-");
  vi.spyOn(os, "homedir").mockReturnValue(homeDir);
  vi.spyOn(process, "cwd").mockReturnValue(cwdDir);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ATLASSIAN_BASE_URL;
  delete process.env.ATLASSIAN_DOMAIN;
  delete process.env.ATLASSIAN_EMAIL;
  delete process.env.ATLASSIAN_API_TOKEN;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
  await rm(homeDir, { force: true, recursive: true });
  await rm(cwdDir, { force: true, recursive: true });
});

describe("AtlassianAuth", () => {
  it("uses complete env config before files and normalizes trailing slashes", async () => {
    await writeConfig(".pi/sf/atlassian/config.json", {
      baseUrl: "https://file.atlassian.net",
      email: "file@example.com",
      apiToken: "file-token",
    });
    process.env.ATLASSIAN_BASE_URL = "https://env.atlassian.net/";
    process.env.ATLASSIAN_EMAIL = "env@example.com";
    process.env.ATLASSIAN_API_TOKEN = "env-token";

    expect(new AtlassianAuth().getConfig()).toEqual({
      baseUrl: "https://env.atlassian.net",
      email: "env@example.com",
      apiToken: "env-token",
    });
  });

  it("accepts ATLASSIAN_DOMAIN and converts it to a base URL", () => {
    process.env.ATLASSIAN_DOMAIN = "example.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "domain@example.com";
    process.env.ATLASSIAN_API_TOKEN = "domain-token";

    expect(new AtlassianAuth().getConfig().baseUrl).toBe("https://example.atlassian.net");
  });

  it("fails on partial Atlassian env instead of falling back to files", async () => {
    await writeConfig(".pi/sf/atlassian/config.json", {
      baseUrl: "https://file.atlassian.net",
      email: "file@example.com",
      apiToken: "file-token",
    });
    process.env.ATLASSIAN_API_TOKEN = "partial-token";

    expect(() => new AtlassianAuth().getConfig()).toThrow(/incomplete atlassian environment/i);
  });

  it("fails fast when ~/.pi/sf/atlassian/config.json is malformed", async () => {
    const cfgDir = path.join(homeDir, ".pi", "sf", "atlassian");
    await mkdir(cfgDir, { recursive: true });
    await writeFile(path.join(cfgDir, "config.json"), "{not-json");
    expect(() => new AtlassianAuth().getConfig()).toThrow(/failed to read atlassian config/i);
  });

  it("reads config from ~/.pi/sf/atlassian/config.json", async () => {
    await writeConfig(".pi/sf/atlassian/config.json", {
      baseUrl: "https://pi.atlassian.net",
      email: "pi@example.com",
      apiToken: "pi-token",
    });

    expect(new AtlassianAuth().getConfig()).toEqual({
      baseUrl: "https://pi.atlassian.net",
      email: "pi@example.com",
      apiToken: "pi-token",
    });
  });

  it("builds a Basic auth header", () => {
    process.env.ATLASSIAN_DOMAIN = "example.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@example.com";
    process.env.ATLASSIAN_API_TOKEN = "secret";

    expect(new AtlassianAuth().getAuthHeader()).toBe(
      `Basic ${Buffer.from("me@example.com:secret").toString("base64")}`,
    );
  });
});

async function fsTemp(prefix: string): Promise<string> {
  return await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function writeConfig(relativePath: string, value: unknown): Promise<void> {
  const filePath = path.join(homeDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
