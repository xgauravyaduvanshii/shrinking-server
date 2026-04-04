import { ChildProcessWithoutNullStreams } from "node:child_process"

export type JsonRecord = Record<string, unknown>

export interface TerminalSession {
  id: string
  name: string
  cwd: string
  shell: string
  env: Record<string, string>
  process: ChildProcessWithoutNullStreams
  buffer: string
  createdAt: string
}

export interface EditorFileState {
  path: string
  cursorLine: number
  cursorColumn: number
  selection?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
  languageId?: string
}

export interface EditorState {
  activeFile?: string
  openFiles: Map<string, EditorFileState>
  recentFiles: string[]
}

export interface AppConfig {
  codeServerUrl: string
  codeServerPassword?: string
  codeServerToken?: string
  workspaceRoot: string
  cliCommand?: string
  vscodeIpcHookCli?: string
  codeServerSocketPath?: string
  userDataDir: string
  extensionsDir: string
  transport: "stdio" | "http"
  httpPort: number
  readonlyMode: boolean
  lspEnabled: boolean
  terminalWsEnabled: boolean
  allowedPaths: string[]
  rateLimitWindowMs: number
  rateLimitMaxRequests: number
}
