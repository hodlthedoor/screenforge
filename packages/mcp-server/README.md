# @screenforge/mcp-server

MCP server for ScreenForge. It exposes ScreenForge render and schedule APIs as MCP tools for Claude, GPT, and other MCP-compatible agents.

## Features

- `screenshot(url, opts)`
- `pdf(url, opts)`
- `og(url, opts)`
- `gif(url, opts)`
- `diff(url_a, url_b, opts)`
- `create_schedule(opts)`
- `list_schedules()`
- `get_schedule(id)`
- `update_schedule(id, opts)`
- `delete_schedule(id)`
- `poll_job(id)`

Binary results are returned as:

- inline `base64` when payload size is below `SCREENFORGE_MCP_INLINE_LIMIT_BYTES` (default `524288` bytes)
- `file://` URL for larger payloads

## Installation

```bash
npm install @screenforge/mcp-server
```

## Configuration

Required:

- `SCREENFORGE_API_KEY`: ScreenForge API key

Optional:

- `SCREENFORGE_API_URL`: ScreenForge API base URL (default `http://localhost:3100`)
- `SCREENFORGE_MCP_INLINE_LIMIT_BYTES`: inline base64 limit in bytes (default `524288`)
- `SCREENFORGE_MCP_ARTIFACT_DIR`: directory for large payload files
- `MCP_TRANSPORT`: `stdio` (default) or `sse`
- `PORT`: SSE port (default `3333`)
- `HOST`: SSE host (default `0.0.0.0`)
- `MCP_SSE_PATH`: SSE stream path (default `/sse`)
- `MCP_MESSAGES_PATH`: POST messages path (default `/messages`)

## Usage

### Local stdio mode

```bash
SCREENFORGE_API_KEY=sk_xxx npx @screenforge/mcp-server
```

Installed binary name: `screenforge-mcp`

### SSE mode

```bash
SCREENFORGE_API_KEY=sk_xxx MCP_TRANSPORT=sse PORT=3333 npx @screenforge/mcp-server
```

SSE endpoints:

- `GET /sse`
- `POST /messages`
- `GET /health`

## Claude Desktop config example

```json
{
  "mcpServers": {
    "screenforge": {
      "command": "npx",
      "args": ["-y", "@screenforge/mcp-server"],
      "env": {
        "SCREENFORGE_API_URL": "http://localhost:3100",
        "SCREENFORGE_API_KEY": "sk_your_key"
      }
    }
  }
}
```

## Claude Code config example

`.mcp.json`:

```json
{
  "servers": {
    "screenforge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@screenforge/mcp-server"],
      "env": {
        "SCREENFORGE_API_URL": "http://localhost:3100",
        "SCREENFORGE_API_KEY": "sk_your_key"
      }
    }
  }
}
```

## Development

```bash
npm install
npm test
npm run build
```
