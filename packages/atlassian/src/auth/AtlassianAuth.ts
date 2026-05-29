import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { globalConfig } from "@pi-stef/paths";
import { z } from "zod";

const FileConfigSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    domain: z.string().min(1).optional(),
    email: z.string().email(),
    apiToken: z.string().min(1),
  })
  .refine((value) => Boolean(value.baseUrl ?? value.domain), {
    message: "Atlassian config requires baseUrl or domain",
  });

export const AtlassianConfigSchema = z.object({
  baseUrl: z.string().url(),
  email: z.string().email(),
  apiToken: z.string().min(1),
});

export type AtlassianConfig = z.infer<typeof AtlassianConfigSchema>;

const ENV_KEYS = [
  "ATLASSIAN_BASE_URL",
  "ATLASSIAN_DOMAIN",
  "ATLASSIAN_EMAIL",
  "ATLASSIAN_API_TOKEN",
] as const;

export class AtlassianAuth {
  private config: AtlassianConfig | null = null;

  getConfig(): AtlassianConfig {
    if (this.config) return this.config;

    const envConfig = this.readFromEnv();
    if (envConfig) {
      this.config = envConfig;
      return envConfig;
    }

    const fileConfig = this.readFromFirstConfigFile();
    if (fileConfig) {
      this.config = fileConfig;
      return fileConfig;
    }

    throw new Error(
      "Atlassian credentials not found. Set ATLASSIAN_BASE_URL or ATLASSIAN_DOMAIN, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN, or create an Atlassian config file.",
    );
  }

  getAuthHeader(): string {
    const { email, apiToken } = this.getConfig();
    return `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }

  private readFromEnv(): AtlassianConfig | null {
    const presentKeys = ENV_KEYS.filter((key) => Boolean(process.env[key]));
    if (presentKeys.length === 0) return null;

    const baseUrlOrDomain = process.env.ATLASSIAN_BASE_URL ?? process.env.ATLASSIAN_DOMAIN;
    const email = process.env.ATLASSIAN_EMAIL;
    const apiToken = process.env.ATLASSIAN_API_TOKEN;
    if (!baseUrlOrDomain || !email || !apiToken) {
      throw new Error(
        `Incomplete Atlassian environment configuration. Provide ${ENV_KEYS.join(", ")} with either ATLASSIAN_BASE_URL or ATLASSIAN_DOMAIN.`,
      );
    }

    return this.parseNormalized({
      baseUrl: normalizeBaseUrl(baseUrlOrDomain),
      email,
      apiToken,
    });
  }

  private readFromFirstConfigFile(): AtlassianConfig | null {
    for (const configPath of this.configPaths()) {
      if (!fs.existsSync(configPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
        const parsed = FileConfigSchema.parse(raw);
        return this.parseNormalized({
          baseUrl: normalizeBaseUrl(parsed.baseUrl ?? parsed.domain ?? ""),
          email: parsed.email,
          apiToken: parsed.apiToken,
        });
      } catch (error) {
        throw new Error(`Failed to read Atlassian config at ${configPath}: ${formatError(error)}`);
      }
    }

    return null;
  }

  private configPaths(): string[] {
    return [
      globalConfig("atlassian"),
    ];
  }

  private parseNormalized(value: AtlassianConfig): AtlassianConfig {
    return AtlassianConfigSchema.parse(value);
  }
}

export function normalizeBaseUrl(baseUrlOrDomain: string): string {
  const trimmed = baseUrlOrDomain.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
