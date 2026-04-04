# shrinking-server

`shrinking-server` is a branded fork of `code-server` that ships a browser-hosted VS Code experience, the bundled `Islands Dark` default theme work in this repo, and an optional MCP server for AI-driven workspace control.

Repository:
`https://github.com/xgauravyaduvanshii/shrinking-server`

Author:
`xgauravyaduvanshii <xgauravyaduvanshii@gmail.com>`

## What This Repo Includes

- `shrinking-server`: the main browser IDE server built from the `code-server` codebase
- `shrinking-server-mcp`: a standalone MCP server for files, terminals, search, git, extensions, and bridge features
- bundled theme work for a custom default startup experience
- an installer script that can install the server and MCP together

## Quick Install

Preview:

```bash
curl -fsSL https://raw.githubusercontent.com/xgauravyaduvanshii/shrinking-server/main/code-server/install.sh | sh -s -- --dry-run
```

Install:

```bash
curl -fsSL https://raw.githubusercontent.com/xgauravyaduvanshii/shrinking-server/main/code-server/install.sh | sh
```

The installer:

- installs `shrinking-server`
- prints the run/start instructions
- installs `shrinking-server-mcp` too when `npm` is available

## Project Layout

- [install.sh](/home/ubuntu/flyingdarkdev-server/code-server/install.sh)
  Main installer for this fork
- [docs/README.md](/home/ubuntu/flyingdarkdev-server/code-server/docs/README.md)
  Product overview and getting started
- [code-server-mcp/README.md](/home/ubuntu/flyingdarkdev-server/code-server/code-server-mcp/README.md)
  MCP setup and usage
- [package.json](/home/ubuntu/flyingdarkdev-server/code-server/package.json)
  Main package metadata

## Local Development

```bash
cd /home/ubuntu/flyingdarkdev-server/code-server
git submodule update --init --recursive
npm install
npm run build
```

For MCP:

```bash
cd /home/ubuntu/flyingdarkdev-server/code-server/code-server-mcp
npm install
npm run build
```

## Main Links

- Repo: `https://github.com/xgauravyaduvanshii/shrinking-server`
- Issues: `https://github.com/xgauravyaduvanshii/shrinking-server/issues`
- Installer: `https://raw.githubusercontent.com/xgauravyaduvanshii/shrinking-server/main/code-server/install.sh`
