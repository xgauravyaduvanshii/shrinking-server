import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
function encodeMessage(payload) {
    const body = JSON.stringify(payload);
    return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}
function severityFromLsp(value) {
    switch (value) {
        case 1:
            return "error";
        case 2:
            return "warning";
        case 3:
            return "info";
        default:
            return "hint";
    }
}
function kindToString(value) {
    return typeof value === "number" ? String(value) : "unknown";
}
function languageIdForFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case ".ts":
            return "typescript";
        case ".tsx":
            return "typescriptreact";
        case ".js":
            return "javascript";
        case ".jsx":
            return "javascriptreact";
        case ".py":
            return "python";
        case ".rs":
            return "rust";
        case ".go":
            return "go";
        case ".c":
            return "c";
        case ".cpp":
        case ".cc":
        case ".cxx":
        case ".hpp":
        case ".h":
            return "cpp";
        default:
            return ext.slice(1) || "plaintext";
    }
}
export async function detectLanguageServers() {
    const checks = [
        ["typescript", ["typescript-language-server", "--stdio"]],
        ["python", ["pylsp"]],
        ["pyright", ["pyright-langserver", "--stdio"]],
        ["rust", ["rust-analyzer"]],
        ["go", ["gopls"]],
        ["c_cpp", ["clangd"]],
    ];
    const found = {};
    for (const [key, cmd] of checks) {
        try {
            const result = await execFileAsync("bash", ["-lc", `command -v ${cmd[0]}`]);
            const location = result.stdout.trim();
            if (location) {
                found[key] = location;
            }
        }
        catch {
            // ignore
        }
    }
    return found;
}
export function getServerForFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if ([".ts", ".tsx", ".js", ".jsx"].includes(ext)) {
        return "typescript-language-server --stdio";
    }
    if (ext === ".py") {
        return "pylsp";
    }
    if (ext === ".rs") {
        return "rust-analyzer";
    }
    if (ext === ".go") {
        return "gopls";
    }
    if ([".c", ".cc", ".cpp", ".cxx", ".h", ".hpp"].includes(ext)) {
        return "clangd --stdio";
    }
    return null;
}
export class LSPClient {
    serverCommand;
    workspaceRoot;
    process = null;
    pendingRequests = new Map();
    nextId = 1;
    diagnosticsCache = new Map();
    initialized = false;
    readBuffer = "";
    constructor(serverCommand, workspaceRoot) {
        this.serverCommand = serverCommand;
        this.workspaceRoot = workspaceRoot;
    }
    async initialize() {
        if (this.initialized) {
            return;
        }
        const [command, ...args] = this.serverCommand.split(/\s+/);
        this.process = spawn(command, args, {
            cwd: this.workspaceRoot,
            stdio: "pipe",
            shell: false,
        });
        this.process.stdout.on("data", (chunk) => this.handleData(chunk.toString("utf8")));
        this.process.stderr.on("data", () => {
            // ignore noisy stderr from language servers
        });
        await this.request("initialize", {
            processId: process.pid,
            rootUri: `file://${this.workspaceRoot}`,
            capabilities: {},
            workspaceFolders: [{ uri: `file://${this.workspaceRoot}`, name: path.basename(this.workspaceRoot) }],
        });
        this.notify("initialized", {});
        this.initialized = true;
    }
    async openDocument(uri, content, languageId) {
        this.notify("textDocument/didOpen", {
            textDocument: {
                uri,
                languageId,
                version: 1,
                text: content,
            },
        });
    }
    async closeDocument(uri) {
        this.notify("textDocument/didClose", { textDocument: { uri } });
    }
    async hover(uri, position) {
        const result = await this.request("textDocument/hover", { textDocument: { uri }, position });
        if (!result) {
            return null;
        }
        const contents = Array.isArray(result.contents)
            ? result.contents.map((entry) => typeof entry === "string" ? entry : entry.value ?? JSON.stringify(entry)).join("\n")
            : typeof result.contents === "string"
                ? result.contents
                : result.contents?.value ?? JSON.stringify(result.contents);
        return {
            contents,
            range: result.range,
        };
    }
    async definition(uri, position) {
        return (await this.request("textDocument/definition", { textDocument: { uri }, position })) ?? [];
    }
    async references(uri, position) {
        return (await this.request("textDocument/references", { textDocument: { uri }, position, context: { includeDeclaration: true } })) ?? [];
    }
    async completion(uri, position) {
        const result = await this.request("textDocument/completion", { textDocument: { uri }, position });
        const items = Array.isArray(result) ? result : result?.items ?? [];
        return items.map((item) => ({
            label: item.label,
            kind: kindToString(item.kind),
            detail: item.detail,
            documentation: typeof item.documentation === "string" ? item.documentation : item.documentation?.value,
            insertText: item.insertText,
        }));
    }
    async documentSymbols(uri) {
        const result = await this.request("textDocument/documentSymbol", { textDocument: { uri } });
        return (result ?? []).map((item) => ({
            name: item.name,
            kind: kindToString(item.kind),
            range: item.range,
            selectionRange: item.selectionRange ?? item.range,
            children: item.children,
        }));
    }
    async getDiagnostics(uri, waitMs = 1000) {
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.diagnosticsCache.get(uri) ?? [];
    }
    async formatDocument(uri) {
        return (await this.request("textDocument/formatting", {
            textDocument: { uri },
            options: { tabSize: 2, insertSpaces: true },
        })) ?? [];
    }
    async rename(uri, position, newName) {
        const result = await this.request("textDocument/rename", {
            textDocument: { uri },
            position,
            newName,
        });
        return result?.changes ?? {};
    }
    async request(method, params) {
        if (!this.process) {
            throw new Error("LSP client is not running");
        }
        const id = this.nextId++;
        const payload = { jsonrpc: "2.0", id, method, params };
        this.process.stdin.write(encodeMessage(payload));
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
        });
    }
    notify(method, params) {
        if (!this.process) {
            return;
        }
        this.process.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }));
    }
    handleData(chunk) {
        this.readBuffer += chunk;
        while (true) {
            const splitIndex = this.readBuffer.indexOf("\r\n\r\n");
            if (splitIndex === -1) {
                return;
            }
            const header = this.readBuffer.slice(0, splitIndex);
            const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
            if (!lengthMatch) {
                this.readBuffer = "";
                return;
            }
            const contentLength = Number(lengthMatch[1]);
            const bodyStart = splitIndex + 4;
            const bodyEnd = bodyStart + contentLength;
            if (this.readBuffer.length < bodyEnd) {
                return;
            }
            const body = this.readBuffer.slice(bodyStart, bodyEnd);
            this.readBuffer = this.readBuffer.slice(bodyEnd);
            const parsed = JSON.parse(body);
            if (typeof parsed.id === "number" && this.pendingRequests.has(parsed.id)) {
                const pending = this.pendingRequests.get(parsed.id);
                this.pendingRequests.delete(parsed.id);
                if (parsed.error) {
                    pending.reject(parsed.error);
                }
                else {
                    pending.resolve(parsed.result);
                }
            }
            else if (parsed.method === "textDocument/publishDiagnostics") {
                const uri = parsed.params?.uri;
                if (typeof uri === "string") {
                    this.diagnosticsCache.set(uri, (parsed.params?.diagnostics ?? []).map((item) => ({
                        range: item.range,
                        message: item.message,
                        severity: severityFromLsp(item.severity),
                        source: item.source,
                        code: item.code,
                    })));
                }
            }
        }
    }
    async primeDocument(filePath) {
        const content = await fs.readFile(filePath, "utf8");
        const uri = `file://${filePath}`;
        await this.openDocument(uri, content, languageIdForFile(filePath));
        return uri;
    }
    async shutdown() {
        if (!this.process) {
            return;
        }
        try {
            await this.request("shutdown", {});
            this.notify("exit", {});
        }
        finally {
            this.process.kill("SIGTERM");
            this.process = null;
            this.initialized = false;
        }
    }
    isRunning() {
        return Boolean(this.process && !this.process.killed);
    }
}
