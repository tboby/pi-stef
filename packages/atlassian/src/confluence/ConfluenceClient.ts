import { AtlassianClient } from "../http/AtlassianClient";

export type ConfluenceBodyFormat = "storage" | "atlas_doc_format" | "view" | "export_view" | "anonymous_export_view";

interface ConfluenceHttp {
  get<T>(path: string, options?: { query?: Record<string, unknown>; signal?: AbortSignal }): Promise<T>;
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
  put<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
  delete<T>(path: string, options?: { query?: Record<string, unknown>; signal?: AbortSignal }): Promise<T>;
}

export class ConfluenceClient {
  constructor(private readonly http: ConfluenceHttp = new AtlassianClient()) {}

  async listSpaces(params: { limit?: number; cursor?: string; keys?: string[]; ids?: string[]; status?: string[]; signal?: AbortSignal } = {}): Promise<unknown> {
    const { signal, ...query } = params;
    return this.http.get("/wiki/api/v2/spaces", { query, signal });
  }

  async listPages(params: { spaceId?: string; limit?: number; cursor?: string; status?: string; title?: string; bodyFormat?: ConfluenceBodyFormat; signal?: AbortSignal } = {}): Promise<unknown> {
    const { spaceId, bodyFormat, signal, ...rest } = params;
    return this.http.get("/wiki/api/v2/pages", {
      query: {
        ...rest,
        "space-id": spaceId,
        "body-format": bodyFormat,
      },
      signal,
    });
  }

  async getPage(params: { pageId: string; bodyFormat?: ConfluenceBodyFormat; includeLabels?: boolean; includeVersion?: boolean; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, bodyFormat, includeLabels, includeVersion, signal } = params;
    return this.http.get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, {
      query: {
        "body-format": bodyFormat,
        "include-labels": includeLabels,
        "include-version": includeVersion,
      },
      signal,
    });
  }

  async createPage(params: { spaceId: string; title: string; body: string; parentId?: string; bodyRepresentation?: "storage" | "atlas_doc_format"; signal?: AbortSignal }): Promise<unknown> {
    const { spaceId, title, body, parentId, bodyRepresentation = "storage", signal } = params;
    return this.http.post(
      "/wiki/api/v2/pages",
      {
        spaceId,
        status: "current",
        title,
        body: { representation: bodyRepresentation, value: body },
        ...(parentId ? { parentId } : {}),
      },
      { signal },
    );
  }

  async updatePage(params: { pageId: string; title: string; body: string; version: number; bodyRepresentation?: "storage" | "atlas_doc_format"; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, title, body, version, bodyRepresentation = "storage", signal } = params;
    return this.http.put(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
      {
        id: pageId,
        status: "current",
        title,
        body: { representation: bodyRepresentation, value: body },
        version: { number: version + 1 },
      },
      { signal },
    );
  }

  async deletePage(params: { pageId: string; purge?: boolean; signal?: AbortSignal }): Promise<void> {
    const { pageId, purge, signal } = params;
    await this.http.delete(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}`, { query: { purge }, signal });
  }

  async getPageChildren(params: { pageId: string; limit?: number; cursor?: string; sort?: string; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, signal, ...query } = params;
    return this.http.get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}/children`, { query, signal });
  }

  async getComments(params: { pageId: string; bodyFormat?: ConfluenceBodyFormat; limit?: number; cursor?: string; sort?: string; status?: string; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, bodyFormat, signal, ...rest } = params;
    return this.http.get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}/footer-comments`, {
      query: { ...rest, "body-format": bodyFormat },
      signal,
    });
  }

  async getLabels(params: { pageId: string; prefix?: string; limit?: number; cursor?: string; sort?: string; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, signal, ...query } = params;
    return this.http.get(`/wiki/api/v2/pages/${encodeURIComponent(pageId)}/labels`, { query, signal });
  }

  async addComment(params: { pageId: string; body: string; parentCommentId?: string; bodyRepresentation?: "storage" | "atlas_doc_format"; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, body, parentCommentId, bodyRepresentation = "storage", signal } = params;
    return this.http.post(
      "/wiki/api/v2/footer-comments",
      {
        body: { representation: bodyRepresentation, value: body },
        ...(parentCommentId ? { parentCommentId } : { pageId }),
      },
      { signal },
    );
  }
}
