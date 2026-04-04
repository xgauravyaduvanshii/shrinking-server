import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import type { TerminalInfo } from "./types.js"

type PendingListRequest = {
  resolve: (value: TerminalInfo[]) => void
  reject: (error: unknown) => void
}

export class TerminalWebSocket {
  private ws: WebSocket | null = null
  private connected = false
  private outputBuffers = new Map<number, string>()
  private listeners = new Map<number, Array<(data: string) => void>>()
  private pendingListRequest: PendingListRequest | null = null
  private pendingCreates: Array<(id: number) => void> = []

  async connect(serverUrl: string, sessionCookie: string): Promise<void> {
    const target = new URL("/terminal", serverUrl)
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(target, {
        headers: sessionCookie ? { cookie: sessionCookie } : {},
      })
      ws.on("open", () => {
        this.ws = ws
        this.connected = true
        resolve()
      })
      ws.on("message", (data) => {
        this.handleMessage(data.toString())
      })
      ws.on("close", () => {
        this.connected = false
      })
      ws.on("error", reject)
    })
  }

  async create(opts?: { cols?: number; rows?: number; cwd?: string }): Promise<number> {
    const ws = this.requireSocket()
    return new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal creation")), 10_000)
      this.pendingCreates.push((id) => {
        clearTimeout(timer)
        resolve(id)
      })
      ws.send(JSON.stringify({
        type: "create",
        cols: opts?.cols ?? 220,
        rows: opts?.rows ?? 50,
        cwd: opts?.cwd,
      }))
    })
  }

  async send(terminalId: number, input: string): Promise<void> {
    this.requireSocket().send(JSON.stringify({ type: "input", id: terminalId, data: input }))
  }

  async exec(terminalId: number, command: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<string> {
    const sentinel = `__DONE_${randomUUID()}__`
    const cwdPrefix = opts?.cwd ? `cd ${JSON.stringify(opts.cwd)} && ` : ""
    await this.send(terminalId, `${cwdPrefix}${command}; echo ${sentinel}\n`)
    const startedAt = Date.now()
    const timeoutMs = opts?.timeoutMs ?? 30_000
    return new Promise<string>((resolve, reject) => {
      const dispose = this.onOutput(terminalId, () => {
        const buffer = this.outputBuffers.get(terminalId) ?? ""
        if (buffer.includes(sentinel)) {
          dispose()
          resolve(buffer.replace(sentinel, "").trim())
        } else if (Date.now() - startedAt > timeoutMs) {
          dispose()
          reject(new Error("Timed out waiting for terminal output"))
        }
      })
    })
  }

  async execNew(command: string, opts?: { timeoutMs?: number; cwd?: string; keepAlive?: boolean }): Promise<{ terminalId: number; output: string }> {
    const terminalId = await this.create({ cwd: opts?.cwd })
    const output = await this.exec(terminalId, command, opts)
    if (!opts?.keepAlive) {
      await this.close(terminalId).catch(() => undefined)
    }
    return { terminalId, output }
  }

  read(terminalId: number): string {
    const buffer = this.outputBuffers.get(terminalId) ?? ""
    this.outputBuffers.set(terminalId, "")
    return buffer
  }

  onOutput(terminalId: number, callback: (data: string) => void): () => void {
    const listeners = this.listeners.get(terminalId) ?? []
    listeners.push(callback)
    this.listeners.set(terminalId, listeners)
    return () => {
      const updated = (this.listeners.get(terminalId) ?? []).filter((entry) => entry !== callback)
      this.listeners.set(terminalId, updated)
    }
  }

  async list(): Promise<TerminalInfo[]> {
    const ws = this.requireSocket()
    return new Promise<TerminalInfo[]>((resolve, reject) => {
      this.pendingListRequest = { resolve, reject }
      ws.send(JSON.stringify({ type: "list" }))
      setTimeout(() => {
        if (this.pendingListRequest) {
          this.pendingListRequest = null
          reject(new Error("Timed out waiting for terminal list"))
        }
      }, 10_000)
    })
  }

  async resize(terminalId: number, cols: number, rows: number): Promise<void> {
    this.requireSocket().send(JSON.stringify({ type: "resize", id: terminalId, cols, rows }))
  }

  async close(terminalId: number): Promise<void> {
    this.requireSocket().send(JSON.stringify({ type: "kill", id: terminalId }))
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  private requireSocket(): WebSocket {
    if (!this.ws || !this.connected) {
      throw new Error("Terminal WebSocket is not connected")
    }
    return this.ws
  }

  private handleMessage(raw: string): void {
    const trimmed = raw.trim()
    if (!trimmed) {
      return
    }

    let parsed: { type?: string; id?: number; data?: string; terminals?: TerminalInfo[] }
    try {
      parsed = JSON.parse(trimmed) as { type?: string; id?: number; data?: string; terminals?: TerminalInfo[] }
    } catch {
      // Some deployments emit non-JSON frames on the terminal socket. Ignore
      // them so the MCP server keeps running and terminal UI tools can degrade
      // gracefully when needed.
      return
    }

    if (parsed.type === "data" && typeof parsed.id === "number") {
      const next = `${this.outputBuffers.get(parsed.id) ?? ""}${parsed.data ?? ""}`
      this.outputBuffers.set(parsed.id, next)
      for (const listener of this.listeners.get(parsed.id) ?? []) {
        listener(parsed.data ?? "")
      }
      return
    }
    if (parsed.type === "terminals" && this.pendingListRequest) {
      this.pendingListRequest.resolve(parsed.terminals ?? [])
      this.pendingListRequest = null
      return
    }
    if (parsed.type === "created" && typeof parsed.id === "number") {
      const next = this.pendingCreates.shift()
      next?.(parsed.id)
    }
  }
}
