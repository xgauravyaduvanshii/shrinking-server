export class ToolError extends Error {
    code;
    constructor(message, code = "TOOL_ERROR") {
        super(message);
        this.code = code;
        this.name = "ToolError";
    }
}
export function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "string") {
        return error;
    }
    return "Unknown error";
}
export function successResult(payload = {}) {
    const body = { success: true, ...payload };
    return {
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        structuredContent: body,
    };
}
export function errorResult(error, extra = {}) {
    const body = {
        success: false,
        error: toErrorMessage(error),
        ...extra,
    };
    return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
        structuredContent: body,
    };
}
