import "dotenv/config"
import fs from "node:fs"
import path from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

type ToolResult = {
  structuredContent?: Record<string, unknown>
}

function getStructured(result: unknown): Record<string, unknown> {
  return ((result as ToolResult).structuredContent ?? {}) as Record<string, unknown>
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args })
}

async function run(): Promise<void> {
  const projectRoot = path.resolve(process.cwd())
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(projectRoot, "build", "src", "index.js")],
    cwd: projectRoot,
    env: {
      ...process.env,
      MCP_TRANSPORT: "stdio",
      VSCODE_IPC_HOOK_CLI: "",
    } as Record<string, string>,
  })

  const client = new Client({ name: "shrinking-server-mcp-smoke", version: "1.0.0" })
  await client.connect(transport)

  const workspace = process.env.CODE_SERVER_WORKSPACE ?? projectRoot
  const smokeFile = path.join(workspace, ".mcp-smoke.txt")
  let hasFailure = false
  const runCheck = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      hasFailure = true
      console.log(`FAIL ${name}`, error instanceof Error ? error.message : String(error))
    }
  }

  await runCheck("bridge_status", async () => {
    const result = await callTool(client, "bridge_status")
    console.log("Bridge status:", JSON.stringify(getStructured(result), null, 2))
  })

  await runCheck("server_health", async () => {
    const result = await callTool(client, "server_health")
    const structured = getStructured(result)
    if (structured.success === false) {
      throw new Error(String(structured.error ?? "server_health failed"))
    }
  })

  await runCheck("fs_list_directory", async () => {
    const result = await callTool(client, "fs_list_directory", { path: workspace })
    const structured = getStructured(result)
    if (structured.success === false) {
      throw new Error(String(structured.error ?? "fs_list_directory failed"))
    }
  })

  await runCheck("terminal_exec", async () => {
    const result = await callTool(client, "terminal_exec", { command: "echo hello", cwd: workspace })
    const structured = getStructured(result)
    if (structured.success === false || !String(structured.stdout ?? "").includes("hello")) {
      throw new Error("terminal_exec failed")
    }
  })

  await runCheck("fs_write_file", async () => {
    const result = await callTool(client, "fs_write_file", { path: smokeFile, content: "hello from smoke" })
    const structured = getStructured(result)
    if (structured.success === false) {
      throw new Error(String(structured.error ?? "fs_write_file failed"))
    }
  })

  await runCheck("fs_read_file", async () => {
    const result = await callTool(client, "fs_read_file", { path: smokeFile })
    const structured = getStructured(result)
    if (structured.success === false || !String(structured.content ?? "").includes("hello from smoke")) {
      throw new Error("fs_read_file failed")
    }
  })

  const bridgeStatus = getStructured(await callTool(client, "bridge_status"))
  const nativeSocket = bridgeStatus.nativeSocket as Record<string, unknown> | undefined
  const terminalWebSocket = bridgeStatus.terminalWebSocket as Record<string, unknown> | undefined

  if (nativeSocket?.available) {
    await runCheck("editor_open_file", async () => {
      const readmePath = path.join(workspace, "README.md")
      const targetPath = fs.existsSync(readmePath) ? readmePath : smokeFile
      await callTool(client, "editor_open_file", { path: targetPath })
      const status = getStructured(await callTool(client, "editor_get_status"))
      const activeFile = String(status.activeFile ?? "")
      if (!activeFile.includes(path.basename(targetPath))) {
        throw new Error(`Expected active file to include ${path.basename(targetPath)}`)
      }
    })

    await runCheck("clipboard_write", async () => {
      const result = getStructured(await callTool(client, "clipboard_write", { text: "mcp-clipboard-test" }))
      if (result.success === false) {
        throw new Error(String(result.reason ?? result.error ?? "clipboard_write failed"))
      }
    })
  } else {
    console.log("SKIP editor_open_file (native socket unavailable)")
    console.log("SKIP clipboard_write (native socket unavailable)")
  }

  await runCheck("lsp_servers_available", async () => {
    await callTool(client, "lsp_servers_available")
  })

  const tsTarget = path.join(workspace, "src", "index.ts")
  if (fs.existsSync(tsTarget)) {
    const servers = getStructured(await callTool(client, "lsp_servers_available"))
    if (servers.typescript) {
      await runCheck("lsp_hover", async () => {
        const result = getStructured(await callTool(client, "lsp_hover", { path: tsTarget, line: 0, column: 1 }))
        const payload = result.result as Record<string, unknown> | null | undefined
        if (payload === undefined) {
          throw new Error("No hover result")
        }
      })
    } else {
      console.log("SKIP lsp_hover (typescript-language-server not found)")
    }
  }

  if (terminalWebSocket?.available) {
    await runCheck("terminal_ui_exec", async () => {
      const result = getStructured(await callTool(client, "terminal_ui_exec", { command: "echo mcp-phase2-works", keepAlive: false }))
      if (result.success === false || !String(result.output ?? "").includes("mcp-phase2-works")) {
        throw new Error("terminal_ui_exec failed")
      }
    })
  } else {
    console.log("SKIP terminal_ui_exec (terminal WebSocket unavailable)")
  }

  await transport.close()
  fs.rmSync(smokeFile, { force: true })
  if (hasFailure) {
    process.exitCode = 1
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
