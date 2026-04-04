import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fetch from "node-fetch";
import { CodeServerAuth } from "./auth.js";
import { CodeServerWebSocket } from "./websocket.js";
const execFileAsync = promisify(execFile);
export class CodeServerClient {
    config;
    auth;
    websocket;
    constructor(config) {
        this.config = config;
        this.auth = new CodeServerAuth(config.codeServerUrl, config.codeServerPassword, config.codeServerToken);
        this.websocket = new CodeServerWebSocket();
    }
    async initialize() {
        await this.auth.login();
    }
    async health() {
        const startedAt = Date.now();
        const headers = await this.auth.getAuthHeaders();
        const response = await fetch(this.auth.buildUrl("/healthz"), { headers });
        return { healthy: response.ok, latency: Date.now() - startedAt };
    }
    async fetchText(resourcePath) {
        await this.auth.refreshIfNeeded();
        const headers = await this.auth.getAuthHeaders();
        const response = await fetch(this.auth.buildUrl(resourcePath), { headers });
        return response.text();
    }
    getCliInvocation(extraArgs = []) {
        if (this.config.cliCommand) {
            return { command: this.config.cliCommand, args: extraArgs };
        }
        const repoCli = path.resolve(process.cwd(), "..", "out", "node", "entry.js");
        return { command: process.execPath, args: [repoCli, ...extraArgs] };
    }
    async runCli(extraArgs = []) {
        const invocation = this.getCliInvocation(extraArgs);
        return execFileAsync(invocation.command, invocation.args, {
            env: process.env,
            cwd: this.config.workspaceRoot,
            maxBuffer: 10 * 1024 * 1024,
        });
    }
    async getVersion() {
        try {
            const { stdout } = await this.runCli(["--version"]);
            return stdout.trim();
        }
        catch {
            return "unknown";
        }
    }
    static defaultUserDataDir() {
        return path.join(os.homedir(), ".local", "share", "code-server");
    }
}
