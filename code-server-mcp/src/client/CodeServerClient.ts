import path from "node:path"
import os from "node:os"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fetch from "node-fetch"
import { CodeServerAuth } from "./auth.js"
import { CodeServerWebSocket } from "./websocket.js"
import type { AppConfig } from "../types.js"

const execFileAsync = promisify(execFile)

export class CodeServerClient {
  readonly auth: CodeServerAuth
  readonly websocket: CodeServerWebSocket

  constructor(readonly config: AppConfig) {
    this.auth = new CodeServerAuth(config.codeServerUrl, config.codeServerPassword, config.codeServerToken)
    this.websocket = new CodeServerWebSocket()
  }

  async initialize(): Promise<void> {
    await this.auth.login()
  }

  async health(): Promise<{ healthy: boolean; latency: number }> {
    const startedAt = Date.now()
    const headers = await this.auth.getAuthHeaders()
    const response = await fetch(this.auth.buildUrl("/healthz"), { headers })
    return { healthy: response.ok, latency: Date.now() - startedAt }
  }

  async fetchText(resourcePath: string): Promise<string> {
    await this.auth.refreshIfNeeded()
    const headers = await this.auth.getAuthHeaders()
    const response = await fetch(this.auth.buildUrl(resourcePath), { headers })
    return response.text()
  }

  getCliInvocation(extraArgs: string[] = []): { command: string; args: string[] } {
    if (this.config.cliCommand) {
      return { command: this.config.cliCommand, args: extraArgs }
    }

    const repoCli = path.resolve(process.cwd(), "..", "out", "node", "entry.js")
    return { command: process.execPath, args: [repoCli, ...extraArgs] }
  }

  async runCli(extraArgs: string[] = []): Promise<{ stdout: string; stderr: string }> {
    const invocation = this.getCliInvocation(extraArgs)
    return execFileAsync(invocation.command, invocation.args, {
      env: process.env,
      cwd: this.config.workspaceRoot,
      maxBuffer: 10 * 1024 * 1024,
    })
  }

  async getVersion(): Promise<string> {
    try {
      const { stdout } = await this.runCli(["--version"])
      return stdout.trim()
    } catch {
      return "unknown"
    }
  }

  static defaultUserDataDir(): string {
    return path.join(os.homedir(), ".local", "share", "code-server")
  }
}
