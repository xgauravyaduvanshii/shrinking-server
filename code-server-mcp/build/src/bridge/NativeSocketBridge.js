import { promises as fs } from "node:fs";
import * as syncFs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { EventEmitter } from "node:events";
export class NativeSocketBridge extends EventEmitter {
    clientConnected = false;
    socketPath;
    constructor(socketPath) {
        super();
        this.socketPath = socketPath ?? this.discoverSocketPath();
    }
    discoverSocketPath() {
        if (process.env.CODE_SERVER_SOCKET_PATH) {
            return process.env.CODE_SERVER_SOCKET_PATH;
        }
        const tmpDir = "/tmp";
        try {
            const candidates = syncFs
                .readdirSync(tmpDir)
                .filter((entry) => entry.startsWith("vscode-ipc-") && entry.endsWith(".sock"))
                .map((entry) => {
                const fullPath = path.join(tmpDir, entry);
                return {
                    fullPath,
                    mtimeMs: syncFs.statSync(fullPath).mtimeMs,
                };
            })
                .sort((a, b) => b.mtimeMs - a.mtimeMs);
            if (candidates.length > 0) {
                return candidates[0].fullPath;
            }
        }
        catch {
            // ignore
        }
        const configPath = path.join(os.homedir(), ".config", "code-server", "config.yaml");
        try {
            const raw = syncFs.readFileSync(configPath, "utf8");
            const match = raw.match(/session-socket:\s*(.+)/);
            if (match?.[1]) {
                return match[1].trim();
            }
        }
        catch {
            // ignore
        }
        return path.join(os.homedir(), ".local", "share", "code-server", "code-server-ipc.sock");
    }
    async connect() {
        await fs.access(this.socketPath);
        this.clientConnected = true;
        this.emit("connected", this.socketPath);
    }
    async openFile(args) {
        const payload = {
            type: "open",
            fileURIs: args.fileURIs,
            folderURIs: [],
            forceReuseWindow: args.forceReuseWindow ?? true,
            gotoLineMode: Boolean(args.line || args.column),
        };
        return this.send(payload);
    }
    async getStatus() {
        const result = await this.send({ type: "status" });
        return {
            raw: result.raw,
            ...(typeof result.raw === "object" && result.raw ? result.raw : {}),
        };
    }
    async clipboard(args) {
        if (args.action === "read") {
            return {
                result: "error",
                message: "code-server native CLI socket supports clipboard write, not clipboard read",
            };
        }
        const result = await this.send({
            type: "clipboard",
            content: args.text ?? "",
        });
        return {
            result: result.result,
            message: result.message,
        };
    }
    async send(message) {
        await this.connect().catch(() => undefined);
        return new Promise((resolve, reject) => {
            const request = http.request({
                socketPath: this.socketPath,
                path: "/",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                },
            }, (response) => {
                let raw = "";
                response.setEncoding("utf8");
                response.on("data", (chunk) => {
                    raw += chunk;
                });
                response.on("end", () => {
                    try {
                        const parsed = raw ? JSON.parse(raw) : null;
                        resolve({
                            result: response.statusCode && response.statusCode >= 200 && response.statusCode < 300 ? "ok" : "error",
                            message: typeof parsed === "string" ? parsed : undefined,
                            raw: parsed,
                        });
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
            request.on("error", (error) => {
                this.clientConnected = false;
                this.emit("disconnected", error);
                reject(error);
            });
            request.write(JSON.stringify(message));
            request.end();
        });
    }
    disconnect() {
        this.clientConnected = false;
        this.emit("disconnected");
    }
    isConnected() {
        return this.clientConnected;
    }
    getSocketPath() {
        return this.socketPath;
    }
}
