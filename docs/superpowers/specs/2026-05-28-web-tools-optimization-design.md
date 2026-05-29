# Web Package Tool Optimization Design

**Date:** 2026-05-28
**Status:** draft

## Prompt

Perform a deep analysis of the code and understand how to optimize the "web" package tools so it's easy for a user to ask 1) in natural language or 2) with a full set of slash commands how to invoke the "web" tools for search, web_fetch, web_flow, web_login. All tests and checks need to pass, no matter if we caused the errors or not.

## Interpretation

The web package registers 5 tools (`web_search`, `web_fetch`, `web_flow`, `web_login`, `web_session`) and 2 slash commands (`/search`, `/web`). The model has difficulty discovering and correctly choosing tools beyond `web_search`. The root causes are:

1. Inconsistent slash command behavior — `/search` executes and sends results to the agent, while `/web` is display-only.
2. No slash commands exist for fetch, flow, login, or session — users can only trigger these via LLM tool calls.
3. Tool names use `web_*` prefix but other packages use `sf_*` — inconsistent with the project convention.
4. `promptGuidelines` missing on 3 of 5 tools — the agent gets no usage guidance for flow, login, and session.
5. `web_flow` returns empty results when the auto-generated search flow has no extract step.
6. Pre-existing `check-runtime` bug (`typebox` should be `@sinclair/typebox`).
7. Documentation is incomplete — no comprehensive reference for config, env vars, or natural-language usage.

## Assumptions

- The pi framework's `pi.sendUserMessage()` is the correct mechanism for slash commands to trigger agent responses (proven by sf-team).
- All slash commands should inject a natural-language prompt to the agent (Approach A: thin wrappers), not execute directly.
- Tool and command names use `sf_web_*` / `/sf-web-*` prefix.
- Old `web_*` tools and `/search`, `/web` commands are removed entirely — no aliases.
- The `web_fetch` default mode remains `"auto"` — users can force browser mode via natural language or explicit parameter.
- No cross-package dependencies on the old `web_*` tool names (they're registered dynamically via the pi extension system).

## Files

### Modified

| File | Changes |
|------|---------|
| `packages/web/src/tools.ts` | Rename tools `web_*` → `sf_web_*`, remove old commands, add 5 new `/sf-web-*` commands + `/sf-web`, update descriptions/snippets/guidelines |
| `packages/web/src/browser/flow.ts` | Add extract step to `parseSiteSearchInstruction` |
| `packages/web/bin/check-runtime.mjs` | Fix `typebox` → `@sinclair/typebox` |
| `packages/web/README.md` | Complete rewrite |

### No changes needed

| File | Reason |
|------|--------|
| `packages/web/src/fetch/index.ts` | Default mode stays `"auto"` |
| `packages/web/src/config.ts` | No config changes |
| `packages/web/src/search/index.ts` | Internal module, no API changes |
| `packages/web/src/types.ts` | `WebFetchMode` type unchanged |

## Approach

### 1. Tool renaming and description overhaul

Rename all 5 tools from `web_*` to `sf_web_*`. Rewrite `description`, `promptSnippet`, and `promptGuidelines` for each tool to be clear and actionable. Every tool gets `promptSnippet` and `promptGuidelines`.

### 2. Slash command replacement

Remove `/search`, `/web-search`, and `/web`. Register 6 new commands:

| Command | Args | Prompt sent to agent |
|---------|------|---------------------|
| `/sf-web-search` | `<query>` | `Search the web for: <query>` |
| `/sf-web-fetch` | `<url>` | `Fetch the content of this URL: <url>` |
| `/sf-web-flow` | `<instruction>` | `Run a browser flow: <instruction>` |
| `/sf-web-login` | `<url>` | `Create a browser login session for: <url>` |
| `/sf-web-session` | `[action] [name]` | Action-specific prompt (list, inspect, clear) |
| `/sf-web` | `status` | `Show web package status and configuration` |

All commands follow the same pattern:
1. Validate args non-empty (except `/sf-web-session` defaults to "list")
2. Construct natural-language prompt
3. Send via `pi.sendUserMessage()` — idle → normal message, busy → `followUp`
4. If `sendUserMessage` unavailable, fallback to `ctx.ui.notify()` with warning

If `/sf-web-search` registration fails (name collision), try `/sf-search` as fallback.

### 3. Flow search instruction extract step

Extend `parseSiteSearchInstruction` in `browser/flow.ts` to add a 5th step: `{ action: "extract", selector: "body" }`. This captures visible page text after search results load, so the agent gets content instead of empty `extracted` array.

### 4. check-runtime fix

Change `"typebox"` to `"@sinclair/typebox"` in `bin/check-runtime.mjs`.

### 5. Documentation rewrite

Complete rewrite of `packages/web/README.md` covering:
- Overview, installation, pi extension integration
- Tools reference with full parameter tables, natural-language examples, slash command equivalents
- Slash commands reference with syntax and examples
- Configuration: `~/.pi/web/config.json` format, all `SF_WEB_*` env vars, browser settings
- Natural-language guide: examples of how to ask the agent for each tool
- Provider cascade explanation
- Browser session management

## Tool Reference

### sf_web_search

| Field | Value |
|-------|-------|
| name | `sf_web_search` |
| label | `SF Web Search` |
| description | Search the web using a no-key provider cascade (SearXNG, DuckDuckGo, Google, Bing). |
| promptSnippet | `Use sf_web_search to search the web when current public web results are needed.` |
| promptGuidelines | `"After sf_web_search returns results with URLs, use sf_web_fetch to read the full page content."` |

Parameters: `query` (string, required), `maxResults` (int 1-20), `providers` (array), `searxngUrl` (string), `headless` (bool), `profile` (string).

### sf_web_fetch

| Field | Value |
|-------|-------|
| name | `sf_web_fetch` |
| label | `SF Web Fetch` |
| description | Fetch a specific URL. Defaults to fast HTTP; automatically falls back to CloakBrowser for JS-heavy pages. Use mode='browser' to force browser rendering. |
| promptSnippet | `Use sf_web_fetch to read a specific URL; pass the url argument.` |
| promptGuidelines | Retry on missing URL, omit diagnostics, force browser when user asks. |

Parameters: `url` (string, required), `format` (markdown/text/html/json/raw), `mode` (auto/fast/browser), `headless` (bool), `profile` (string), `screenshot` (bool), `selector` (string).

### sf_web_flow

| Field | Value |
|-------|-------|
| name | `sf_web_flow` |
| label | `SF Web Flow` |
| description | Automate multi-step browser interactions in CloakBrowser: navigate, fill forms, click, extract data. Accepts natural-language instructions or structured steps. |
| promptSnippet | `Use sf_web_flow for browser automation: navigate pages, fill forms, click elements, extract rendered content.` |
| promptGuidelines | Always include extract step; prefer sf_web_search for simple searches. |

Parameters: `instruction` (string), `steps` (array), `headless` (bool), `profile` (string).

### sf_web_login

| Field | Value |
|-------|-------|
| name | `sf_web_login` |
| label | `SF Web Login` |
| description | Create or refresh a named CloakBrowser login profile. Credentials come from environment variables, never from tool arguments. |
| promptSnippet | `Use sf_web_login to create or refresh authenticated browser sessions for sites requiring login.` |
| promptGuidelines | Credentials via env vars only. |

Parameters: `url` (string, required), `interactive` (bool), `interactiveWaitMs` (int 1000-600000), `passwordEnv` (string), `profile` (string), `headless` (bool), `usernameEnv` (string).

### sf_web_session

| Field | Value |
|-------|-------|
| name | `sf_web_session` |
| label | `SF Web Session` |
| description | List, inspect, locate, or clear CloakBrowser session profiles. |
| promptSnippet | `Use sf_web_session to list, inspect, or clear saved browser session profiles.` |
| promptGuidelines | None. |

Parameters: `action` (list/inspect/locate/clear), `profile` (string), `yes` (bool).

## TDD Approach

TDD auto-skip. This is a refactoring/renaming task with no new behavior — existing tools work the same way, just with new names and better descriptions. The web package has no test suite. Verification is via typecheck and check-runtime.

## Acceptance Criteria

- [ ] All 5 tools renamed to `sf_web_*` with updated descriptions, snippets, and guidelines
- [ ] Old `web_*` tools and `/search`, `/web` commands removed entirely
- [ ] 6 new slash commands (`/sf-web-search`, `/sf-web-fetch`, `/sf-web-flow`, `/sf-web-login`, `/sf-web-session`, `/sf-web`) registered
- [ ] All commands inject prompts via `pi.sendUserMessage()` with idle/busy handling
- [ ] `parseSiteSearchInstruction` includes extract step
- [ ] `check-runtime` passes (typebox fix)
- [ ] `pnpm --filter web exec tsc --noEmit` passes
- [ ] `README.md` rewritten with comprehensive documentation

## Verification

```bash
pnpm --filter web exec tsc --noEmit
pnpm --filter web check-runtime
```

## Rollback

Single commit — revert via `git revert HEAD`. No data migration, no config changes.

## Runtime State

(Status tracking — updated during execution)

## Review History

(Review loop entries — appended during execution)

## Final Status

(Filled after completion)
