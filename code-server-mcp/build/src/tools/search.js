import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorResult, successResult } from "../utils/errors.js";
import { matchesGlobLike } from "../utils/pathSafety.js";
async function walk(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walk(fullPath)));
        }
        else if (entry.isFile()) {
            files.push(fullPath);
        }
    }
    return files;
}
export function registerSearchTools(server, ctx) {
    const wrap = (toolName, handler) => async (args) => {
        try {
            ctx.guardTool(toolName, args);
            return await handler(args);
        }
        catch (error) {
            return errorResult(error);
        }
    };
    server.registerTool("search_files", {
        description: "Find files by wildcard pattern.",
        inputSchema: { pattern: z.string(), cwd: z.string().optional(), maxResults: z.number().int().positive().optional() },
    }, wrap("search_files", async ({ pattern, cwd, maxResults }) => {
        const root = ctx.resolvePath(cwd ?? ctx.config.workspaceRoot);
        const files = await walk(root);
        const matches = files.filter((file) => matchesGlobLike(path.basename(file), pattern) || matchesGlobLike(file, pattern)).slice(0, maxResults ?? 200);
        return successResult({ matches });
    }));
    server.registerTool("search_in_files", {
        description: "Search text or regex inside files.",
        inputSchema: {
            query: z.string(),
            cwd: z.string().optional(),
            filePattern: z.string().optional(),
            isRegex: z.boolean().optional(),
            caseSensitive: z.boolean().optional(),
            maxResults: z.number().int().positive().optional(),
        },
    }, wrap("search_in_files", async ({ query, cwd, filePattern, isRegex, caseSensitive, maxResults }) => {
        const root = ctx.resolvePath(cwd ?? ctx.config.workspaceRoot);
        const files = await walk(root);
        const regex = isRegex ? new RegExp(query, caseSensitive ? "g" : "gi") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
        const results = [];
        for (const file of files) {
            if (filePattern && !matchesGlobLike(file, filePattern)) {
                continue;
            }
            const content = await fs.readFile(file, "utf8").catch(() => "");
            const lines = content.split(/\r?\n/);
            lines.forEach((lineContent, index) => {
                if (results.length >= (maxResults ?? 200)) {
                    return;
                }
                const match = regex.exec(lineContent);
                regex.lastIndex = 0;
                if (match) {
                    results.push({ file, line: index + 1, lineContent, match: match[0] });
                }
            });
            if (results.length >= (maxResults ?? 200)) {
                break;
            }
        }
        return successResult({ results });
    }));
    server.registerTool("search_replace_in_files", {
        description: "Find and replace across files.",
        inputSchema: {
            find: z.string(),
            replace: z.string(),
            filePattern: z.string().optional(),
            cwd: z.string().optional(),
            isRegex: z.boolean().optional(),
        },
    }, wrap("search_replace_in_files", async ({ find, replace, filePattern, cwd, isRegex }) => {
        ctx.assertWritable();
        const root = ctx.resolvePath(cwd ?? ctx.config.workspaceRoot);
        const files = await walk(root);
        const regex = isRegex ? new RegExp(find, "g") : new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
        let filesChanged = 0;
        let replacements = 0;
        for (const file of files) {
            if (filePattern && !matchesGlobLike(file, filePattern)) {
                continue;
            }
            const content = await fs.readFile(file, "utf8").catch(() => "");
            const next = content.replace(regex, () => {
                replacements += 1;
                return replace;
            });
            if (next !== content) {
                filesChanged += 1;
                await fs.writeFile(file, next);
            }
        }
        return successResult({ filesChanged, replacements });
    }));
    server.registerTool("search_find_by_content", {
        description: "Find files containing specific text.",
        inputSchema: { text: z.string(), cwd: z.string().optional(), fileExtensions: z.array(z.string()).optional() },
    }, wrap("search_find_by_content", async ({ text, cwd, fileExtensions }) => {
        const root = ctx.resolvePath(cwd ?? ctx.config.workspaceRoot);
        const files = await walk(root);
        const matches = [];
        for (const file of files) {
            if (fileExtensions && !fileExtensions.includes(path.extname(file))) {
                continue;
            }
            const content = await fs.readFile(file, "utf8").catch(() => "");
            if (content.includes(text)) {
                matches.push(file);
            }
        }
        return successResult({ matches });
    }));
    server.registerTool("search_recent_files", {
        description: "List recently opened files tracked by MCP.",
        inputSchema: { limit: z.number().int().positive().optional() },
    }, wrap("search_recent_files", async ({ limit }) => successResult({
        files: ctx.editorState.recentFiles.slice(0, limit ?? 20),
    })));
}
