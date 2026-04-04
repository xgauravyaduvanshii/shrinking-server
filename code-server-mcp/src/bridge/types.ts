export interface OpenFileArgs {
  fileURIs: string[]
  line?: number
  column?: number
  forceReuseWindow?: boolean
  waitForClose?: boolean
}

export interface StatusResult {
  pid?: number
  workspaceFolder?: string
  activeFile?: string
  focused?: boolean
  instanceId?: string
  raw?: unknown
}

export interface ClipboardArgs {
  action: "read" | "write"
  text?: string
}

export interface NativeBridgeResult {
  result: "ok" | "error"
  message?: string
  raw?: unknown
}

export interface TerminalInfo {
  id: number
  title?: string
  pid?: number
  cwd?: string
}

export interface Position {
  line: number
  character: number
}

export interface Range {
  start: Position
  end: Position
}

export interface Location {
  uri: string
  range: Range
}

export interface HoverResult {
  contents: string
  range?: Range
}

export interface DiagnosticResult {
  range: Range
  message: string
  severity: "error" | "warning" | "info" | "hint"
  source?: string
  code?: string | number
}

export interface CompletionItem {
  label: string
  kind: string
  detail?: string
  documentation?: string
  insertText?: string
}

export interface DocumentSymbol {
  name: string
  kind: string
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}
