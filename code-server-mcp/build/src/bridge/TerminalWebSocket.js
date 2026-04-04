import { randomUUID } from "node:crypto";
import WebSocket from "ws";
export class TerminalWebSocket {
    ws = null;
    connected = false;
    outputBuffers = new Map();
    listeners = new Map();
    pendingListRequest = null;
    pendingCreates = [];
    async connect(serverUrl, sessionCookie) {
        const target = new URL("/terminal", serverUrl);
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(target, {
                headers: sessionCookie ? { cookie: sessionCookie } : {},
            });
            ws.on("open", () => {
                this.ws = ws;
                this.connected = true;
                resolve();
            });
            ws.on("message", (data) => {
                this.handleMessage(data.toString());
            });
            ws.on("close", () => {
                this.connected = false;
            });
            ws.on("error", reject);
        });
    }
    async create(opts) {
        const ws = this.requireSocket();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal creation")), 10_000);
            this.pendingCreates.push((id) => {
                clearTimeout(timer);
                resolve(id);
            });
            ws.send(JSON.stringify({
                type: "create",
                cols: opts?.cols ?? 220,
                rows: opts?.rows ?? 50,
                cwd: opts?.cwd,
            }));
        });
    }
    async send(terminalId, input) {
        this.requireSocket().send(JSON.stringify({ type: "input", id: terminalId, data: input }));
    }
    async exec(terminalId, command, opts) {
        const sentinel = `__DONE_${randomUUID()}__`;
        const cwdPrefix = opts?.cwd ? `cd ${JSON.stringify(opts.cwd)} && ` : "";
        await this.send(terminalId, `${cwdPrefix}${command}; echo ${sentinel}\n`);
        const startedAt = Date.now();
        const timeoutMs = opts?.timeoutMs ?? 30_000;
        return new Promise((resolve, reject) => {
            const dispose = this.onOutput(terminalId, () => {
                const buffer = this.outputBuffers.get(terminalId) ?? "";
                if (buffer.includes(sentinel)) {
                    dispose();
                    resolve(buffer.replace(sentinel, "").trim());
                }
                else if (Date.now() - startedAt > timeoutMs) {
                    dispose();
                    reject(new Error("Timed out waiting for terminal output"));
                }
            });
        });
    }
    async execNew(command, opts) {
        const terminalId = await this.create({ cwd: opts?.cwd });
        const output = await this.exec(terminalId, command, opts);
        if (!opts?.keepAlive) {
            await this.close(terminalId).catch(() => undefined);
        }
        return { terminalId, output };
    }
    read(terminalId) {
        const buffer = this.outputBuffers.get(terminalId) ?? "";
        this.outputBuffers.set(terminalId, "");
        return buffer;
    }
    onOutput(terminalId, callback) {
        const listeners = this.listeners.get(terminalId) ?? [];
        listeners.push(callback);
        this.listeners.set(terminalId, listeners);
        return () => {
            const updated = (this.listeners.get(terminalId) ?? []).filter((entry) => entry !== callback);
            this.listeners.set(terminalId, updated);
        };
    }
    async list() {
        const ws = this.requireSocket();
        return new Promise((resolve, reject) => {
            this.pendingListRequest = { resolve, reject };
            ws.send(JSON.stringify({ type: "list" }));
            setTimeout(() => {
                if (this.pendingListRequest) {
                    this.pendingListRequest = null;
                    reject(new Error("Timed out waiting for terminal list"));
                }
            }, 10_000);
        });
    }
    async resize(terminalId, cols, rows) {
        this.requireSocket().send(JSON.stringify({ type: "resize", id: terminalId, cols, rows }));
    }
    async close(terminalId) {
        this.requireSocket().send(JSON.stringify({ type: "kill", id: terminalId }));
    }
    disconnect() {
        this.ws?.close();
        this.ws = null;
        this.connected = false;
    }
    isConnected() {
        return this.connected;
    }
    requireSocket() {
        if (!this.ws || !this.connected) {
            throw new Error("Terminal WebSocket is not connected");
        }
        return this.ws;
    }
    handleMessage(raw) {
        const parsed = JSON.parse(raw);
        if (parsed.type === "data" && typeof parsed.id === "number") {
            const next = `${this.outputBuffers.get(parsed.id) ?? ""}${parsed.data ?? ""}`;
            this.outputBuffers.set(parsed.id, next);
            for (const listener of this.listeners.get(parsed.id) ?? []) {
                listener(parsed.data ?? "");
            }
            return;
        }
        if (parsed.type === "terminals" && this.pendingListRequest) {
            this.pendingListRequest.resolve(parsed.terminals ?? []);
            this.pendingListRequest = null;
            return;
        }
        if (parsed.type === "created" && typeof parsed.id === "number") {
            const next = this.pendingCreates.shift();
            next?.(parsed.id);
        }
    }
}
