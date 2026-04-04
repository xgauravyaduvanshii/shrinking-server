import { spawn } from "node:child_process"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { CodeServerClient } from "./client/CodeServerClient.js"
import type { AppConfig, EditorState, TerminalSession } from "./types.js"
import { ToolError } from "./utils/errors.js"
import { ensureWithinAllowedRoots } from "./utils/pathSafety.js"
import { logger } from "./utils/logger.js"

class RateLimiter {
  private readonly timestamps: number[] = []

  constructor(private readonly windowMs: number, private readonly maxRequests: number) {}

  take(): void {
    const now = Date.now()
    while (this.timestamps.length > 0 && now - this.timestamps[0]! > this.windowMs) {
      this.timestamps.shift()
    }
    if (this.timestamps.length >= this.maxRequests) {
      throw new ToolError("Rate limit exceeded", "RATE_LIMITED")
    }
    this.timestamps.push(now)
  }
}

export class ToolContext {
  readonly client: CodeServerClient
  readonly terminalSessions = new Map<string, TerminalSession>()
  readonly editorState: EditorState = { openFiles: new Map(), recentFiles: [] }
  readonly sessionEnv: Record<string, string> = {}
  private readonly limiter: RateLimiter

  constructor(readonly config: AppConfig) {
    this.client = new CodeServerClient(config)
    this.limiter = new RateLimiter(config.rateLimitWindowMs, config.rateLimitMaxRequests)
  }

  async initialize(): Promise<void> {
    await this.client.initialize()
  }

  guardTool(toolName: string, args: Record<string, unknown>): void {
    this.limiter.take()
    logger.info("MCP tool invoked", { toolName, args })
  }

  assertWritable(): void {
    if (this.config.readonlyMode) {
      throw new ToolError("READONLY_MODE=true blocks write and execute operations", "READONLY_MODE")
    }
  }

  resolvePath(inputPath: string): string {
    const absolute = path.resolve(inputPath.startsWith("/") ? inputPath : path.join(this.config.workspaceRoot, inputPath))
    ensureWithinAllowedRoots(absolute, this.config.allowedPaths.length > 0 ? this.config.allowedPaths : [this.config.workspaceRoot])
    return absolute
  }

  async statSafe(inputPath: string) {
    return fs.stat(this.resolvePath(inputPath))
  }

  createTerminalSession(cwd?: string, shell?: string, name?: string): TerminalSession {
    this.assertWritable()
    const sessionId = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const resolvedCwd = this.resolvePath(cwd ?? this.config.workspaceRoot)
    const command = shell ?? process.env.SHELL ?? "/bin/bash"
    const proc = spawn(command, [], {
      cwd: resolvedCwd,
      env: { ...process.env, ...this.sessionEnv },
      stdio: "pipe",
    })
    const session: TerminalSession = {
      id: sessionId,
      name: name ?? sessionId,
      cwd: resolvedCwd,
      shell: command,
      env: { ...process.env, ...this.sessionEnv } as Record<string, string>,
      process: proc,
      buffer: "",
      createdAt: new Date().toISOString(),
    }

    const append = (chunk: Buffer) => {
      session.buffer += chunk.toString()
      if (session.buffer.length > 250_000) {
        session.buffer = session.buffer.slice(-250_000)
      }
    }

    proc.stdout.on("data", append)
    proc.stderr.on("data", append)
    proc.on("close", () => this.terminalSessions.delete(sessionId))
    this.terminalSessions.set(sessionId, session)
    return session
  }

  rememberOpenFile(filePath: string, line = 1, column = 1): void {
    const resolved = this.resolvePath(filePath)
    this.editorState.activeFile = resolved
    this.editorState.openFiles.set(resolved, {
      path: resolved,
      cursorLine: line,
      cursorColumn: column,
    })
    this.editorState.recentFiles = [resolved, ...this.editorState.recentFiles.filter((item) => item !== resolved)].slice(0, 100)
  }
}

export function loadConfig(): AppConfig {
  const workspaceRoot = process.env.CODE_SERVER_WORKSPACE ?? process.cwd()
  const allowedPaths = (process.env.ALLOWED_PATHS ?? workspaceRoot)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

  return {
    codeServerUrl: process.env.CODE_SERVER_URL ?? "http://127.0.0.1:8080",
    codeServerPassword: process.env.CODE_SERVER_PASSWORD,
    codeServerToken: process.env.CODE_SERVER_TOKEN,
    workspaceRoot: path.resolve(workspaceRoot),
    cliCommand: process.env.CODE_SERVER_CLI,
    userDataDir: process.env.CODE_SERVER_USER_DATA_DIR ?? CodeServerClient.defaultUserDataDir(),
    extensionsDir: process.env.CODE_SERVER_EXTENSIONS_DIR ?? path.join(CodeServerClient.defaultUserDataDir(), "extensions"),
    vscodeIpcHookCli: process.env.VSCODE_IPC_HOOK_CLI || undefined,
    codeServerSocketPath: process.env.CODE_SERVER_SOCKET_PATH || undefined,
    transport: process.env.MCP_TRANSPORT === "http" ? "http" : "stdio",
    httpPort: Number(process.env.MCP_HTTP_PORT ?? "3100"),
    readonlyMode: process.env.READONLY_MODE === "true",
    lspEnabled: process.env.MCP_LSP_ENABLED !== "false",
    terminalWsEnabled: process.env.MCP_TERMINAL_WS_ENABLED !== "false",
    allowedPaths: allowedPaths.map((entry) => path.resolve(entry)),
    rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? "60000"),
    rateLimitMaxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? "500"),
  }
}
