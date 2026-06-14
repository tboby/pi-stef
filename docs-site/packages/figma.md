# figma

Pi extension for Figma REST API tools, compact design context, and Jira-linked Figma summaries.

Use this package when implementation work starts from Figma files, frames, FigJam boards, or Jira tickets that contain Figma design links.

## Installation

```bash
pi install npm:@pi-stef/figma
```

## Setup And Auth

Create the config file:

```bash
mkdir -p ~/.pi/sf/figma
cat > ~/.pi/sf/figma/config.json <<'JSON'
{
  "apiToken": "MY_TOKEN"
}
JSON
chmod 600 ~/.pi/sf/figma/config.json
```

Check token discovery:

```text
figma_auth_status
figma_auth_status fileKey="abc123"
```

## Natural Language Usage

```text
pi "Summarize this Figma flow before implementing: https://www.figma.com/file/..."
pi "Inspect the checkout screen and extract implementation hints."
```

## REST Tool Surface

| Tool | Purpose |
|---|---|
| `figma_context` | Overview/screen context with hierarchy and styles |
| `figma_get_design_context` | Page/frame context with nearby nodes |
| `figma_get_node_summary` | Layout, dimensions, styles, text, components |
| `figma_get_implementation_context` | Design-to-code hints for layout, color, typography, spacing |
| `figma_extract_text` | Visible text nodes with paths |
| `figma_find_nodes_by_name` | Search node names |
| `figma_find_nodes_by_text` | Search visible text content |
| `figma_render_nodes` | Image render URLs |
| `figma_extract_assets` | Asset manifest for renderable nodes |
| `figma_get_styles` | File styles |
| `figma_get_variables` | Variables and collections |
| `figma_get_components` | File components |

## Figma Context Workflow

- `mode="overview"` — for pages, canvases, multi-screen flows
- `mode="screen"` — for focused frames or screens

Recommended flow:
1. Start with `mode="overview"` for broad links
2. Pick relevant screen node IDs
3. Re-run with `mode="screen"` for implementation details

## Atlassian Integration

When `~/.pi/sf/atlassian/config.json` is configured, Jira context automatically includes linked Figma context. See [atlassian](/packages/atlassian) for setup.

## Scopes And Permissions

| Capability | Typical scope |
|---|---|
| Files, nodes, text, design context | `file_content:read` |
| Comments | `file_comments:read` |
| Components, styles, libraries | `library_assets:read` and `library_content:read` |

## Troubleshooting

| Symptom | Action |
|---|---|
| `Figma API token not found` | Create config file with `{ "apiToken": "MY_TOKEN" }` |
| 401 or 403 | Check token validity, scopes, and file access |
| 429 | Wait or narrow request with node IDs and lower depth |
