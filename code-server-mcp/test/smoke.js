import "dotenv/config";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
async function run() {
    const projectRoot = path.resolve(process.cwd());
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(projectRoot, "build", "index.js")],
        cwd: projectRoot,
        env: {
            ...process.env,
            MCP_TRANSPORT: "stdio",
        },
    });
    const client = new Client({ name: "code-server-mcp-smoke", version: "1.0.0" });
    await client.connect(transport);
    const checks = [
        ["server_health", client.callTool({ name: "server_health", arguments: {} })],
        ["fs_list_directory", client.callTool({ name: "fs_list_directory", arguments: { path: process.env.CODE_SERVER_WORKSPACE ?? projectRoot } })],
        ["terminal_exec", client.callTool({ name: "terminal_exec", arguments: { command: "echo hello", cwd: process.env.CODE_SERVER_WORKSPACE ?? projectRoot } })],
        ["fs_write_file", client.callTool({ name: "fs_write_file", arguments: { path: path.join(process.env.CODE_SERVER_WORKSPACE ?? projectRoot, ".mcp-smoke.txt"), content: "hello from smoke" } })],
        ["fs_read_file", client.callTool({ name: "fs_read_file", arguments: { path: path.join(process.env.CODE_SERVER_WORKSPACE ?? projectRoot, ".mcp-smoke.txt") } })],
    ];
    for (const [name, promise] of checks) {
        try {
            const result = await promise;
            console.log(`PASS ${name}`, JSON.stringify(result).slice(0, 200));
        }
        catch (error) {
            console.log(`FAIL ${name}`, error instanceof Error ? error.message : String(error));
        }
    }
    await transport.close();
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
