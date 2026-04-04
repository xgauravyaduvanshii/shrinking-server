import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorResult, successResult, ToolError } from "../utils/errors.js";
import { pathExists } from "../utils/pathSafety.js";
async function listDirectoryEntries(dirPath, recursive, showHidden) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (!showHidden && entry.name.startsWith(".")) {
            continue;
        }
        const absolute = path.join(dirPath, entry.name);
        const stat = await fs.stat(absolute);
        results.push({
            name: entry.name,
            path: absolute,
            type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
            size: stat.size,
            modified: stat.mtime.toISOString(),
        });
        if (recursive && entry.isDirectory()) {
            results.push(...(await listDirectoryEntries(absolute, true, showHidden)));
        }
    }
    return results;
}
async function buildTree(root, depth) {
    const stat = await fs.stat(root);
    const node = {
        path: root,
        type: stat.isDirectory() ? "directory" : "file",
    };
    if (!stat.isDirectory() || depth <= 0) {
        return node;
    }
    const children = await fs.readdir(root);
    node.children = await Promise.all(children.map((child) => buildTree(path.join(root, child), depth - 1)));
    return node;
}
async function readFileText(filePath, encoding, startLine, endLine) {
    const content = await fs.readFile(filePath, encoding);
    if (!startLine && !endLine) {
        return content;
    }
    const lines = content.split(/\r?\n/);
    return lines.slice((startLine ?? 1) - 1, endLine ?? lines.length).join("\n");
}
export function registerFilesystemTools(server, ctx) {
    const wrap = (toolName, handler) => async (args) => {
        try {
            ctx.guardTool(toolName, args);
            return await handler(args);
        }
        catch (error) {
            return errorResult(error);
        }
    };
    server.registerTool("fs_read_file", {
        description: "Read a file from the code-server workspace.",
        inputSchema: {
            path: z.string(),
            encoding: z.string().optional(),
            startLine: z.number().int().positive().optional(),
            endLine: z.number().int().positive().optional(),
        },
    }, wrap("fs_read_file", async ({ path: target, encoding, startLine, endLine }) => {
        const filePath = ctx.resolvePath(target);
        const content = await readFileText(filePath, encoding ?? "utf8", startLine, endLine);
        return successResult({ path: filePath, content });
    }));
    server.registerTool("fs_write_file", {
        description: "Write or overwrite a file.",
        inputSchema: { path: z.string(), content: z.string(), encoding: z.string().optional() },
    }, wrap("fs_write_file", async ({ path: target, content, encoding }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, { encoding: encoding ?? "utf8" });
        return successResult({ path: filePath });
    }));
    server.registerTool("fs_append_file", {
        description: "Append content to a file.",
        inputSchema: { path: z.string(), content: z.string() },
    }, wrap("fs_append_file", async ({ path: target, content }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        await fs.appendFile(filePath, content, "utf8");
        return successResult({ path: filePath });
    }));
    server.registerTool("fs_create_file", {
        description: "Create a file and fail if it already exists.",
        inputSchema: { path: z.string(), content: z.string().optional() },
    }, wrap("fs_create_file", async ({ path: target, content }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        if (await pathExists(filePath)) {
            throw new ToolError(`File already exists: ${filePath}`, "ALREADY_EXISTS");
        }
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content ?? "", { flag: "wx" });
        return successResult({ path: filePath });
    }));
    server.registerTool("fs_delete_file", {
        description: "Delete a file.",
        inputSchema: { path: z.string() },
    }, wrap("fs_delete_file", async ({ path: target }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        await fs.unlink(filePath);
        return successResult({ path: filePath });
    }));
    server.registerTool("fs_move_file", {
        description: "Move or rename a file.",
        inputSchema: { source: z.string(), destination: z.string() },
    }, wrap("fs_move_file", async ({ source, destination }) => {
        ctx.assertWritable();
        const from = ctx.resolvePath(source);
        const to = ctx.resolvePath(destination);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return successResult({ source: from, destination: to });
    }));
    server.registerTool("fs_copy_file", {
        description: "Copy a file.",
        inputSchema: { source: z.string(), destination: z.string() },
    }, wrap("fs_copy_file", async ({ source, destination }) => {
        ctx.assertWritable();
        const from = ctx.resolvePath(source);
        const to = ctx.resolvePath(destination);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(from, to);
        return successResult({ source: from, destination: to });
    }));
    server.registerTool("fs_list_directory", {
        description: "List files and folders in a directory.",
        inputSchema: { path: z.string(), recursive: z.boolean().optional(), showHidden: z.boolean().optional() },
    }, wrap("fs_list_directory", async ({ path: target, recursive, showHidden }) => {
        const dirPath = ctx.resolvePath(target);
        const entries = await listDirectoryEntries(dirPath, recursive ?? false, showHidden ?? false);
        return successResult({ path: dirPath, entries });
    }));
    server.registerTool("fs_create_directory", {
        description: "Create a directory recursively.",
        inputSchema: { path: z.string() },
    }, wrap("fs_create_directory", async ({ path: target }) => {
        ctx.assertWritable();
        const dirPath = ctx.resolvePath(target);
        await fs.mkdir(dirPath, { recursive: true });
        return successResult({ path: dirPath });
    }));
    server.registerTool("fs_delete_directory", {
        description: "Delete a directory.",
        inputSchema: { path: z.string(), recursive: z.boolean().optional() },
    }, wrap("fs_delete_directory", async ({ path: target, recursive }) => {
        ctx.assertWritable();
        const dirPath = ctx.resolvePath(target);
        await fs.rm(dirPath, { recursive: recursive ?? false, force: false });
        return successResult({ path: dirPath });
    }));
    server.registerTool("fs_move_directory", {
        description: "Move or rename a directory.",
        inputSchema: { source: z.string(), destination: z.string() },
    }, wrap("fs_move_directory", async ({ source, destination }) => {
        ctx.assertWritable();
        const from = ctx.resolvePath(source);
        const to = ctx.resolvePath(destination);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        return successResult({ source: from, destination: to });
    }));
    server.registerTool("fs_copy_directory", {
        description: "Copy a directory recursively.",
        inputSchema: { source: z.string(), destination: z.string() },
    }, wrap("fs_copy_directory", async ({ source, destination }) => {
        ctx.assertWritable();
        const from = ctx.resolvePath(source);
        const to = ctx.resolvePath(destination);
        await fs.cp(from, to, { recursive: true });
        return successResult({ source: from, destination: to });
    }));
    server.registerTool("fs_file_info", {
        description: "Get file or directory metadata.",
        inputSchema: { path: z.string() },
    }, wrap("fs_file_info", async ({ path: target }) => {
        const filePath = ctx.resolvePath(target);
        const stat = await fs.stat(filePath);
        return successResult({
            path: filePath,
            type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
            size: stat.size,
            modified: stat.mtime.toISOString(),
            created: stat.birthtime.toISOString(),
            mode: stat.mode.toString(8),
        });
    }));
    server.registerTool("fs_check_exists", {
        description: "Check whether a file or directory exists.",
        inputSchema: { path: z.string() },
    }, wrap("fs_check_exists", async ({ path: target }) => {
        const filePath = ctx.resolvePath(target);
        const exists = await pathExists(filePath);
        const type = exists ? (await fs.stat(filePath)).isDirectory() ? "directory" : "file" : null;
        return successResult({ path: filePath, exists, type });
    }));
    server.registerTool("fs_get_tree", {
        description: "Get a JSON tree for a directory.",
        inputSchema: { path: z.string(), depth: z.number().int().positive().optional() },
    }, wrap("fs_get_tree", async ({ path: target, depth }) => {
        const dirPath = ctx.resolvePath(target);
        const tree = await buildTree(dirPath, depth ?? 4);
        return successResult({ tree });
    }));
    server.registerTool("fs_chmod", {
        description: "Change file permissions.",
        inputSchema: { path: z.string(), mode: z.string() },
    }, wrap("fs_chmod", async ({ path: target, mode }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        await fs.chmod(filePath, Number.parseInt(mode, 8));
        return successResult({ path: filePath, mode });
    }));
    server.registerTool("fs_chown", {
        description: "Change file owner using system chown.",
        inputSchema: { path: z.string(), user: z.string(), group: z.string().optional() },
    }, wrap("fs_chown", async ({ path: target, user, group }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        const { stdout, stderr, exitCode } = await import("./terminal.js").then((mod) => mod.execCommand(`chown ${user}${group ? `:${group}` : ""} ${JSON.stringify(filePath)}`, ctx.config.workspaceRoot, 30_000, {
            ...process.env,
        }));
        if (exitCode !== 0) {
            throw new ToolError(stderr || stdout || "Failed to chown");
        }
        return successResult({ path: filePath, user, group: group ?? null });
    }));
    server.registerTool("fs_symlink", {
        description: "Create a symbolic link.",
        inputSchema: { target: z.string(), linkPath: z.string() },
    }, wrap("fs_symlink", async ({ target, linkPath }) => {
        ctx.assertWritable();
        const resolvedTarget = ctx.resolvePath(target);
        const resolvedLink = ctx.resolvePath(linkPath);
        await fs.symlink(resolvedTarget, resolvedLink);
        return successResult({ target: resolvedTarget, linkPath: resolvedLink });
    }));
    server.registerTool("fs_read_binary", {
        description: "Read a binary file as base64.",
        inputSchema: { path: z.string() },
    }, wrap("fs_read_binary", async ({ path: target }) => {
        const filePath = ctx.resolvePath(target);
        const data = await fs.readFile(filePath);
        return successResult({ path: filePath, base64Content: data.toString("base64") });
    }));
    server.registerTool("fs_write_binary", {
        description: "Write base64 content to a file.",
        inputSchema: { path: z.string(), base64Content: z.string() },
    }, wrap("fs_write_binary", async ({ path: target, base64Content }) => {
        ctx.assertWritable();
        const filePath = ctx.resolvePath(target);
        await fs.writeFile(filePath, Buffer.from(base64Content, "base64"));
        return successResult({ path: filePath });
    }));
}
