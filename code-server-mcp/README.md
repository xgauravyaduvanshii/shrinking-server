# shrinking-server-mcp

`shrinking-server-mcp` is a standalone MCP server that gives AI agents a powerful control layer for a self-hosted `shrinking-server` environment. It can read and write files, run terminal commands, manage git, search a workspace, inspect server health, expose useful MCP resources, and optionally attach to a live running server window through native socket, UI terminal, and LSP bridges.

## What It Does

- Connects to `shrinking-server` with password, token, or unauthenticated local mode
- Exposes filesystem, terminal, editor, search, git, extension, and server tools over MCP
- Adds optional Phase 2 bridges:
  - native socket bridge for real `editor_open_file`, live editor status, and clipboard write
  - UI terminal WebSocket bridge for visible code-server terminals
  - LSP bridge for hover, definitions, references, completions, diagnostics, symbols, formatting, and rename
- Supports both `stdio` and Streamable HTTP transport
- Adds path sandboxing, read-only mode, rate limiting, and structured stderr logging

## Install

```bash
cd /home/ubuntu/flyingdarkdev-server/code-server/code-server-mcp
npm install
cp .env.example .env
npm run build
```

## Configuration

`.env` example:

```env
CODE_SERVER_URL=http://127.0.0.1:8080
CODE_SERVER_PASSWORD=your-password
CODE_SERVER_TOKEN=
CODE_SERVER_WORKSPACE=/home/ubuntu/projects
CODE_SERVER_CLI=
VSCODE_IPC_HOOK_CLI=
CODE_SERVER_SOCKET_PATH=
CODE_SERVER_USER_DATA_DIR=
CODE_SERVER_EXTENSIONS_DIR=
MCP_TRANSPORT=stdio
MCP_HTTP_PORT=3100
MCP_LSP_ENABLED=true
MCP_TERMINAL_WS_ENABLED=true
READONLY_MODE=false
ALLOWED_PATHS=/home/ubuntu/projects
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=500
```

## Run

Stdio:

```bash
npm run build
npm start
```

HTTP:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3100 npm start
```

## Claude Desktop

Add this to Claude Desktop config:

```json
{
  "mcpServers": {
    "shrinking-server-mcp": {
      "command": "node",
      "args": ["/home/ubuntu/flyingdarkdev-server/code-server/code-server-mcp/build/src/index.js"],
      "cwd": "/home/ubuntu/flyingdarkdev-server/code-server/code-server-mcp",
      "env": {
        "CODE_SERVER_URL": "http://127.0.0.1:8080",
        "CODE_SERVER_PASSWORD": "your-password",
        "CODE_SERVER_WORKSPACE": "/home/ubuntu/projects",
        "MCP_LSP_ENABLED": "true",
        "MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

## HTTP Agents

Run:

```bash
MCP_TRANSPORT=http MCP_HTTP_PORT=3100 npm start
```

Then point your MCP-capable agent at:

`http://your-host:3100`

## Security

- Only expose this MCP to trusted networks
- Never place `CODE_SERVER_PASSWORD` in logs or screenshots
- Use `READONLY_MODE=true` for audit-only setups
- Restrict paths with `ALLOWED_PATHS`

## Live Bridge Setup

- Native socket:
  - `shrinking-server` registers existing-window sockets automatically.
  - If MCP cannot discover the socket, set `VSCODE_IPC_HOOK_CLI=/tmp/vscode-ipc-....sock`.
  - `bridge_status` reports whether the native socket is attached.
- UI terminal WebSocket:
  - Enabled by default with `MCP_TERMINAL_WS_ENABLED=true`.
  - If `/terminal` is unavailable in your deployment, `terminal_ui_*` tools will degrade gracefully.
- LSP:
  - Enabled by default with `MCP_LSP_ENABLED=true`.
  - `lsp_servers_available` reports detected language servers on the host.
  - Current auto-detection covers TypeScript, Python, Rust, Go, and Clang-family servers.

## Example Prompts

- `List all TypeScript files under /home/ubuntu/projects and summarize the biggest ones.`
- `Open the repo, search for auth middleware, and explain how login works.`
- `Run tests in the workspace and show me failing files only.`
- `Create a terminal session, start the dev server, and keep reading the logs.`
- `Stage changed files, commit with a message, and show git status.`
- `Open README.md in the live code-server window and tell me whether the socket bridge is connected.`
- `Run lsp_hover on src/index.ts line 10 column 5 and summarize the result.`
- `Create a UI terminal in code-server and run npm test there if the bridge is available.`

## Smoke Test

```bash
npm run build
npm run smoke
```

## Notes

- Filesystem and terminal tools are designed to run on the same host as `shrinking-server`
- `editor_open_file` now uses the native existing-window socket when available and degrades cleanly when it is not
- `clipboard_write` uses the native socket; `clipboard_read` is best-effort and may report unsupported depending on the server build
- `terminal_ui_*` tools depend on the code-server terminal WebSocket endpoint and degrade when the endpoint is unavailable
- `lsp_*` tools spawn local language servers directly on the host and do not depend on undocumented browser RPC
- Extension install and uninstall use the code-server CLI; enable and disable use folder-level toggling in the extensions directory
