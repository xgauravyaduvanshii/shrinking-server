import { spawn } from "node:child_process"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { TerminalWebSocket } from "../bridge/TerminalWebSocket.js"
import { ToolContext } from "../context.js"
import { errorResult, successResult, ToolError } from "../utils/errors.js"

export async function execCommand(
  command: string,
  cwd: string,
  timeout = 60_000,
  env: Record<string, string | undefined> = process.env,
): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const proc = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: "pipe",
    })

    let stdout = ""
    let stderr = ""
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        proc.kill("SIGTERM")
      }
    }, timeout)

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on("close", (code) => {
      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        duration: Date.now() - startedAt,
      })
    })
  })
}

export function registerTerminalTools(server: McpServer, ctx: ToolContext): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  server.registerTool("terminal_exec", {
    description: "Execute a shell command on the code-server host.",
    inputSchema: {
      command: z.string(),
      cwd: z.string().optional(),
      timeout: z.number().int().positive().optional(),
      env: z.record(z.string()).optional(),
    },
  }, wrap("terminal_exec", async ({ command, cwd, timeout, env }) => {
    ctx.assertWritable()
    const result = await execCommand(command, ctx.resolvePath(cwd ?? ctx.config.workspaceRoot), timeout ?? 60_000, {
      ...process.env,
      ...ctx.sessionEnv,
      ...env,
    })
    return successResult(result)
  }))

  server.registerTool("terminal_exec_stream", {
    description: "Execute a command and return output split into lines.",
    inputSchema: {
      command: z.string(),
      cwd: z.string().optional(),
    },
  }, wrap("terminal_exec_stream", async ({ command, cwd }) => {
    ctx.assertWritable()
    const result = await execCommand(command, ctx.resolvePath(cwd ?? ctx.config.workspaceRoot), 60_000, {
      ...process.env,
      ...ctx.sessionEnv,
    })
    return successResult({
      ...result,
      lines: `${result.stdout}${result.stderr}`.split(/\r?\n/).filter(Boolean),
    })
  }))

  server.registerTool("terminal_create_session", {
    description: "Create a persistent terminal session.",
    inputSchema: { name: z.string().optional(), cwd: z.string().optional(), shell: z.string().optional() },
  }, wrap("terminal_create_session", async ({ name, cwd, shell }) => {
    const session = ctx.createTerminalSession(cwd, shell, name)
    return successResult({ sessionId: session.id, cwd: session.cwd, shell: session.shell })
  }))

  server.registerTool("terminal_send_to_session", {
    description: "Send input to an existing terminal session.",
    inputSchema: { sessionId: z.string(), input: z.string() },
  }, wrap("terminal_send_to_session", async ({ sessionId, input }) => {
    const session = ctx.terminalSessions.get(sessionId)
    if (!session) {
      throw new ToolError(`Unknown terminal session: ${sessionId}`, "UNKNOWN_SESSION")
    }
    session.process.stdin.write(input)
    if (!input.endsWith("\n")) {
      session.process.stdin.write("\n")
    }
    return successResult({ sessionId, buffer: session.buffer })
  }))

  server.registerTool("terminal_read_session", {
    description: "Read the current output buffer for a terminal session.",
    inputSchema: { sessionId: z.string() },
  }, wrap("terminal_read_session", async ({ sessionId }) => {
    const session = ctx.terminalSessions.get(sessionId)
    if (!session) {
      throw new ToolError(`Unknown terminal session: ${sessionId}`, "UNKNOWN_SESSION")
    }
    return successResult({ sessionId, output: session.buffer })
  }))

  server.registerTool("terminal_close_session", {
    description: "Close a terminal session.",
    inputSchema: { sessionId: z.string() },
  }, wrap("terminal_close_session", async ({ sessionId }) => {
    const session = ctx.terminalSessions.get(sessionId)
    if (!session) {
      throw new ToolError(`Unknown terminal session: ${sessionId}`, "UNKNOWN_SESSION")
    }
    session.process.kill("SIGTERM")
    ctx.terminalSessions.delete(sessionId)
    return successResult({ sessionId })
  }))

  server.registerTool("terminal_list_sessions", {
    description: "List open terminal sessions.",
  }, wrap("terminal_list_sessions", async () => successResult({
    sessions: Array.from(ctx.terminalSessions.values()).map((session) => ({
      id: session.id,
      name: session.name,
      cwd: session.cwd,
      shell: session.shell,
      createdAt: session.createdAt,
    })),
  })))

  server.registerTool("terminal_kill_process", {
    description: "Kill a process by PID.",
    inputSchema: { pid: z.number().int().positive(), signal: z.string().optional() },
  }, wrap("terminal_kill_process", async ({ pid, signal }) => {
    ctx.assertWritable()
    process.kill(pid, (signal ?? "SIGTERM") as NodeJS.Signals)
    return successResult({ pid, signal: signal ?? "SIGTERM" })
  }))

  server.registerTool("terminal_list_processes", {
    description: "List processes on the host.",
    inputSchema: { filter: z.string().optional() },
  }, wrap("terminal_list_processes", async ({ filter }) => {
    const result = await execCommand("ps -eo pid,ppid,comm,%cpu,%mem,args --no-headers", ctx.config.workspaceRoot, 30_000)
    const lines = result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => (filter ? line.includes(filter) : true))
    return successResult({ processes: lines })
  }))

  server.registerTool("terminal_get_env", {
    description: "Get an environment variable value.",
    inputSchema: { variable: z.string() },
  }, wrap("terminal_get_env", async ({ variable }) => successResult({ variable, value: ctx.sessionEnv[variable] ?? process.env[variable] ?? null })))

  server.registerTool("terminal_set_env", {
    description: "Set an environment variable for future commands.",
    inputSchema: { variable: z.string(), value: z.string() },
  }, wrap("terminal_set_env", async ({ variable, value }) => {
    ctx.assertWritable()
    ctx.sessionEnv[variable] = value
    return successResult({ variable, value })
  }))

  server.registerTool("terminal_exec_script", {
    description: "Create a temporary script file and execute it.",
    inputSchema: {
      content: z.string(),
      interpreter: z.string().optional(),
      args: z.array(z.string()).optional(),
    },
  }, wrap("terminal_exec_script", async ({ content, interpreter, args }) => {
    ctx.assertWritable()
    const tempPath = `${ctx.config.workspaceRoot}/.mcp-script-${Date.now()}.sh`
    const resolved = ctx.resolvePath(tempPath)
    await import("node:fs/promises").then((mod) => mod.writeFile(resolved, content, { mode: 0o700 }))
    const command = `${interpreter ?? "/bin/bash"} ${JSON.stringify(resolved)} ${(args ?? []).map((item) => JSON.stringify(item)).join(" ")}`
    const result = await execCommand(command, ctx.config.workspaceRoot, 60_000, { ...process.env, ...ctx.sessionEnv })
    await import("node:fs/promises").then((mod) => mod.rm(resolved, { force: true }))
    return successResult(result)
  }))
}

export function registerUITerminalTools(server: McpServer, ctx: ToolContext, terminalWs: TerminalWebSocket): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  const ensureUiTerminal = async () => {
    if (!terminalWs.isConnected()) {
      return false
    }
    return true
  }

  const degraded = (reason: string, fallback: string, extra: Record<string, unknown> = {}) => successResult({
    success: false,
    degraded: true,
    reason,
    fallback,
    ...extra,
  })

  server.registerTool("terminal_ui_create", {
    description: "Create a terminal visible in the code-server UI.",
    inputSchema: { cwd: z.string().optional(), cols: z.number().int().positive().optional(), rows: z.number().int().positive().optional() },
  }, wrap("terminal_ui_create", async ({ cwd, cols, rows }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_create_session or terminal_exec.")
    }
    const terminalId = await terminalWs.create({
      cwd: cwd ? ctx.resolvePath(cwd) : undefined,
      cols,
      rows,
    })
    return successResult({ terminalId })
  }))

  server.registerTool("terminal_ui_exec", {
    description: "Execute a command in a real visible code-server terminal.",
    inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().int().positive().optional(), keepAlive: z.boolean().optional() },
  }, wrap("terminal_ui_exec", async ({ command, cwd, timeoutMs, keepAlive }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_exec for host-side execution.")
    }
    const result = await terminalWs.execNew(command, {
      timeoutMs,
      cwd: cwd ? ctx.resolvePath(cwd) : undefined,
      keepAlive,
    })
    return successResult(result)
  }))

  server.registerTool("terminal_ui_send", {
    description: "Send raw input to a visible UI terminal.",
    inputSchema: { terminalId: z.number().int().positive(), input: z.string() },
  }, wrap("terminal_ui_send", async ({ terminalId, input }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_send_to_session for MCP-managed shell sessions.")
    }
    await terminalWs.send(terminalId, input)
    return successResult({ terminalId })
  }))

  server.registerTool("terminal_ui_read", {
    description: "Read buffered output from a visible UI terminal.",
    inputSchema: { terminalId: z.number().int().positive() },
  }, wrap("terminal_ui_read", async ({ terminalId }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_read_session for MCP-managed shell sessions.")
    }
    return successResult({ terminalId, output: terminalWs.read(terminalId) })
  }))

  server.registerTool("terminal_ui_list", {
    description: "List terminals open in code-server UI.",
  }, wrap("terminal_ui_list", async () => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_list_sessions for MCP-managed shell sessions.")
    }
    return successResult({ terminals: await terminalWs.list() })
  }))

  server.registerTool("terminal_ui_close", {
    description: "Close a visible UI terminal.",
    inputSchema: { terminalId: z.number().int().positive() },
  }, wrap("terminal_ui_close", async ({ terminalId }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_close_session for MCP-managed shell sessions.")
    }
    await terminalWs.close(terminalId)
    return successResult({ terminalId })
  }))

  server.registerTool("terminal_ui_resize", {
    description: "Resize a visible UI terminal.",
    inputSchema: { terminalId: z.number().int().positive(), cols: z.number().int().positive(), rows: z.number().int().positive() },
  }, wrap("terminal_ui_resize", async ({ terminalId, cols, rows }) => {
    if (!await ensureUiTerminal()) {
      return degraded("Terminal UI WebSocket is not connected.", "Use terminal_create_session with a shell for local persistent work.")
    }
    await terminalWs.resize(terminalId, cols, rows)
    return successResult({ terminalId, cols, rows })
  }))
}
