import { AtlassianClient } from "../http/AtlassianClient";
import type { QueryValue } from "../http/AtlassianClient";
import { asRecord, clean, errorMessage, options as httpOptions } from "../internal/helpers";

export interface JiraSoftwareHttp {
  get<T>(path: string, options?: { query?: Record<string, QueryValue>; signal?: AbortSignal }): Promise<T>;
  post<T>(path: string, body?: unknown, options?: { query?: Record<string, QueryValue>; signal?: AbortSignal }): Promise<T>;
  put<T>(path: string, body?: unknown, options?: { query?: Record<string, QueryValue>; signal?: AbortSignal }): Promise<T>;
  delete<T>(path: string, options?: { query?: Record<string, QueryValue>; signal?: AbortSignal }): Promise<T>;
}

export type EpicLinkMode = "classic" | "team-managed" | "auto";

export class JiraSoftwareClient {
  constructor(private readonly http: JiraSoftwareHttp = new AtlassianClient()) {}

  async getAgileBoards(params: { startAt?: number; maxResults?: number; type?: "scrum" | "kanban" | "simple"; name?: string; projectKeyOrId?: string; accountIdLocation?: string; projectLocation?: string; includePrivate?: boolean; negateLocationFiltering?: boolean; orderBy?: string; signal?: AbortSignal } = {}): Promise<unknown> {
    const { signal, ...query } = params;
    return this.http.get("/rest/agile/1.0/board", httpOptions(query, signal));
  }

  async createBoard(params: { name: string; type: "scrum" | "kanban"; filterId?: number; filterName?: string; filterJql?: string; filterDescription?: string; filterFavourite?: boolean; signal?: AbortSignal }): Promise<unknown> {
    const { name, type, signal } = params;
    const filterId = params.filterId ?? await this.createFilterForBoard(params);
    return this.http.post("/rest/agile/1.0/board", { name, type, filterId }, { signal });
  }

  async createFilterForBoard(params: { name: string; filterName?: string; filterJql?: string; filterDescription?: string; filterFavourite?: boolean; signal?: AbortSignal }): Promise<number> {
    if (!params.filterJql) {
      throw new Error("filterJql is required when creating a board without filterId.");
    }
    const filter = asRecord(await this.http.post("/rest/api/3/filter", {
      name: params.filterName ?? `${params.name} filter`,
      jql: params.filterJql,
      description: params.filterDescription,
      favourite: params.filterFavourite,
    }, { signal: params.signal }));
    const id = parseFilterId(filter.id);
    return id;
  }

  async updateBoard(_params: { boardId: number; name?: string; filterId?: number; signal?: AbortSignal }): Promise<never> {
    throw new Error("jira_update_board is unsupported by current Jira Software Cloud REST APIs. Jira Cloud documents board configuration reads but no board name/filter update endpoint; create a new board with the desired filter or update the filter separately.");
  }

  async deleteBoard(params: { boardId: number; signal?: AbortSignal }): Promise<void> {
    await this.http.delete(`/rest/agile/1.0/board/${params.boardId}`, { signal: params.signal });
  }

  async getBoardIssues(params: { boardId: number; startAt?: number; maxResults?: number; jql?: string; fields?: string[]; expand?: string[]; signal?: AbortSignal }): Promise<unknown> {
    const { boardId, signal, ...query } = params;
    return this.http.get(`/rest/agile/1.0/board/${boardId}/issue`, httpOptions(query, signal));
  }

  async getSprintsFromBoard(params: { boardId: number; startAt?: number; maxResults?: number; state?: string[]; signal?: AbortSignal }): Promise<unknown> {
    const { boardId, signal, ...query } = params;
    return this.http.get(`/rest/agile/1.0/board/${boardId}/sprint`, httpOptions(query, signal));
  }

  async getSprintIssues(params: { sprintId: number; startAt?: number; maxResults?: number; jql?: string; fields?: string[]; expand?: string[]; signal?: AbortSignal }): Promise<unknown> {
    const { sprintId, signal, ...query } = params;
    return this.http.get(`/rest/agile/1.0/sprint/${sprintId}/issue`, httpOptions(query, signal));
  }

  async createSprint(params: { name: string; originBoardId: number; startDate?: string; endDate?: string; goal?: string; signal?: AbortSignal }): Promise<unknown> {
    const { signal, ...body } = params;
    return this.http.post("/rest/agile/1.0/sprint", clean(body), { signal });
  }

  async updateSprint(params: { sprintId: number; name?: string; state?: string; startDate?: string; endDate?: string; completeDate?: string; originBoardId?: number; goal?: string; signal?: AbortSignal }): Promise<unknown> {
    const { sprintId, signal, ...body } = params;
    return this.http.put(`/rest/agile/1.0/sprint/${sprintId}`, clean(body), { signal });
  }

  async deleteSprint(params: { sprintId: number; signal?: AbortSignal }): Promise<void> {
    await this.http.delete(`/rest/agile/1.0/sprint/${params.sprintId}`, { signal: params.signal });
  }

  async moveIssuesToSprint(params: { sprintId: number; issues: string[]; rankBeforeIssue?: string; rankAfterIssue?: string; signal?: AbortSignal }): Promise<void> {
    const { sprintId, signal, ...body } = params;
    await this.http.post(`/rest/agile/1.0/sprint/${sprintId}/issue`, clean(body), { signal });
  }

  async getBacklogIssues(params: { boardId: number; startAt?: number; maxResults?: number; jql?: string; fields?: string[]; expand?: string[]; signal?: AbortSignal }): Promise<unknown> {
    const { boardId, signal, ...query } = params;
    return this.http.get(`/rest/agile/1.0/board/${boardId}/backlog`, httpOptions(query, signal));
  }

  async rankBacklogIssues(params: { issues: string[]; rankBeforeIssue?: string; rankAfterIssue?: string; rankCustomFieldId?: number; signal?: AbortSignal }): Promise<void> {
    const { signal, ...body } = params;
    await this.http.put("/rest/agile/1.0/issue/rank", clean(body), { signal });
  }

  async getEpicIssues(params: { epicIdOrKey: string; startAt?: number; maxResults?: number; jql?: string; fields?: string[]; expand?: string[]; signal?: AbortSignal }): Promise<unknown> {
    const { epicIdOrKey, signal, ...query } = params;
    return this.http.get(`/rest/agile/1.0/epic/${encodeURIComponent(epicIdOrKey)}/issue`, httpOptions(query, signal));
  }

  async linkToEpic(params: { epicIdOrKey: string; issueKeys: string[]; mode?: EpicLinkMode; signal?: AbortSignal }): Promise<unknown> {
    const mode = params.mode ?? "auto";
    if (mode === "classic") return this.linkToClassicEpic(params);
    if (mode === "team-managed") return this.linkToTeamManagedEpic(params);
    try {
      return await this.linkToClassicEpic(params);
    } catch (classicError) {
      if (!isClassicEpicNotApplicable(classicError)) throw classicError;
      try {
        return await this.linkToTeamManagedEpic(params);
      } catch (fallbackError) {
        throw new Error(
          `jira_link_to_epic auto fallback failed after classic epic endpoint was not applicable: ${errorMessage(classicError)}. Team-managed fallback failed: ${errorMessage(fallbackError)}`,
        );
      }
    }
  }

  private async linkToClassicEpic(params: { epicIdOrKey: string; issueKeys: string[]; signal?: AbortSignal }): Promise<unknown> {
    return this.http.post(
      `/rest/agile/1.0/epic/${encodeURIComponent(params.epicIdOrKey)}/issue`,
      { issues: params.issueKeys },
      { signal: params.signal },
    );
  }

  private async linkToTeamManagedEpic(params: { epicIdOrKey: string; issueKeys: string[]; signal?: AbortSignal }): Promise<unknown[]> {
    const results: unknown[] = [];
    const linked: string[] = [];
    for (const issueKey of params.issueKeys) {
      try {
        results.push(await this.http.put(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}`,
          { fields: { parent: { key: params.epicIdOrKey } } },
          { signal: params.signal },
        ));
        linked.push(issueKey);
      } catch (error) {
        throw new Error(
          `Failed to link issue ${issueKey} to epic ${params.epicIdOrKey} via team-managed parent field: ${errorMessage(error)}. Linked before failure: ${linked.length ? linked.join(", ") : "none"}.`,
        );
      }
    }
    return results;
  }
}

function parseFilterId(value: unknown): number {
  const id = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isInteger(id) || id <= 0) throw new Error("Jira create filter response did not include a positive numeric id.");
  return id;
}

function isClassicEpicNotApplicable(error: unknown): boolean {
  const status = typeof asRecord(error).status === "number" ? asRecord(error).status : undefined;
  return status === 400 || status === 404;
}
