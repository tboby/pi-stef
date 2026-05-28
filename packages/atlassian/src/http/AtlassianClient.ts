import { AtlassianAuth } from "../auth/AtlassianAuth";
import type { AtlassianConfig } from "../auth/AtlassianAuth";
import { AtlassianApiError } from "./errors";

export type QueryValue = string | number | boolean | string[] | number[] | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, QueryValue>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AtlassianAuthLike {
  getConfig(): AtlassianConfig;
  getAuthHeader(): string;
}

const MAX_ERROR_BODY_LENGTH = 500;

export class AtlassianClient {
  constructor(
    private readonly auth: AtlassianAuthLike = new AtlassianAuth(),
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get baseUrl(): string {
    return this.auth.getConfig().baseUrl;
  }

  async get<T>(pathOrUrl: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(pathOrUrl, { ...options, method: "GET" });
  }

  async post<T>(pathOrUrl: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(pathOrUrl, { ...options, method: "POST", body });
  }

  async put<T>(pathOrUrl: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(pathOrUrl, { ...options, method: "PUT", body });
  }

  async delete<T = void>(pathOrUrl: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(pathOrUrl, { ...options, method: "DELETE" });
  }

  async getBuffer(pathOrUrl: string, options: Omit<RequestOptions, "method" | "body"> = {}): Promise<ArrayBuffer> {
    const response = await this.raw(pathOrUrl, { ...options, method: "GET" });
    return response.arrayBuffer();
  }

  async request<T>(pathOrUrl: string, options: RequestOptions): Promise<T> {
    const response = await this.raw(pathOrUrl, options);

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text.trim()) return undefined as T;

    const contentType = response.headers.get("content-type") ?? "";
    return (contentType.includes("application/json") ? JSON.parse(text) : text) as T;
  }

  private async raw(pathOrUrl: string, options: RequestOptions): Promise<Response> {
    const method = options.method ?? "GET";
    const url = this.resolveUrl(pathOrUrl, options.query);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.auth.getAuthHeader(),
      ...options.headers,
    };
    const init: RequestInit = {
      method,
      headers,
      signal: options.signal,
    };

    if (options.body !== undefined) {
      headers["Content-Type"] ??= "application/json";
      init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url, init);
    if (!response.ok) {
      const responseText = trimErrorBody(await response.text().catch(() => ""));
      throw new AtlassianApiError(
        `Atlassian API error ${response.status} ${response.statusText} for ${method} ${pathOrUrl}`,
        response.status,
        response.statusText,
        method,
        pathOrUrl,
        responseText,
      );
    }

    return response;
  }

  private resolveUrl(pathOrUrl: string, query?: Record<string, QueryValue>): string {
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(`${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`, this.baseUrl);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

function trimErrorBody(value: string): string {
  if (value.length <= MAX_ERROR_BODY_LENGTH) return value;
  return `${value.slice(0, MAX_ERROR_BODY_LENGTH)}...`;
}
