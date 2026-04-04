import os from "node:os"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { ToolContext } from "../context.js"
import { errorResult, successResult } from "../utils/errors.js"
import { execCommand } from "./terminal.js"

export function registerServerTools(server: McpServer, ctx: ToolContext): void {
  const wrap = <T>(toolName: string, handler: (args: T) => Promise<any>) => async (args: T) => {
    try {
      ctx.guardTool(toolName, args as Record<string, unknown>)
      return await handler(args)
    } catch (error) {
      return errorResult(error)
    }
  }

  server.registerTool("server_info", { description: "Get code-server and workspace metadata." }, wrap("server_info", async () => successResult({
    url: ctx.config.codeServerUrl,
    workspace: ctx.config.workspaceRoot,
    userDataDir: ctx.config.userDataDir,
    extensionsDir: ctx.config.extensionsDir,
    version: await ctx.client.getVersion(),
    readonlyMode: ctx.config.readonlyMode,
  })))

  server.registerTool(
    "server_health",
    { description: "Check whether code-server is reachable." },
    wrap("server_health", async () => successResult(await ctx.client.health())),
  )

  server.registerTool("server_disk_usage", {
    description: "Get disk usage for a path.",
    inputSchema: { path: z.string().optional() },
  }, wrap("server_disk_usage", async ({ path }) =>
    successResult(
      await execCommand(
        `df -B1 ${JSON.stringify(ctx.resolvePath(path ?? ctx.config.workspaceRoot))}`,
        ctx.config.workspaceRoot,
        30_000,
      ),
    )))

  server.registerTool(
    "server_system_info",
    { description: "Get host system information." },
    wrap("server_system_info", async () => successResult({
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptimeSeconds: os.uptime(),
    })),
  )

  server.registerTool(
    "server_list_ports",
    { description: "List listening TCP ports." },
    wrap("server_list_ports", async () =>
      successResult(await execCommand("ss -ltnpH", ctx.config.workspaceRoot, 30_000))),
  )

  server.registerTool(
    "server_restart_code_server",
    { description: "Restart code-server using systemd." },
    wrap("server_restart_code_server", async () => {
      ctx.assertWritable()
      const result = await execCommand(
        "systemctl --user restart code-server || sudo systemctl restart code-server",
        ctx.config.workspaceRoot,
        60_000,
      )
      return successResult(result)
    }),
  )
}
