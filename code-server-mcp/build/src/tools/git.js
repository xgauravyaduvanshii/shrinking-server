import { z } from "zod";
import { errorResult, successResult } from "../utils/errors.js";
import { execCommand } from "./terminal.js";
export function registerGitTools(server, ctx) {
    const wrap = (toolName, handler) => async (args) => {
        try {
            ctx.guardTool(toolName, args);
            return await handler(args);
        }
        catch (error) {
            return errorResult(error);
        }
    };
    const runGit = async (cwd, args) => execCommand(`git ${args}`, ctx.resolvePath(cwd ?? ctx.config.workspaceRoot), 60_000, process.env);
    server.registerTool("git_status", {
        description: "Get git status.",
        inputSchema: { cwd: z.string().optional() },
    }, wrap("git_status", async ({ cwd }) => successResult(await runGit(cwd, "status --short --branch"))));
    server.registerTool("git_diff", {
        description: "Get git diff.",
        inputSchema: { cwd: z.string().optional(), staged: z.boolean().optional(), file: z.string().optional() },
    }, wrap("git_diff", async ({ cwd, staged, file }) => successResult(await runGit(cwd, `diff ${staged ? "--staged" : ""} ${file ?? ""}`.trim()))));
    server.registerTool("git_log", {
        description: "Get git commit log.",
        inputSchema: { cwd: z.string().optional(), limit: z.number().int().positive().optional(), branch: z.string().optional() },
    }, wrap("git_log", async ({ cwd, limit, branch }) => successResult(await runGit(cwd, `log ${branch ?? ""} --oneline -n ${limit ?? 20}`.trim()))));
    server.registerTool("git_add", {
        description: "Stage files.",
        inputSchema: { paths: z.array(z.string()), cwd: z.string().optional() },
    }, wrap("git_add", async ({ paths, cwd }) => {
        ctx.assertWritable();
        return successResult(await runGit(cwd, `add ${paths.map((item) => JSON.stringify(item)).join(" ")}`));
    }));
    server.registerTool("git_commit", {
        description: "Create a commit.",
        inputSchema: { message: z.string(), cwd: z.string().optional(), amend: z.boolean().optional() },
    }, wrap("git_commit", async ({ message, cwd, amend }) => {
        ctx.assertWritable();
        return successResult(await runGit(cwd, `commit ${amend ? "--amend " : ""}-m ${JSON.stringify(message)}`));
    }));
    server.registerTool("git_push", {
        description: "Push to a remote.",
        inputSchema: { cwd: z.string().optional(), remote: z.string().optional(), branch: z.string().optional(), force: z.boolean().optional() },
    }, wrap("git_push", async ({ cwd, remote, branch, force }) => {
        ctx.assertWritable();
        return successResult(await runGit(cwd, `push ${force ? "--force " : ""}${remote ?? ""} ${branch ?? ""}`.trim()));
    }));
    server.registerTool("git_pull", {
        description: "Pull from a remote.",
        inputSchema: { cwd: z.string().optional(), remote: z.string().optional(), branch: z.string().optional() },
    }, wrap("git_pull", async ({ cwd, remote, branch }) => {
        ctx.assertWritable();
        return successResult(await runGit(cwd, `pull ${remote ?? ""} ${branch ?? ""}`.trim()));
    }));
    server.registerTool("git_checkout", {
        description: "Checkout a branch or target.",
        inputSchema: { target: z.string(), cwd: z.string().optional(), createBranch: z.boolean().optional() },
    }, wrap("git_checkout", async ({ target, cwd, createBranch }) => {
        ctx.assertWritable();
        return successResult(await runGit(cwd, `checkout ${createBranch ? "-b " : ""}${JSON.stringify(target)}`));
    }));
    server.registerTool("git_branch_list", {
        description: "List branches.",
        inputSchema: { cwd: z.string().optional(), includeRemote: z.boolean().optional() },
    }, wrap("git_branch_list", async ({ cwd, includeRemote }) => successResult(await runGit(cwd, `branch ${includeRemote ? "-a" : ""}`.trim()))));
    server.registerTool("git_clone", {
        description: "Clone a repository.",
        inputSchema: { url: z.string(), targetPath: z.string(), depth: z.number().int().positive().optional() },
    }, wrap("git_clone", async ({ url, targetPath, depth }) => {
        ctx.assertWritable();
        const resolved = ctx.resolvePath(targetPath);
        return successResult(await execCommand(`git clone ${depth ? `--depth ${depth} ` : ""}${JSON.stringify(url)} ${JSON.stringify(resolved)}`, ctx.config.workspaceRoot, 120_000, process.env));
    }));
    server.registerTool("git_stash", {
        description: "Manage git stash.",
        inputSchema: { action: z.enum(["save", "pop", "list", "drop"]), message: z.string().optional(), cwd: z.string().optional() },
    }, wrap("git_stash", async ({ action, message, cwd }) => {
        ctx.assertWritable();
        const command = action === "save" ? `stash push -m ${JSON.stringify(message ?? "mcp stash")}` : `stash ${action}`;
        return successResult(await runGit(cwd, command));
    }));
}
