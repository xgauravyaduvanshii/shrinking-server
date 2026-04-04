import { promises as fs } from "node:fs"
import path from "node:path"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { NativeSocketBridge } from "../bridge/NativeSocketBridge.js"
import { ToolContext } from "../context.js"
import { errorResult, successResult } from "../utils/errors.js"
import { execCommand } from "./terminal.js"

function pathToFileUri(filePath: string): string {
  return `file://${filePath}`
}

function replaceRange(content: string, args: {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  newText: string
}): string {
  const lines = content.split(/\r?\n/)
  const before = lines[args.startLine]?.slice(0, args.startColumn) ?? ""
  const after = lines[args.endLine]?.slice(args.endColumn) ?? ""
  const replacement = `${before}${args.newText}${after}`.split(/\r?\n/)
  lines.splice(args.startLine, args.endLine - args.startLine + 1, ...replacement)
  return lines.join("\n")
}

async function ensureNativeSocket(bridge: NativeSocketBridge) {
  if (!bridge.isConnected()) {
    await bridge.connect().catch(() => undefined)
  }
  return bridge.isConnected()
}

function degraded(reason: string, fallback: string, extra: Record<string, unknown> = {}) {
  return successResult({
    success: false,
    degraded: true,
    reason,
    fallback,
    ...extra,
  })
}

export function registerEditorTools(server: McpServer, ctx: ToolContext, nativeSocket: NativeSocketBridge): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  server.registerTool("editor_open_file", {
    description: "Open a file in a live running code-server window using the native CLI socket when available.",
    inputSchema: {
      path: z.string(),
      line: z.number().int().positive().optional(),
      column: z.number().int().positive().optional(),
    },
  }, wrap("editor_open_file", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    ctx.rememberOpenFile(filePath, line ?? 1, column ?? 1)
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      await ctx.client.runCli([filePath]).catch(() => undefined)
      return degraded(
        "Native socket not connected. Run bridge_reconnect or set VSCODE_IPC_HOOK_CLI.",
        "The file was still tracked by MCP and a CLI open was attempted.",
        { path: filePath, line: line ?? 1, column: column ?? 1 },
      )
    }

    const result = await nativeSocket.openFile({
      fileURIs: [pathToFileUri(filePath)],
      line,
      column,
      forceReuseWindow: true,
    })
    return successResult({ path: filePath, line: line ?? 1, column: column ?? 1, ...result })
  }))

  server.registerTool("editor_open_files_batch", {
    description: "Open multiple files in the live code-server window.",
    inputSchema: {
      paths: z.array(z.string()).min(1),
    },
  }, wrap("editor_open_files_batch", async ({ paths }) => {
    const resolved = paths.map((entry) => ctx.resolvePath(entry))
    resolved.forEach((entry) => ctx.rememberOpenFile(entry))
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      return degraded(
        "Native socket not connected. Run bridge_reconnect or set VSCODE_IPC_HOOK_CLI.",
        "Files were tracked locally but could not be opened in the visible window.",
        { paths: resolved },
      )
    }
    const result = await nativeSocket.openFile({ fileURIs: resolved.map(pathToFileUri), forceReuseWindow: true })
    return successResult({ paths: resolved, ...result })
  }))

  server.registerTool("editor_get_status", {
    description: "Get live editor status from the native code-server socket.",
  }, wrap("editor_get_status", async () => {
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      return degraded(
        "Native socket not connected. Run bridge_reconnect or set VSCODE_IPC_HOOK_CLI.",
        "Using MCP tracked editor state only.",
        { activeFile: ctx.editorState.activeFile ?? null, recentFiles: ctx.editorState.recentFiles },
      )
    }
    const status = await nativeSocket.getStatus()
    return successResult({ ...status })
  }))

  server.registerTool("editor_get_active_file", {
    description: "Get the currently active file from the live window when available.",
  }, wrap("editor_get_active_file", async () => {
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      return successResult({ path: ctx.editorState.activeFile ?? null, degraded: true })
    }
    const status = await nativeSocket.getStatus()
    return successResult({ path: status.activeFile ?? null, status })
  }))

  server.registerTool("editor_close_file", {
    description: "Remove a file from MCP tracked editor state.",
    inputSchema: { path: z.string() },
  }, wrap("editor_close_file", async ({ path: target }) => {
    const filePath = ctx.resolvePath(target)
    ctx.editorState.openFiles.delete(filePath)
    if (ctx.editorState.activeFile === filePath) {
      ctx.editorState.activeFile = ctx.editorState.recentFiles.find((entry) => entry !== filePath)
    }
    return successResult({ path: filePath, note: "Native close-current-editor over the socket is not implemented by code-server's CLI pipe." })
  }))

  server.registerTool("editor_list_open_files", {
    description: "List MCP-tracked open files.",
  }, wrap("editor_list_open_files", async () => successResult({
    openFiles: Array.from(ctx.editorState.openFiles.keys()),
  })))

  server.registerTool("editor_save_file", {
    description: "Save a file. Filesystem tools already write directly, so this is a confirmation tool.",
    inputSchema: { path: z.string().optional() },
  }, wrap("editor_save_file", async ({ path: target }) => successResult({
    path: target ? ctx.resolvePath(target) : ctx.editorState.activeFile ?? null,
    saved: true,
  })))

  server.registerTool("editor_save_all", {
    description: "Confirm all tracked files are saved.",
  }, wrap("editor_save_all", async () => successResult({
    savedCount: ctx.editorState.openFiles.size,
  })))

  server.registerTool("editor_set_cursor", {
    description: "Update the tracked cursor location for a file.",
    inputSchema: { path: z.string(), line: z.number().int().positive(), column: z.number().int().positive().optional() },
  }, wrap("editor_set_cursor", async ({ path: target, line, column }) => {
    const filePath = ctx.resolvePath(target)
    ctx.rememberOpenFile(filePath, line, column ?? 1)
    return successResult({ path: filePath, line, column: column ?? 1, degraded: true, note: "Cursor movement is tracked locally; the native code-server pipe does not expose a cursor command." })
  }))

  server.registerTool("editor_get_selection", {
    description: "Read a selection from a file by explicit range.",
    inputSchema: {
      path: z.string(),
      startLine: z.number().int().nonnegative(),
      startColumn: z.number().int().nonnegative(),
      endLine: z.number().int().nonnegative(),
      endColumn: z.number().int().nonnegative(),
    },
  }, wrap("editor_get_selection", async ({ path: target, startLine, startColumn, endLine, endColumn }) => {
    const filePath = ctx.resolvePath(target)
    const content = await fs.readFile(filePath, "utf8")
    const lines = content.split(/\r?\n/)
    const selectionLines = lines.slice(startLine, endLine + 1)
    if (selectionLines.length === 0) {
      return successResult({ path: filePath, selectedText: "" })
    }
    selectionLines[0] = selectionLines[0]?.slice(startColumn) ?? ""
    selectionLines[selectionLines.length - 1] = selectionLines.at(-1)?.slice(0, endColumn) ?? ""
    return successResult({
      path: filePath,
      selectedText: selectionLines.join("\n"),
      range: { startLine, startColumn, endLine, endColumn },
      degraded: true,
    })
  }))

  server.registerTool("editor_replace_selection", {
    description: "Replace a given range in a file.",
    inputSchema: {
      path: z.string(),
      startLine: z.number().int().nonnegative(),
      startColumn: z.number().int().nonnegative(),
      endLine: z.number().int().nonnegative(),
      endColumn: z.number().int().nonnegative(),
      newText: z.string(),
    },
  }, wrap("editor_replace_selection", async ({ path: target, startLine, startColumn, endLine, endColumn, newText }) => {
    ctx.assertWritable()
    const filePath = ctx.resolvePath(target)
    const content = await fs.readFile(filePath, "utf8")
    const updated = replaceRange(content, { startLine, startColumn, endLine, endColumn, newText })
    await fs.writeFile(filePath, updated)
    return successResult({
      path: filePath,
      range: { startLine, startColumn, endLine, endColumn },
      degraded: true,
      note: "Applied directly on disk; the native socket does not expose workspace edits.",
    })
  }))

  server.registerTool("editor_format_document", {
    description: "Format a document using prettier when available.",
    inputSchema: { path: z.string() },
  }, wrap("editor_format_document", async ({ path: target }) => {
    ctx.assertWritable()
    const filePath = ctx.resolvePath(target)
    const result = await execCommand(`npx prettier --write ${JSON.stringify(filePath)}`, path.dirname(filePath), 60_000, process.env)
    return successResult(result)
  }))

  server.registerTool("editor_run_command", {
    description: "Run a limited set of editor commands through the code-server CLI when possible.",
    inputSchema: { command: z.string(), args: z.array(z.any()).optional() },
  }, wrap("editor_run_command", async ({ command, args }) => {
    if (command === "vscode.open" && typeof args?.[0] === "string") {
      const filePath = ctx.resolvePath(args[0])
      return successResult({
        command,
        ...(await (async () => {
          const available = await ensureNativeSocket(nativeSocket)
          if (!available) {
            return { degraded: true, path: filePath }
          }
          return await nativeSocket.openFile({ fileURIs: [pathToFileUri(filePath)], forceReuseWindow: true })
        })()),
      })
    }
    if (command === "workbench.action.reloadWindow") {
      return degraded(
        "Reloading the code-server window is not exposed by the native CLI socket.",
        "Use the browser UI or add a deeper product integration inside code-server.",
        { command },
      )
    }
    return degraded(
      `Unsupported editor command: ${command}`,
      "Use filesystem, LSP, or native open/status tools instead.",
      { command, args: args ?? [] },
    )
  }))

  server.registerTool("editor_get_diagnostics", {
    description: "Diagnostics moved to LSP. This tool remains as a best-effort compatibility wrapper.",
    inputSchema: { path: z.string().optional() },
  }, wrap("editor_get_diagnostics", async ({ path: target }) => successResult({
    path: target ? ctx.resolvePath(target) : ctx.editorState.activeFile ?? null,
    diagnostics: [],
    degraded: true,
    note: "Use lsp_diagnostics for language-server-backed diagnostics.",
  })))

  server.registerTool("editor_set_language", {
    description: "Set a tracked language id for a file in MCP state.",
    inputSchema: { path: z.string(), languageId: z.string() },
  }, wrap("editor_set_language", async ({ path: target, languageId }) => {
    const filePath = ctx.resolvePath(target)
    const state = ctx.editorState.openFiles.get(filePath) ?? { path: filePath, cursorLine: 1, cursorColumn: 1 }
    state.languageId = languageId
    ctx.editorState.openFiles.set(filePath, state)
    return successResult({ path: filePath, languageId, degraded: true })
  }))

  server.registerTool("clipboard_write", {
    description: "Write to the live code-server clipboard through the native socket when available.",
    inputSchema: { text: z.string() },
  }, wrap("clipboard_write", async ({ text }) => {
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      return degraded(
        "Native socket not connected. Clipboard write is unavailable.",
        "Reconnect the bridge or use the browser session directly.",
      )
    }
    return successResult(await nativeSocket.clipboard({ action: "write", text }))
  }))

  server.registerTool("clipboard_read", {
    description: "Read from the clipboard if supported.",
  }, wrap("clipboard_read", async () => {
    const available = await ensureNativeSocket(nativeSocket)
    if (!available) {
      return degraded(
        "Native socket not connected. Clipboard read is unavailable.",
        "Reconnect the bridge or use the browser session directly.",
      )
    }
    return successResult(await nativeSocket.clipboard({ action: "read" }))
  }))
}
