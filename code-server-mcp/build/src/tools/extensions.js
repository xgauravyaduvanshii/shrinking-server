import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorResult, successResult, ToolError } from "../utils/errors.js";
async function listExtensionFolders(extensionsDir) {
    const exists = await fs.stat(extensionsDir).then(() => true).catch(() => false);
    if (!exists) {
        return [];
    }
    const entries = await fs.readdir(extensionsDir);
    return entries.map((entry) => path.join(extensionsDir, entry));
}
export function registerExtensionTools(server, ctx) {
    const wrap = (toolName, handler) => async (args) => {
        try {
            ctx.guardTool(toolName, args);
            return await handler(args);
        }
        catch (error) {
            return errorResult(error);
        }
    };
    server.registerTool("extension_list", {
        description: "List installed code-server extensions.",
    }, wrap("extension_list", async () => {
        const folders = await listExtensionFolders(ctx.config.extensionsDir);
        const extensions = await Promise.all(folders.map(async (folder) => {
            const manifestPath = path.join(folder, "package.json");
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
            return {
                id: `${manifest.publisher}.${manifest.name}`,
                name: manifest.displayName ?? manifest.name,
                version: manifest.version,
                enabled: !folder.endsWith(".disabled"),
            };
        }).filter(Boolean));
        return successResult({ extensions });
    }));
    server.registerTool("extension_install", {
        description: "Install a VS Code extension into code-server.",
        inputSchema: { extensionId: z.string() },
    }, wrap("extension_install", async ({ extensionId }) => {
        ctx.assertWritable();
        const result = await ctx.client.runCli(["--install-extension", extensionId, "--force"]);
        return successResult({ extensionId, ...result });
    }));
    server.registerTool("extension_uninstall", {
        description: "Uninstall a VS Code extension from code-server.",
        inputSchema: { extensionId: z.string() },
    }, wrap("extension_uninstall", async ({ extensionId }) => {
        ctx.assertWritable();
        const result = await ctx.client.runCli(["--uninstall-extension", extensionId]);
        return successResult({ extensionId, ...result });
    }));
    server.registerTool("extension_enable", {
        description: "Enable an extension by restoring its folder name when it was disabled by MCP.",
        inputSchema: { extensionId: z.string() },
    }, wrap("extension_enable", async ({ extensionId }) => {
        ctx.assertWritable();
        const folders = await listExtensionFolders(ctx.config.extensionsDir);
        const match = folders.find((folder) => folder.includes(extensionId) && folder.endsWith(".disabled"));
        if (!match) {
            throw new ToolError(`Disabled extension not found: ${extensionId}`, "EXTENSION_NOT_FOUND");
        }
        const next = match.replace(/\.disabled$/, "");
        await fs.rename(match, next);
        return successResult({ extensionId, path: next });
    }));
    server.registerTool("extension_disable", {
        description: "Disable an extension by renaming its folder.",
        inputSchema: { extensionId: z.string() },
    }, wrap("extension_disable", async ({ extensionId }) => {
        ctx.assertWritable();
        const folders = await listExtensionFolders(ctx.config.extensionsDir);
        const match = folders.find((folder) => folder.includes(extensionId) && !folder.endsWith(".disabled"));
        if (!match) {
            throw new ToolError(`Extension not found: ${extensionId}`, "EXTENSION_NOT_FOUND");
        }
        const next = `${match}.disabled`;
        await fs.rename(match, next);
        return successResult({ extensionId, path: next });
    }));
}
