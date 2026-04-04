import type { JsonRecord } from "../types.js"

export class ToolError extends Error {
  constructor(message: string, public readonly code = "TOOL_ERROR") {
    super(message)
    this.name = "ToolError"
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === "string") {
    return error
  }
  return "Unknown error"
}

export function successResult(payload: JsonRecord = {}) {
  const body = { success: true, ...payload }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
  }
}

export function errorResult(error: unknown, extra: JsonRecord = {}) {
  const body = {
    success: false,
    error: toErrorMessage(error),
    ...extra,
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
  }
}
