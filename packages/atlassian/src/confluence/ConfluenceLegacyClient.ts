import { AtlassianClient } from "../http/AtlassianClient";

interface ConfluenceHttp {
  get<T>(path: string, options?: { query?: Record<string, unknown>; signal?: AbortSignal }): Promise<T>;
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
}

export class ConfluenceLegacyClient {
  constructor(private readonly http: ConfluenceHttp = new AtlassianClient()) {}

  async search(params: { cql: string; limit?: number; start?: number; expand?: string; signal?: AbortSignal }): Promise<unknown> {
    const { signal, ...query } = params;
    return this.http.get("/wiki/rest/api/search", { query, signal });
  }

  async searchUser(params: { cql: string; limit?: number; start?: number; signal?: AbortSignal }): Promise<unknown> {
    const { signal, ...query } = params;
    return this.http.get("/wiki/rest/api/search/user", { query, signal });
  }

  async addLabel(params: { pageId: string; labels: Array<{ prefix: string; name: string }>; signal?: AbortSignal }): Promise<unknown> {
    const { pageId, labels, signal } = params;
    return this.http.post(`/wiki/rest/api/content/${encodeURIComponent(pageId)}/label`, labels, { signal });
  }
}
