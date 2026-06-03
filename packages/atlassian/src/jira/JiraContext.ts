import { extractLinks, type ExtractedLinks } from "../links/extractLinks";
import { asRecord, getString } from "../internal/helpers";
import { adfToPlainText } from "../text/adf";
import { JiraPlatformClient } from "./JiraPlatformClient";

export interface JiraIssueOptions {
  key: string;
  includeComments?: boolean;
  maxComments?: number;
  signal?: AbortSignal;
}

export interface JiraIssueContext {
  key: string;
  id: string;
  url: string;
  summary: string;
  issueType?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  reporter?: string;
  parent?: JiraIssueReference;
  subtasks: JiraIssueReference[];
  linkedIssues: JiraIssueReference[];
  labels: string[];
  components: string[];
  fixVersions: string[];
  description: string;
  acceptanceCriteria: string[];
  customFields: Record<string, string>;
  comments: JiraCommentContext[];
  links: ExtractedLinks;
}

export interface JiraIssueReference {
  key: string;
  id?: string;
  url?: string;
  summary?: string;
  issueType?: string;
  status?: string;
  relation?: string;
  direction?: "parent" | "subtask" | "inward" | "outward";
}

export interface JiraCommentContext {
  id: string;
  author?: string;
  created?: string;
  body: string;
}

interface JiraContextClient {
  readonly baseUrl: string;
  getIssue(params: { issueIdOrKey: string; fields?: string[]; expand?: string[]; signal?: AbortSignal }): Promise<unknown>;
  getComments(params: { issueIdOrKey: string; orderBy?: string; maxResults?: number; signal?: AbortSignal }): Promise<unknown>;
}

export async function getJiraIssueContext(
  options: JiraIssueOptions,
  client: JiraContextClient = new JiraPlatformClient(),
): Promise<JiraIssueContext> {
  const issue = asRecord(await client.getIssue({
    issueIdOrKey: options.key,
    expand: ["names", "renderedFields"],
    signal: options.signal,
  }));
  const fields = asRecord(issue.fields);
  const names = stringRecord(issue.names);
  const key = getString(issue.key) || options.key;
  const description = extractFieldText(fields.description);
  const customFields = extractNamedCustomFields(fields, names);
  const customFieldValues = Object.keys(names)
    .filter((fieldId) => fieldId.startsWith("customfield_"))
    .map((fieldId) => fields[fieldId])
    .filter((value) => value !== undefined);
  const acceptanceCriteria = Object.entries(customFields)
    .filter(([name]) => /acceptance|criteria|ac\b/i.test(name))
    .map(([, value]) => value)
    .filter(Boolean);
  const comments = options.includeComments === false
    ? []
    : await getJiraComments(key, options.maxComments ?? 5, client, options.signal);
  const linkCorpus = {
    key,
    summary: fields.summary,
    description: fields.description,
    customFields: customFieldValues,
    customFieldText: customFields,
    comments: comments.map((comment) => comment.body),
  };

  return {
    key,
    id: getString(issue.id),
    url: `${client.baseUrl}/browse/${key}`,
    summary: getString(fields.summary),
    issueType: getNamedObjectName(fields.issuetype),
    status: getNamedObjectName(fields.status),
    priority: getNamedObjectName(fields.priority),
    assignee: getUserDisplayName(fields.assignee),
    reporter: getUserDisplayName(fields.reporter),
    parent: parseJiraIssueReference(fields.parent, client, "parent"),
    subtasks: parseJiraIssueReferences(fields.subtasks, client, "subtask"),
    linkedIssues: parseLinkedIssues(fields.issuelinks, client),
    labels: getStringArray(fields.labels),
    components: getNamedObjectArray(fields.components),
    fixVersions: getNamedObjectArray(fields.fixVersions),
    description,
    acceptanceCriteria,
    customFields,
    comments,
    links: extractLinks(linkCorpus),
  };
}

export function renderJiraIssueMarkdown(issue: JiraIssueContext): string {
  const lines = [
    `# ${issue.key}: ${issue.summary}`,
    "",
    `- URL: ${issue.url}`,
    issue.issueType ? `- Type: ${issue.issueType}` : undefined,
    issue.status ? `- Status: ${issue.status}` : undefined,
    issue.priority ? `- Priority: ${issue.priority}` : undefined,
    issue.assignee ? `- Assignee: ${issue.assignee}` : undefined,
    issue.reporter ? `- Reporter: ${issue.reporter}` : undefined,
  ].filter((line): line is string => Boolean(line));

  if (issue.labels.length) lines.push(`- Labels: ${issue.labels.join(", ")}`);
  if (issue.components.length) lines.push(`- Components: ${issue.components.join(", ")}`);
  if (issue.fixVersions.length) lines.push(`- Fix versions: ${issue.fixVersions.join(", ")}`);
  if (issue.parent) lines.push("", "## Parent Issue", formatIssueReference(issue.parent));
  if (issue.subtasks.length) lines.push("", "## Subtasks", ...issue.subtasks.map(formatIssueReference));
  if (issue.linkedIssues.length) lines.push("", "## Linked Issues", ...issue.linkedIssues.map(formatIssueReference));
  if (issue.description) lines.push("", "## Description", "", issue.description);
  if (issue.acceptanceCriteria.length) {
    lines.push("", "## Acceptance Criteria");
    for (const criteria of issue.acceptanceCriteria) lines.push("", criteria);
  }
  if (issue.links.figmaUrls.length) lines.push("", "## Figma Links", ...issue.links.figmaUrls.map((url) => `- ${url}`));
  if (issue.links.confluenceUrls.length) lines.push("", "## Confluence Links", ...issue.links.confluenceUrls.map((url) => `- ${url}`));
  const relatedKeys = issue.links.jiraKeys.filter((key) => key !== issue.key);
  if (relatedKeys.length) lines.push("", "## Related Jira Keys From Text", ...relatedKeys.map((key) => `- ${key}`));
  if (issue.comments.length) {
    lines.push("", "## Recent Comments");
    for (const comment of issue.comments) {
      lines.push("", `### ${comment.author ?? "Unknown"}${comment.created ? ` (${comment.created})` : ""}`, "", comment.body);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatIssueReference(reference: JiraIssueReference): string {
  const relation = reference.relation ? ` (${reference.relation})` : "";
  const status = reference.status ? ` [${reference.status}]` : "";
  const summary = reference.summary ? `: ${reference.summary}` : "";
  return `- ${reference.key}${relation}${summary}${status}`;
}

async function getJiraComments(
  key: string,
  maxComments: number,
  client: JiraContextClient,
  signal?: AbortSignal,
): Promise<JiraCommentContext[]> {
  if (maxComments === 0) return [];
  const response = asRecord(await client.getComments({ issueIdOrKey: key, orderBy: "-created", maxResults: maxComments, signal }));
  const comments = Array.isArray(response.comments) ? response.comments : [];
  return comments.map((comment) => {
    const record = asRecord(comment);
    return {
      id: getString(record.id),
      author: getUserDisplayName(record.author),
      created: getString(record.created) || undefined,
      body: extractFieldText(record.body),
    };
  });
}

function extractNamedCustomFields(fields: Record<string, unknown>, names: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [fieldId, fieldName] of Object.entries(names)) {
    if (!fieldId.startsWith("customfield_")) continue;
    const text = extractFieldText(fields[fieldId]);
    if (text) result[fieldName] = text;
  }
  return result;
}

function parseLinkedIssues(value: unknown, client: JiraContextClient): JiraIssueReference[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((link) => {
    const record = asRecord(link);
    const linkType = getNamedObjectName(record.type) ?? "Linked issue";
    const inward = parseJiraIssueReference(record.inwardIssue, client, "inward");
    const outward = parseJiraIssueReference(record.outwardIssue, client, "outward");
    return [inward, outward]
      .filter((item): item is JiraIssueReference => Boolean(item))
      .map((item) => ({ ...item, relation: linkType }));
  });
}

function parseJiraIssueReferences(value: unknown, client: JiraContextClient, direction: JiraIssueReference["direction"]): JiraIssueReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => parseJiraIssueReference(item, client, direction))
    .filter((item): item is JiraIssueReference => Boolean(item));
}

function parseJiraIssueReference(value: unknown, client: JiraContextClient, direction: JiraIssueReference["direction"]): JiraIssueReference | undefined {
  const record = asRecord(value);
  const key = getString(record.key);
  if (!key) return undefined;
  const fields = asRecord(record.fields);
  return {
    key,
    id: getString(record.id) || undefined,
    url: `${client.baseUrl}/browse/${key}`,
    summary: getString(fields.summary) || undefined,
    issueType: getNamedObjectName(fields.issuetype),
    status: getNamedObjectName(fields.status),
    direction,
  };
}

function extractFieldText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return unique(value.map(extractFieldText).filter(Boolean)).join("\n");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string") return record.value;
    if (typeof record.name === "string") return record.name;
    return adfToPlainText(value);
  }
  return "";
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getNamedObjectName(value: unknown): string | undefined {
  const name = asRecord(value).name;
  return typeof name === "string" ? name : undefined;
}

function getNamedObjectArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(getNamedObjectName).filter((item): item is string => Boolean(item));
}

function getUserDisplayName(value: unknown): string | undefined {
  const displayName = asRecord(value).displayName;
  return typeof displayName === "string" ? displayName : undefined;
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
