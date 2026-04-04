import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { promises as fs } from "node:fs"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { CompletionItem, DiagnosticResult, DocumentSymbol, HoverResult, Location, Position, Range } from "./types.js"

const execFileAsync = promisify(execFile)

function encodeMessage(payload: unknown): string {
  const body = JSON.stringify(payload)
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
}

function severityFromLsp(value?: number): DiagnosticResult["severity"] {
  switch (value) {
    case 1:
      return "error"
    case 2:
      return "warning"
    case 3:
      return "info"
    default:
      return "hint"
  }
}

function kindToString(value?: number): string {
  return typeof value === "number" ? String(value) : "unknown"
}

function languageIdForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".ts":
      return "typescript"
    case ".tsx":
      return "typescriptreact"
    case ".js":
      return "javascript"
    case ".jsx":
      return "javascriptreact"
    case ".py":
      return "python"
    case ".rs":
      return "rust"
    case ".go":
      return "go"
    case ".c":
      return "c"
    case ".cpp":
    case ".cc":
    case ".cxx":
    case ".hpp":
    case ".h":
      return "cpp"
    default:
      return ext.slice(1) || "plaintext"
  }
}

export async function detectLanguageServers(): Promise<Record<string, string>> {
  const checks: Array<[string, string[]]> = [
    ["typescript", ["typescript-language-server", "--stdio"]],
    ["python", ["pylsp"]],
    ["pyright", ["pyright-langserver", "--stdio"]],
    ["rust", ["rust-analyzer"]],
    ["go", ["gopls"]],
    ["c_cpp", ["clangd"]],
  ]
  const found: Record<string, string> = {}
  for (const [key, cmd] of checks) {
    try {
      const result = await execFileAsync("bash", ["-lc", `command -v ${cmd[0]}`])
      const location = result.stdout.trim()
      if (location) {
        found[key] = location
      }
    } catch {
      // ignore
    }
  }
  return found
}

export function getServerForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase()
  if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
    return "typescript-language-server --stdio"
  }
  if (ext === ".py") {
    return "pylsp"
  }
  if (ext === ".rs") {
    return "rust-analyzer"
  }
  if (ext === ".go") {
    return "gopls"
  }
  if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(ext)) {
    return "clangd --stdio"
  }
  return null
}

export class LSPClient {
  private process: ChildProcessWithoutNullStreams | null = null
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (error: unknown) => void }>()
  private nextId = 1
  private diagnosticsCache = new Map<string, DiagnosticResult[]>()
  private initialized = false
  private readBuffer = ""

  constructor(private readonly serverCommand: string, private readonly workspaceRoot: string) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }
    const [command, ...args] = this.serverCommand.split(/\s+/)
    this.process = spawn(command!, args, {
      cwd: this.workspaceRoot,
      stdio: "pipe",
      shell: false,
    })
    this.process.stdout.on("data", (chunk: Buffer) => this.handleData(chunk.toString("utf8")))
    this.process.stderr.on("data", () => {
      // ignore noisy stderr from language servers
    })
    await this.request("initialize", {
      processId: process.pid,
      rootUri: `file://${this.workspaceRoot}`,
      capabilities: {},
      workspaceFolders: [{ uri: `file://${this.workspaceRoot}`, name: path.basename(this.workspaceRoot) }],
    })
    this.notify("initialized", {})
    this.initialized = true
  }

  async openDocument(uri: string, content: string, languageId: string): Promise<void> {
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    })
  }

  async closeDocument(uri: string): Promise<void> {
    this.notify("textDocument/didClose", { textDocument: { uri } })
  }

  async hover(uri: string, position: Position): Promise<HoverResult | null> {
    const result = await this.request("textDocument/hover", { textDocument: { uri }, position })
    if (!result) {
      return null
    }
    const contents = Array.isArray(result.contents)
      ? result.contents.map((entry: any) => typeof entry === "string" ? entry : entry.value ?? JSON.stringify(entry)).join("\n")
      : typeof result.contents === "string"
        ? result.contents
        : result.contents?.value ?? JSON.stringify(result.contents)
    return {
      contents,
      range: result.range,
    }
  }

  async definition(uri: string, position: Position): Promise<Location[]> {
    return (await this.request("textDocument/definition", { textDocument: { uri }, position })) ?? []
  }

  async references(uri: string, position: Position): Promise<Location[]> {
    return (await this.request("textDocument/references", { textDocument: { uri }, position, context: { includeDeclaration: true } })) ?? []
  }

  async completion(uri: string, position: Position): Promise<CompletionItem[]> {
    const result = await this.request("textDocument/completion", { textDocument: { uri }, position })
    const items = Array.isArray(result) ? result : result?.items ?? []
    return items.map((item: any) => ({
      label: item.label,
      kind: kindToString(item.kind),
      detail: item.detail,
      documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
      insertText: item.insertText,
    }))
  }

  async documentSymbols(uri: string): Promise<DocumentSymbol[]> {
    const result = await this.request("textDocument/documentSymbol", { textDocument: { uri } })
    return (result ?? []).map((item: any) => ({
      name: item.name,
      kind: kindToString(item.kind),
      range: item.range,
      selectionRange: item.selectionRange ?? item.range,
      children: item.children,
    }))
  }

  async getDiagnostics(uri: string, waitMs = 1000): Promise<DiagnosticResult[]> {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
    return this.diagnosticsCache.get(uri) ?? []
  }

  async formatDocument(uri: string): Promise<Array<{ range: Range; newText: string }>> {
    return (await this.request("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    })) ?? []
  }

  async rename(uri: string, position: Position, newName: string): Promise<Record<string, Array<{ range: Range; newText: string }>>> {
    const result = await this.request("textDocument/rename", {
      textDocument: { uri },
      position,
      newName,
    })
    return result?.changes ?? {}
  }

  private async request(method: string, params: any): Promise<any> {
    if (!this.process) {
      throw new Error("LSP client is not running")
    }
    const id = this.nextId++
    const payload = { jsonrpc: "2.0", id, method, params }
    this.process.stdin.write(encodeMessage(payload))
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
    })
  }

  private notify(method: string, params: any): void {
    if (!this.process) {
      return
    }
    this.process.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }))
  }

  private handleData(chunk: string): void {
    this.readBuffer += chunk
    while (true) {
      const splitIndex = this.readBuffer.indexOf("\r\n\r\n")
      if (splitIndex === -1) {
        return
      }
      const header = this.readBuffer.slice(0, splitIndex)
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!lengthMatch) {
        this.readBuffer = ""
        return
      }
      const contentLength = Number(lengthMatch[1])
      const bodyStart = splitIndex + 4
      const bodyEnd = bodyStart + contentLength
      if (this.readBuffer.length < bodyEnd) {
        return
      }
      const body = this.readBuffer.slice(bodyStart, bodyEnd)
      this.readBuffer = this.readBuffer.slice(bodyEnd)
      const parsed = JSON.parse(body)
      if (typeof parsed.id === "number" && this.pendingRequests.has(parsed.id)) {
        const pending = this.pendingRequests.get(parsed.id)!
        this.pendingRequests.delete(parsed.id)
        if (parsed.error) {
          pending.reject(parsed.error)
        } else {
          pending.resolve(parsed.result)
        }
      } else if (parsed.method === "textDocument/publishDiagnostics") {
        const uri = parsed.params?.uri
        if (typeof uri === "string") {
          this.diagnosticsCache.set(uri, (parsed.params?.diagnostics ?? []).map((item: any) => ({
            range: item.range,
            message: item.message,
            severity: severityFromLsp(item.severity),
            source: item.source,
            code: item.code,
          })))
        }
      }
    }
  }

  async primeDocument(filePath: string): Promise<string> {
    const content = await fs.readFile(filePath, "utf8")
    const uri = `file://${filePath}`
    await this.openDocument(uri, content, languageIdForFile(filePath))
    return uri
  }

  async shutdown(): Promise<void> {
    if (!this.process) {
      return
    }
    try {
      await this.request("shutdown", {})
      this.notify("exit", {})
    } finally {
      this.process.kill("SIGTERM")
      this.process = null
      this.initialized = false
    }
  }

  isRunning(): boolean {
    return Boolean(this.process && !this.process.killed)
  }
}
