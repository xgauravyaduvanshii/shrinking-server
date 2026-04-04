import "dotenv/config"
import http from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { loadConfig, ToolContext } from "./context.js"
import { NativeSocketBridge } from "./bridge/NativeSocketBridge.js"
import { TerminalWebSocket } from "./bridge/TerminalWebSocket.js"
import { HeartbeatManager } from "./bridge/HeartbeatManager.js"
import { registerFilesystemTools } from "./tools/filesystem.js"
import { registerTerminalTools, registerUITerminalTools } from "./tools/terminal.js"
import { registerEditorTools } from "./tools/editor.js"
import { registerLSPTools } from "./tools/lsp.js"
import { registerBridgeTools } from "./tools/bridge.js"
import { registerSearchTools } from "./tools/search.js"
import { registerGitTools } from "./tools/git.js"
import { registerExtensionTools } from "./tools/extensions.js"
import { registerServerTools } from "./tools/server.js"
import { registerResources } from "./resources/index.js"
import { logger } from "./utils/logger.js"

async function main(): Promise<void> {
  const config = loadConfig()
  const ctx = new ToolContext(config)
  await ctx.initialize()
  const nativeSocket = new NativeSocketBridge(config.vscodeIpcHookCli ?? config.codeServerSocketPath)
  await nativeSocket.connect().then(() => {
    logger.info("Native socket bridge connected", { path: nativeSocket.getSocketPath() })
  }).catch((error) => {
    logger.warn("Native socket not available", { error: error instanceof Error ? error.message : String(error) })
  })

  const terminalWs = new TerminalWebSocket()
  if (config.terminalWsEnabled) {
    await terminalWs.connect(config.codeServerUrl, await ctx.client.auth.getCookieString()).then(() => {
      logger.info("Terminal WebSocket bridge connected")
    }).catch((error) => {
      logger.warn("Terminal WebSocket not available", { error: error instanceof Error ? error.message : String(error) })
    })
  }

  const heartbeat = new HeartbeatManager(
    config.codeServerUrl,
    () => ctx.client.auth.getCookieString(),
    async () => {
      await ctx.client.auth.login()
      if (config.terminalWsEnabled) {
        await terminalWs.connect(config.codeServerUrl, await ctx.client.auth.getCookieString()).catch(() => undefined)
      }
    },
  )
  heartbeat.start()

  const server = new McpServer({
    name: "shrinking-server-mcp",
    version: "1.0.0",
  }, {
    instructions: `
This MCP controls a shrinking-server workspace.
Use absolute paths whenever possible.
For interactive work use terminal_create_session and terminal_send_to_session.
Write and exec operations are blocked when READONLY_MODE=true.
    `.trim(),
  })

  registerFilesystemTools(server, ctx)
  registerTerminalTools(server, ctx)
  registerUITerminalTools(server, ctx, terminalWs)
  registerEditorTools(server, ctx, nativeSocket)
  registerLSPTools(server, ctx)
  registerSearchTools(server, ctx)
  registerGitTools(server, ctx)
  registerExtensionTools(server, ctx)
  registerServerTools(server, ctx)
  registerBridgeTools(server, ctx, nativeSocket, terminalWs, heartbeat)
  registerResources(server, ctx)

  if (config.transport === "http") {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    })
    await server.connect(transport)
    const listener = http.createServer(async (req, res) => {
      const body = await new Promise<unknown>((resolve) => {
        if (req.method !== "POST") {
          resolve(undefined)
          return
        }
        let raw = ""
        req.on("data", (chunk) => {
          raw += chunk.toString()
        })
        req.on("end", () => {
          resolve(raw ? JSON.parse(raw) : undefined)
        })
      })
      await transport.handleRequest(req, res, body)
    })
    listener.listen(config.httpPort, () => {
      logger.info("shrinking-server-mcp HTTP transport listening", { port: config.httpPort })
    })
    return
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info("shrinking-server-mcp stdio transport ready", { workspace: config.workspaceRoot })
}

main().catch((error) => {
  logger.error("Fatal MCP startup error", { error: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
})
