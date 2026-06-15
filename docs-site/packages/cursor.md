# Cursor Provider

Cursor AI editor as a native Pi stream provider — OAuth login, protobuf/HTTP2 protocol, tool-call recovery.

## Overview

The Cursor provider registers Cursor as a Pi provider named `cursor`. It enables Pi to use Cursor models (Claude, GPT, Gemini, Grok) through Cursor OAuth and Cursor's native agent protocol.

Key features:
- OAuth PKCE authentication with Cursor
- Protobuf/HTTP2 protocol for efficient streaming
- Three-tier bridge recovery for tool-call continuity
- Exact model routing (no invented reasoning-effort suffixes)
- Dynamic agent endpoint resolution

## Install

```sh
pi install npm:@pi-stef/cursor
```

Then open Pi and run:

```text
/login cursor
```

## Usage

After installing and logging in, ask Pi to use Cursor-backed models:

```text
"Use the cursor provider for this session and compare the failing test output with the latest diff."
"Use Cursor MAX mode through the cursor provider for this larger refactor."
"Use the cursor provider with the exact gemini-3.1-pro model; do not force a reasoning level unless Cursor advertises one."
```

## OAuth Login Flow

1. Run `/login cursor` in Pi
2. Pi displays a Cursor login URL
3. Open the URL in your browser
4. Authorize Pi to access your Cursor account
5. Pi receives and stores the OAuth tokens

## Model Discovery and Routing

The provider discovers available models from Cursor's agent endpoint and preserves exact model IDs. Reasoning effort is forwarded only when Cursor model metadata advertises effort support.

## Endpoint and Model Routing

Cursor model discovery and streaming use Cursor's agent endpoint. The provider resolves that endpoint in this order:

1. `PI_CURSOR_AGENT_URL`
2. `CURSOR_AGENT_URL`
3. Cursor CLI config at `~/.cursor/cli-config.json`
4. Fallback `https://agentn.us.api5.cursor.sh`

## Architecture

### Bridge Recovery

The provider implements three-tier bridge recovery for tool-call continuity:

1. **Tier 1**: Resume from existing bridge connection
2. **Tier 2**: Rebuild from checkpoint/blob state
3. **Tier 3**: Full history rebuild from Pi request context

### Protocol

The provider uses protobuf over HTTP/2 for efficient communication with Cursor's agent endpoint.

## Configuration

### Environment Variables

- `PI_CURSOR_AGENT_URL` — Override Cursor agent endpoint
- `CURSOR_AGENT_URL` — Alternative agent endpoint override
- `PI_CURSOR_PROVIDER_DEBUG=1` — Enable debug logging
- `PI_CURSOR_STREAM_IDLE_TIMEOUT_MS` — Stream idle timeout (default: 120000ms)
- `PI_CURSOR_STREAM_IDLE_MAX_RETRIES` — Max idle retries (default: 3)
- `PI_CURSOR_RESUME_IDLE_TIMEOUT_MS` — Resume stream timeout (default: 240000ms)

## Troubleshooting

### Authentication Fails

Remove the package and reinstall:

```sh
pi remove @pi-stef/cursor
pi install npm:@pi-stef/cursor
```

### Provider Starts Offline

If the provider starts offline, it registers bundled fallback models and retries live model discovery after successful OAuth login or refresh.

### Stream Idle Timeout

Native streams retry in place when Cursor stops sending upstream data. The default idle timeout is 2 minutes, and the provider retries 3 times before returning a final error.

## Remove

```sh
pi remove @pi-stef/cursor
```

## Update

```sh
pi update @pi-stef/cursor
```
