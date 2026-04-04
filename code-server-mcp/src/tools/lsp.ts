import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { detectLanguageServers, getServerForFile, LSPClient } from "../bridge/LSPClient.js"
import { ToolContext } from "../context.js"
import { errorResult, successResult } from "../utils/errors.js"

function pathToFileUri(filePath: string): string {
  return `file://${filePath}`
}

function fileUriToPath(uri: string): string {
  return uri.replace(/^file:\/\//, "")
}

export function registerLSPTools(server: McpServer, ctx: ToolContext): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  const clients = new Map<string, LSPClient>()

  const getClient = async (filePath: string): Promise<LSPClient | null> => {
    if (!ctx.config.lspEnabled) {
      return null
    }
    const command = getServerForFile(filePath)
    if (!command) {
      return null
    }
    let client = clients.get(command)
    if (!client) {
      client = new LSPClient(command, ctx.config.workspaceRoot)
      await client.initialize()
      clients.set(command, client)
    }
    return client
  }

  const withDocument = async <T>(filePath: string, fn: (client: LSPClient, uri: string) => Promise<T>): Promise<T | { success: false; error: string }> => {
    const client = await getClient(filePath)
    if (!client) {
      return { success: false, error: `No language server available for ${path.extname(filePath) || "this file type"}` }
    }
    const uri = pathToFileUri(filePath)
    await client.primeDocument(filePath)
    return fn(client, uri)
  }

  server.registerTool("lsp_servers_available", {
    description: "List detected language servers available on the host.",
  }, wrap("lsp_servers_available", async () => successResult(await detectLanguageServers())))

  server.registerTool("lsp_hover", {
    description: "Get hover information from a language server.",
    inputSchema: { path: z.string(), line: z.number().int().nonnegative(), column: z.number().int().nonnegative() },
  }, wrap("lsp_hover", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.hover(uri, { line, character: column }))
    return successResult({ result: result ?? null })
  }))

  server.registerTool("lsp_definition", {
    description: "Go to definition using a language server.",
    inputSchema: { path: z.string(), line: z.number().int().nonnegative(), column: z.number().int().nonnegative() },
  }, wrap("lsp_definition", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.definition(uri, { line, character: column }))
    return successResult({
      result: Array.isArray(result) ? result.map((entry) => ({ file: fileUriToPath(entry.uri), line: entry.range.start.line, column: entry.range.start.character })) : result,
    })
  }))

  server.registerTool("lsp_references", {
    description: "Find references using a language server.",
    inputSchema: { path: z.string(), line: z.number().int().nonnegative(), column: z.number().int().nonnegative() },
  }, wrap("lsp_references", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.references(uri, { line, character: column }))
    return successResult({
      result: Array.isArray(result) ? result.map((entry) => ({ file: fileUriToPath(entry.uri), line: entry.range.start.line, column: entry.range.start.character })) : result,
    })
  }))

  server.registerTool("lsp_completions", {
    description: "Get completions using a language server.",
    inputSchema: { path: z.string(), line: z.number().int().nonnegative(), column: z.number().int().nonnegative() },
  }, wrap("lsp_completions", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.completion(uri, { line, character: column }))
    return successResult({ result })
  }))

  server.registerTool("lsp_symbols", {
    description: "Get document symbols from a language server.",
    inputSchema: { path: z.string() },
  }, wrap("lsp_symbols", async ({ path: target }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.documentSymbols(uri))
    return successResult({ result })
  }))

  server.registerTool("lsp_diagnostics", {
    description: "Get diagnostics from a language server.",
    inputSchema: { path: z.string(), waitMs: z.number().int().positive().optional() },
  }, wrap("lsp_diagnostics", async ({ path: target, waitMs }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.getDiagnostics(uri, waitMs))
    return successResult({ result })
  }))

  server.registerTool("lsp_format", {
    description: "Get formatting edits from a language server.",
    inputSchema: { path: z.string() },
  }, wrap("lsp_format", async ({ path: target }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.formatDocument(uri))
    return successResult({ result })
  }))

  server.registerTool("lsp_rename", {
    description: "Rename a symbol using a language server.",
    inputSchema: {
      path: z.string(),
      line: z.number().int().nonnegative(),
      column: z.number().int().nonnegative(),
      newName: z.string(),
    },
  }, wrap("lsp_rename", async ({ path: target, line, column, newName }) => {
    const filePath = ctx.resolvePath(target)
    const result = await withDocument(filePath, async (client, uri) => client.rename(uri, { line, character: column }, newName))
    return successResult({ result })
  }))
}
