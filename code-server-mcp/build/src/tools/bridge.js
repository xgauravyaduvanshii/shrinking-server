import { detectLanguageServers } from "../bridge/LSPClient.js";
import { errorResult, successResult } from "../utils/errors.js";
export function registerBridgeTools(server, ctx, nativeSocket, terminalWs, heartbeat) {
    const wrap = (toolName, handler) => async (args) => {
        try {
            ctx.guardTool(toolName, args);
            return await handler(args);
        }
        catch (error) {
            return errorResult(error);
        }
    };
    server.registerTool("bridge_status", {
        description: "Report bridge availability and capabilities.",
    }, wrap("bridge_status", async () => successResult({
        nativeSocket: {
            available: nativeSocket.isConnected(),
            socketPath: nativeSocket.getSocketPath(),
            capabilities: ["open_file", "status", "clipboard_write", "extension_management"],
        },
        terminalWebSocket: {
            available: terminalWs.isConnected(),
            capabilities: ["create_terminal", "exec", "read_output", "list", "close", "resize"],
        },
        lsp: {
            available: ctx.config.lspEnabled,
            serversDetected: await detectLanguageServers(),
            capabilities: ["hover", "definition", "references", "completions", "diagnostics", "symbols", "format", "rename"],
        },
        heartbeat: heartbeat.getStatus(),
    })));
    server.registerTool("bridge_reconnect", {
        description: "Reconnect available bridges.",
    }, wrap("bridge_reconnect", async () => {
        const reconnected = [];
        await nativeSocket.connect().then(() => reconnected.push("nativeSocket")).catch(() => undefined);
        await terminalWs.connect(ctx.config.codeServerUrl, await ctx.client.auth.getCookieString()).then(() => reconnected.push("terminalWebSocket")).catch(() => undefined);
        return successResult({ reconnected });
    }));
}
