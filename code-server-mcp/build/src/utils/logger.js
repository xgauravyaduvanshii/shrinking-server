const REDACT_KEYS = ["password", "token", "authorization", "cookie", "session"];
function sanitize(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitize(entry));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
        if (REDACT_KEYS.some((item) => key.toLowerCase().includes(item))) {
            return [key, "[REDACTED]"];
        }
        return [key, sanitize(entry)];
    }));
}
function log(level, message, fields = {}) {
    const sanitizedFields = sanitize(fields);
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(sanitizedFields && typeof sanitizedFields === "object" ? sanitizedFields : {}),
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
}
export const logger = {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    sanitize,
};
