# Apex MCP Agent

<div align="center">

**A fully autonomous AI coding agent that lives inside VS Code.**

[![Version](https://img.shields.io/badge/Version-1.0.0-blue?style=flat-square)](https://github.com/ratnam-sanjay/extension/releases)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blueviolet?style=flat-square&logo=visualstudiocode)](https://code.visualstudio.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey?style=flat-square)](https://github.com/ratnam-sanjay/extension/releases)

> Give it a task. It plans, executes, validates, and rolls back — on its own.

</div>

---

## What is Apex MCP Agent?

Apex MCP Agent is a VS Code extension that runs a **fully autonomous coding loop** powered by Claude (Anthropic). Unlike Copilot or other autocomplete tools, Apex doesn't just suggest — it **acts**. It reads your codebase, plans a solution, writes code, runs tests, fixes errors, and iterates until the task is done.

Built with 50+ tools, real session safety controls, and MCP (Model Context Protocol) support — this is autonomous coding at the agent level, not the autocomplete level.

---

## Demo

> 📹 *[Add demo GIF or video here]*

---

## Features

### 🤖 Fully Autonomous Agent Loop
- Reads the task → plans the approach → executes step by step → validates output → rolls back on failure
- Persistent session memory across steps
- Parallel sub-task execution for complex requests
- Streaming output so you see every action in real time

### 🛠️ 50+ Built-in Tools

**File Operations**
- Read, write, create, delete, rename files
- List directories with recursive search
- Apply surgical diffs to existing files

**Code Intelligence**
- Search codebase by text or pattern
- Get VS Code diagnostics (errors, warnings)
- Analyze code structure and dependencies
- Run tests and parse results

**Git Integration**
- Commit, diff, branch, push, pull, stash
- View git log and status
- Auto-generate commit messages

**Terminal & Process**
- Run shell commands inside VS Code terminal
- Manage background processes
- Stream terminal output back to agent

**Package Managers**
- npm, pip install/uninstall/list
- Auto-detect and use correct package manager

**Database Tools**
- Query SQLite and other local databases directly

**API Testing**
- Make HTTP requests from within the agent

**Container Support**
- Docker operations from the agent loop

### 🔒 Production Safety Controls

This is not a toy agent. Every dangerous action is gated:

| Safety Feature | What it does |
|---|---|
| **Confirmation for destructive actions** | Asks before deleting files or running risky commands |
| **Read-only analysis mode** | Lets the agent analyze your codebase without writing anything |
| **Emergency kill switch** | Instantly halts all agent activity mid-loop |
| **Session history** | Every action logged — see exactly what the agent did |
| **Rollback last action** | Undo the most recent agent change instantly |
| **Failure loop threshold** | Auto-halts after N consecutive failures |
| **Blocked paths** | `.git`, `.env`, `.secret`, `node_modules` blocked by default |
| **Max steps per session** | Configurable hard limit on how many steps the agent takes |

### 🔌 MCP Protocol Support
- Built-in MCP server that other AI tools can connect to
- Start MCP server in terminal with one command
- Compatible with Claude Desktop, ApexIDE, and any MCP client

### 🗂️ VS Code Sidebar Panel
- **Agent Control** — start, pause, stop, kill switch all in one panel
- **Action History** — full log of every tool call and result
- **Session Memory** — what the agent knows about your project

---

## Installation

### Option 1 — Install from .vsix (Recommended)

1. Download `apex-1.0.0.vsix` from [Releases](https://github.com/ratnam-sanjay/extension/releases/latest)
2. Open VS Code
3. Press `Ctrl+Shift+P` → type `Install from VSIX`
4. Select the downloaded `.vsix` file
5. Reload VS Code

### Option 2 — Install via command line

```bash
code --install-extension apex-1.0.0.vsix
```

---

## Distribution Note

This repository contains only the distributable `.vsix` file and this `README.md`. The full source code is not included here.

## License Key & Support

For license key requests and direct support via WhatsApp, contact: +91 70134 82085. Please do not share license keys publicly.

---

## Setup

### 1. Get an Anthropic API Key

Sign up at [console.anthropic.com](https://console.anthropic.com) and create an API key.

### 2. Add your API Key in VS Code

Press `Ctrl+Shift+P` → `Apex MCP: Manage License` → Enter your License key.

### 3. Open a project and start the agent

Press `Ctrl+Shift+P` → `Apex MCP: Start Agent`

Or click the **robot icon** in the VS Code activity bar → Agent Control panel → ▶ Start.

---

## Usage

### Basic Usage

Open the Apex MCP panel from the activity bar (robot icon). Type your task in the Agent Control panel and hit Start:

```
"Refactor the authentication module to use JWT instead of sessions"
"Find all TODO comments in the codebase and create a summary file"
"Write unit tests for every function in utils/helpers.ts"
"Fix the TypeScript errors in the src/api folder"
```

The agent will plan, execute, and report back — showing every action in the Action History panel.

### Read-Only Analysis Mode

Want the agent to analyze without touching any files?

`Ctrl+Shift+P` → `Apex MCP: Toggle Read-Only Analysis Mode`

Perfect for understanding an unfamiliar codebase safely.

### Emergency Stop

If the agent is doing something wrong:
- Click the **kill switch button** (⚠ icon) in the Agent Control panel
- Or `Ctrl+Shift+P` → `Apex MCP: Emergency Kill Switch`

Instantly halts the agent mid-loop. No partial writes are left behind.

### Rollback

Made a mistake? Undo the last agent action:

`Ctrl+Shift+P` → `Apex MCP: Rollback Last Action`

---

## Configuration

All settings available in VS Code settings (`Ctrl+,` → search "Apex MCP"):

| Setting | Default | Description |
|---|---|---|
| `apex-mcp.maxStepsPerSession` | 100 | Max steps before agent auto-halts |
| `apex-mcp.maxToolCallsPerStep` | 10 | Max tool calls per agent step |
| `apex-mcp.failureLoopThreshold` | 3 | Consecutive failures before halting |
| `apex-mcp.confirmDestructiveActions` | true | Confirm before deletes/overwrites |
| `apex-mcp.blockedPaths` | `.git`, `.env`, `node_modules` | Paths agent cannot access |
| `apex-mcp.readOnlyMode` | false | Enable read-only analysis mode |
| `apex-mcp.mcpServerPort` | 0 (auto) | Port for MCP server |

---

## MCP Server

Apex MCP Agent includes a built-in MCP server you can connect to from other AI tools.

### Start the MCP Server

`Ctrl+Shift+P` → `Apex MCP: Start MCP Server in Terminal`

### Connect from Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "apex-vscode": {
      "command": "node",
      "args": ["path/to/apex-mcp-server.js"],
      "env": {}
    }
  }
}
```

---

## Commands

All commands available via `Ctrl+Shift+P` → type "Apex MCP":

| Command | Description |
|---|---|
| `Apex MCP: Start Agent` | Start the autonomous agent loop |
| `Apex MCP: Pause Agent` | Pause mid-execution |
| `Apex MCP: Stop Agent` | Stop and end current session |
| `Apex MCP: Emergency Kill Switch` | Instantly halt everything |
| `Apex MCP: Toggle Read-Only Mode` | Switch between read-only and write mode |
| `Apex MCP: View Session History` | See all actions from current session |
| `Apex MCP: Rollback Last Action` | Undo the most recent agent change |
| `Apex MCP: Start MCP Server in Terminal` | Start MCP server for external connections |
| `Apex MCP: Manage License` | Add or update your API key |
| `Apex MCP: Check License Status` | Verify your license |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| AI Model | Claude (Anthropic) via `@anthropic-ai/sdk` |
| Protocol | MCP via `@modelcontextprotocol/sdk` |
| Auth | Firebase Admin SDK |
| Real-time | WebSocket (`ws`) |
| Build | esbuild + tsc |
| Platform | VS Code Extension API (v1.85+) |

---

## Requirements

- VS Code 1.85 or higher
- Node.js 18+ (for MCP server features)
- Anthropic API key
- Internet connection (for AI calls)

---

## FAQ

**Q: Is the source code available?**
A: The extension is closed-source. The `.vsix` is free to download and use.

**Q: What AI model does it use?**
A: Claude by Anthropic. You need your own API key from [console.anthropic.com](https://console.anthropic.com).

**Q: Does it work offline?**
A: No — AI features require an internet connection to call the Anthropic API.

**Q: How is this different from GitHub Copilot?**
A: Copilot autocompletes. Apex MCP Agent autonomously executes multi-step tasks — it plans, writes, runs, validates, and fixes — without you touching the keyboard.

**Q: Is my code sent anywhere?**
A: Your code context is sent to Anthropic's API to generate responses. It is not stored by this extension. See [Anthropic's privacy policy](https://anthropic.com/privacy).

**Q: Can I use it with other AI tools?**
A: Yes — via the built-in MCP server. Any MCP-compatible client (Claude Desktop, ApexIDE, etc.) can connect to it.

---

## Roadmap

- [ ] Local LLM support (Ollama)
- [ ] Multi-file diff review before applying
- [ ] Agent personas (junior dev, senior reviewer, test engineer)
- [ ] GitHub Actions integration
- [ ] Marketplace publish

---

## Built By

**Ratnam Sanjay** — Built as part of the Apex ecosystem (ApexIDE + Apex MCP Agent + AndroidMCP Bridge).

- 🌐 Portfolio: [sanjay-r.netlify.app](https://sanjay-r.netlify.app)
- 🐙 GitHub: [@ratnam-sanjay](https://github.com/ratnam-sanjay)
- 💼 LinkedIn: [linkedin.com/in/ratnam-sanjay](https://linkedin.com/in/ratnam-sanjay)

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

⭐ **Star this repo if Apex MCP Agent helped you ship faster!** ⭐

</div>
