# atlassian

Pi extension for Atlassian Jira and Confluence Cloud tools.

This package is implemented against the current Atlassian Cloud REST APIs:

- Confluence REST v2 for page, space, comment, and label reads/writes
- Jira platform REST v3 for project, issue, search, comment, worklog, link, version, field, user, and attachment operations
- Jira Software REST for Agile board, sprint, backlog, ranking, and epic operations

## Installation

```bash
pi install npm:@pi-stef/atlassian
```

## Auth

Set environment variables:

```bash
export ATLASSIAN_BASE_URL="https://your-site.atlassian.net"
export ATLASSIAN_EMAIL="you@example.com"
export ATLASSIAN_API_TOKEN="..."
```

Or use a config file at `~/.pi/sf/atlassian/config.json`:

```json
{
  "baseUrl": "https://your-site.atlassian.net",
  "email": "you@example.com",
  "apiToken": "..."
}
```

```bash
chmod 600 ~/.pi/sf/atlassian/config.json
```

## Natural Language Usage

```text
pi "Summarize Jira issue ABC-123 and any linked Confluence requirements."
pi "Read this Confluence page and list implementation constraints."
```

## Development CLI

```bash
pnpm exec tsx packages/atlassian/bin/atlassian.ts jira ABC-123 --context
pnpm exec tsx packages/atlassian/bin/atlassian.ts confluence "https://your-site.atlassian.net/wiki/..."
```

## Jira Context

Use `story_context` when a Jira story should drive implementation work. It returns compact issue details, related Jira issues, linked Confluence pages, Figma URLs, and external URL inventory.

```json
{
  "tool": "story_context",
  "key": "ABC-123",
  "maxDepth": 1,
  "maxJiraIssues": 10,
  "maxConfluencePages": 3
}
```

## Figma Integration

When `~/.pi/sf/figma/config.json` is configured, Jira context automatically fetches linked Figma context. See [figma](/packages/figma) for setup.
