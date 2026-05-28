export const CONFLUENCE_V2_PREFIX = "/wiki/api/v2";
export const CONFLUENCE_V1_PREFIX = "/wiki/rest/api";
export const JIRA_PLATFORM_V3_PREFIX = "/rest/api/3";
export const JIRA_SOFTWARE_PREFIX = "/rest/agile/1.0";

export const VERIFIED_CONFLUENCE_V2_ENDPOINTS = [
  "GET /wiki/api/v2/spaces",
  "POST /wiki/api/v2/spaces",
  "GET /wiki/api/v2/spaces/{id}",
  "GET /wiki/api/v2/spaces/{id}/pages",
  "GET /wiki/api/v2/pages",
  "POST /wiki/api/v2/pages",
  "GET /wiki/api/v2/pages/{id}",
  "PUT /wiki/api/v2/pages/{id}",
  "DELETE /wiki/api/v2/pages/{id}",
  "GET /wiki/api/v2/pages/{id}/children",
  "GET /wiki/api/v2/pages/{id}/footer-comments",
  "GET /wiki/api/v2/pages/{id}/labels",
  "POST /wiki/api/v2/footer-comments",
] as const;

export const VERIFIED_CONFLUENCE_V1_ONLY_ENDPOINTS = [
  "GET /wiki/rest/api/search",
  "GET /wiki/rest/api/search/user",
  "POST /wiki/rest/api/content/{id}/label",
] as const;

export const VERIFIED_JIRA_PLATFORM_V3_ENDPOINTS = [
  "GET /rest/api/3/project/search",
  "POST /rest/api/3/search/jql",
  "POST /rest/api/3/issue",
  "GET /rest/api/3/issue/{issueIdOrKey}",
  "POST /rest/api/3/changelog/bulkfetch",
  "PUT /rest/api/3/issue/{issueIdOrKey}",
  "DELETE /rest/api/3/issue/{issueIdOrKey}",
  "GET /rest/api/3/issue/{issueIdOrKey}/transitions",
  "POST /rest/api/3/issue/{issueIdOrKey}/transitions",
  "GET /rest/api/3/issue/{issueIdOrKey}/comment",
  "POST /rest/api/3/issue/{issueIdOrKey}/comment",
  "GET /rest/api/3/issue/{issueIdOrKey}/worklog",
  "POST /rest/api/3/issue/{issueIdOrKey}/worklog",
  "GET /rest/api/3/issueLinkType",
  "POST /rest/api/3/issueLink",
  "DELETE /rest/api/3/issueLink/{linkId}",
  "GET /rest/api/3/project/{projectIdOrKey}/versions",
  "POST /rest/api/3/version",
  "GET /rest/api/3/field/search",
  "GET /rest/api/3/user",
  "GET /rest/api/3/attachment/{id}",
  "GET /rest/api/3/attachment/content/{id}",
  "POST /rest/api/3/issue/bulk",
  "POST /rest/api/3/filter",
] as const;

export const VERIFIED_JIRA_PLATFORM_V2_CONTEXT_ENDPOINTS = [
  "GET /rest/api/2/issue/{issueIdOrKey}/remotelink",
] as const;

export const VERIFIED_JIRA_SOFTWARE_ENDPOINTS = [
  "GET /rest/agile/1.0/board",
  "POST /rest/agile/1.0/board",
  "GET /rest/agile/1.0/board/{boardId}",
  "DELETE /rest/agile/1.0/board/{boardId}",
  "GET /rest/agile/1.0/board/{boardId}/configuration",
  "GET /rest/agile/1.0/board/{boardId}/issue",
  "POST /rest/agile/1.0/board/{boardId}/issue",
  "GET /rest/agile/1.0/board/{boardId}/backlog",
  "GET /rest/agile/1.0/board/{boardId}/sprint",
  "GET /rest/agile/1.0/sprint/{sprintId}/issue",
  "POST /rest/agile/1.0/sprint",
  "GET /rest/agile/1.0/sprint/{sprintId}",
  "POST /rest/agile/1.0/sprint/{sprintId}",
  "PUT /rest/agile/1.0/sprint/{sprintId}",
  "DELETE /rest/agile/1.0/sprint/{sprintId}",
  "POST /rest/agile/1.0/sprint/{sprintId}/issue",
  "PUT /rest/agile/1.0/issue/rank",
  "GET /rest/agile/1.0/epic/{epicIdOrKey}/issue",
  "POST /rest/agile/1.0/epic/{epicIdOrKey}/issue",
] as const;

export const UNSUPPORTED_JIRA_SOFTWARE_ENDPOINTS = [
  {
    operation: "jira_update_board",
    reason: "Current Jira Software Cloud REST APIs expose board configuration reads but no documented board name/filter update endpoint.",
  },
] as const;
