import WebSocket from "ws";
import { logger } from "../utils/logger.js";
export class CodeServerWebSocket {
    socket;
    requestId = 0;
    pending = new Map();
    async connect(url, headers = {}) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            return;
        }
        await new Promise((resolve, reject) => {
            const socket = new WebSocket(url, { headers });
            this.socket = socket;
            socket.on("open", () => {
                logger.info("Connected to code-server websocket", { url });
                resolve();
            });
            socket.on("message", (buffer) => {
                const text = buffer.toString();
                try {
                    const payload = JSON.parse(text);
                    if (typeof payload.id === "number") {
                        const callback = this.pending.get(payload.id);
                        if (callback) {
                            this.pending.delete(payload.id);
                            callback(payload);
                        }
                    }
                }
                catch {
                    logger.debug("Received non-JSON websocket payload", { url });
                }
            });
            socket.on("error", reject);
        });
    }
    async sendCommand(command, args = []) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket is not connected");
        }
        const id = ++this.requestId;
        const payload = { id, command, args };
        const result = new Promise((resolve) => this.pending.set(id, resolve));
        this.socket.send(JSON.stringify(payload));
        return result;
    }
    async close() {
        if (!this.socket) {
            return;
        }
        await new Promise((resolve) => {
            this.socket?.once("close", () => resolve());
            this.socket?.close();
        });
        this.socket = undefined;
    }
}
