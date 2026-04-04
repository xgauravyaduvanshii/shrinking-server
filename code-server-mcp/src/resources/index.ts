import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import { ToolContext } from "../context.js"

export function registerResources(server: McpServer, ctx: ToolContext): void {
  server.registerResource("server-info", "codeserver://server/info", {
    title: "shrinking-server info",
    mimeType: "application/json",
  }, async () => ({
    contents: [{
      uri: "codeserver://server/info",
      mimeType: "application/json",
      text: JSON.stringify({
        url: ctx.config.codeServerUrl,
        workspace: ctx.config.workspaceRoot,
        readonlyMode: ctx.config.readonlyMode,
      }, null, 2),
    }],
  }))

  server.registerResource("workspace-file", new ResourceTemplate("workspace://file/{path}", { list: undefined }), {
    title: "Workspace file",
    mimeType: "text/plain",
  }, async (uri: URL, variables: Record<string, string | string[]>) => {
    const target = Array.isArray(variables.path) ? variables.path[0] : variables.path
    const filePath = ctx.resolvePath(target ?? "")
    const content = await import("node:fs/promises").then((mod) => mod.readFile(filePath, "utf8"))
    return {
      contents: [{
        uri: uri.toString(),
        mimeType: "text/plain",
        text: content,
      }],
    }
  })

  server.registerResource("terminal-session", new ResourceTemplate("terminal://session/{sessionId}", { list: undefined }), {
    title: "Terminal session output",
    mimeType: "text/plain",
  }, async (uri: URL, variables: Record<string, string | string[]>) => {
    const sessionId = Array.isArray(variables.sessionId) ? variables.sessionId[0] : variables.sessionId
    const session = sessionId ? ctx.terminalSessions.get(sessionId) : undefined
    return {
      contents: [{
        uri: uri.toString(),
        mimeType: "text/plain",
        text: session?.buffer ?? "",
      }],
    }
  })
}
