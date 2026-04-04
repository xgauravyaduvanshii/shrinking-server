import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { NativeSocketBridge } from "../bridge/NativeSocketBridge.js"
import { TerminalWebSocket } from "../bridge/TerminalWebSocket.js"
import { HeartbeatManager } from "../bridge/HeartbeatManager.js"
import { detectLanguageServers } from "../bridge/LSPClient.js"
import { ToolContext } from "../context.js"
import { errorResult, successResult } from "../utils/errors.js"

export function registerBridgeTools(
  server: McpServer,
  ctx: ToolContext,
  nativeSocket: NativeSocketBridge,
  terminalWs: TerminalWebSocket,
  heartbeat: HeartbeatManager,
): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  server.registerTool("bridge_status", {
    description: "Report bridge availability and capabilities.",
  }, wrap("bridge_status", async () => successResult({
    nativeSocket: {
      available: nativeSocket.isConnected(),
      socketPath: nativeSocket.getSocketPath(),
      capabilities: ["open_file", "status", "clipboard_write", "extension_management"],
    },
    terminalWebSocket: {
      available: terminalWs.isConnected(),
      capabilities: ["create_terminal", "exec", "read_output", "list", "close", "resize"],
    },
    lsp: {
      available: ctx.config.lspEnabled,
      serversDetected: await detectLanguageServers(),
      capabilities: ["hover", "definition", "references", "completions", "diagnostics", "symbols", "format", "rename"],
    },
    heartbeat: heartbeat.getStatus(),
  })))

  server.registerTool("bridge_reconnect", {
    description: "Reconnect available bridges.",
  }, wrap("bridge_reconnect", async () => {
    const reconnected: string[] = []
    await nativeSocket.connect().then(() => reconnected.push("nativeSocket")).catch(() => undefined)
    await terminalWs.connect(ctx.config.codeServerUrl, await ctx.client.auth.getCookieString()).then(() => reconnected.push("terminalWebSocket")).catch(() => undefined)
    return successResult({ reconnected })
  }))
}
