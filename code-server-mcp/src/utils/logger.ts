type LogLevel = "debug" | "info" | "warn" | "error"

const REDACT_KEYS = ["password", "token", "authorization", "cookie", "session"]

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry))
  }
  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (REDACT_KEYS.some((item) => key.toLowerCase().includes(item))) {
        return [key, "[REDACTED]"]
      }
      return [key, sanitize(entry)]
    }),
  )
}

function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const sanitizedFields = sanitize(fields)
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(sanitizedFields && typeof sanitizedFields === "object" ? sanitizedFields : {}),
  }
  process.stderr.write(`${JSON.stringify(payload)}\n`)
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
  sanitize,
}
