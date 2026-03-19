# Apex MCP Agent

<div align="center">

**Give Claude Desktop superpowers inside your VS Code workspace.**

[![Version](https://img.shields.io/badge/Version-1.0.0-blue?style=flat-square)](https://github.com/Sanju08065/Apex-MCP)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.85+-blueviolet?style=flat-square&logo=visualstudiocode)](https://code.visualstudio.com)
[![MCP](https://img.shields.io/badge/Protocol-MCP-orange?style=flat-square)](https://modelcontextprotocol.io)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

> Install the extension. Open a project. Claude Desktop can now read, write, and control your entire codebase — live, in real time.

</div>

---

## How It Works

Most AI tools make you copy-paste code back and forth. Apex MCP Agent eliminates that entirely.

When you open a project in VS Code with this extension installed:

1. **The extension automatically starts an MCP server** for your current workspace
2. **It auto-updates your Claude Desktop config** (`claude_desktop_config.json`) with the correct server path and workspace root
3. **Claude Desktop connects directly** to your VS Code workspace via MCP
4. **Claude can now read files, write code, apply diffs, run commands** — all live inside your editor

No API keys. No manual config. No copy-paste. Just open your project and start talking to Claude Desktop.

```
Claude Desktop  ──── MCP (stdio) ────  Apex MCP Server  ────  Your VS Code Workspace
```

---

## Demo

> 📹 *[Add demo GIF or video here — show Claude Desktop writing a file that appears live in VS Code]*

---

## Features

### ⚡ Zero Setup — Auto-Config
- Extension detects your workspace on open
- Automatically updates `claude_desktop_config.json` with correct workspace path
- Claude Desktop connects immediately — no manual JSON editing ever

### 🎬 Live Streaming in VS Code Editor
- When Claude creates or edits a file, you **watch it happen token by token** in your VS Code editor
- File appears in the explorer, opens automatically, content streams in real time
- Diff application shows old vs new content live as changes are applied

### 🛠️ 50+ Tools Available to Claude

**File Operations**
- Create, read, write, delete, rename files
- Apply surgical diffs to existing files (line-by-line edits)
- List directories recursively
- Search codebase by text or regex pattern

**Code Intelligence**
- Get VS Code diagnostics (errors, warnings, hints)
- Analyze code structure and dependencies
- Run tests and parse results
- Request user input interactively

**Git Integration**
- Commit, diff, branch, push, pull, stash
- View git log and status
- Auto-generate commit messages

**Terminal & Process**
- Run shell commands directly
- Manage background processes
- Stream terminal output back to Claude

**Package Managers**
- npm, pip install/uninstall/list
- Auto-detect correct package manager per project

**Database**
- Query SQLite databases directly from Claude

**API Testing**
- Make HTTP requests from within the agent loop

**Container Support**
- Docker operations — ps, images, run, stop, logs

### 🔒 Built-in Safety Controls

| Control | What it does |
|---|---|
| **Blocked paths** | `.git`, `.env`, `.secret`, `.ssh`, `node_modules` — Claude cannot touch these |
| **Dangerous command guard** | Blocks `rm -rf /`, `format c:`, and other destructive commands |
| **Max file size** | 10MB read limit, 5MB content limit per operation |
| **Binary file protection** | Skips `.png`, `.exe`, `.vsix`, `.zip` and other binary files automatically |
| **Confirmation for destructive actions** | Asks before deleting or overwriting |
| **Read-only analysis mode** | Let Claude analyze without writing anything |
| **Emergency kill switch** | Instantly halt all agent activity |
| **Session history** | Every action logged in VS Code sidebar |
| **Rollback** | Undo the last agent change instantly |

### 🗂️ VS Code Sidebar Panel
- **Agent Control** — start, pause, stop, kill switch
- **Action History** — full log of every tool call and result
- **Session Memory** — what Claude knows about your project

---

## Installation

### Step 1 — Install the Extension

**Option A — From .vsix file:**
1. Download `apex-1.0.0.vsix` from [Releases](https://github.com/Sanju08065/Apex-MCP)
2. Open VS Code
3. Press `Ctrl+Shift+P` → `Extensions: Install from VSIX`
4. Select the downloaded file
5. Reload VS Code


### Step 2 — Install Claude Desktop

Download Claude Desktop from [claude.ai/download](https://claude.ai/download) if you haven't already.

### Step 3 — Open Your Project

Open any folder in VS Code. The extension automatically:
- Starts the MCP server for that workspace
- Updates your Claude Desktop config with the correct paths

### Step 4 — Restart Claude Desktop

Restart Claude Desktop once after the first install so it picks up the new MCP server config.

**That's it.** Open Claude Desktop and start talking about your codebase.

---

## Usage

Once installed, just open Claude Desktop and talk naturally about your project:

```
"Read the src/index.ts file and explain what it does"

"Create a new file called utils/helpers.ts with these functions..."

"Find all TODO comments in the codebase and list them"

"Fix the TypeScript errors in src/api/routes.ts"

"Refactor the authentication module to use JWT"

"Write unit tests for every function in utils/math.ts"

"Show me the git diff and write a commit message"
```

Claude will use the MCP tools to read, write, and modify your files directly — and you'll see every change happen live in your VS Code editor.

---

## Live Streaming — How It Works

When Claude writes a file through Apex MCP:

1. Claude calls the `create_file` tool with path and content
2. The MCP server creates the file and writes a streaming marker to `.vscode/.apex-streaming/`
3. The VS Code extension picks up the marker via file watcher
4. The file opens in your editor and content streams in token by token
5. You watch Claude type — live

Same for `apply_diff` — you see the old lines replaced with new lines in real time.

---

## Auto-Config — How It Works

When you open a folder in VS Code with Apex MCP installed:

1. Extension reads your current workspace path
2. Finds your Claude Desktop config file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Adds or updates the `apex-vscode` MCP server entry with the correct workspace root
4. Saves the config — no manual editing needed

After the first setup, switching projects is automatic. Open a new folder, the config updates.

---

## Configuration

All settings in VS Code (`Ctrl+,` → search "Apex MCP"):

| Setting | Default | Description |
|---|---|---|
| `apex-mcp.maxStepsPerSession` | 100 | Max agent steps before auto-halt |
| `apex-mcp.maxToolCallsPerStep` | 10 | Max tool calls per step |
| `apex-mcp.failureLoopThreshold` | 3 | Consecutive failures before halting |
| `apex-mcp.confirmDestructiveActions` | true | Confirm before deletes/overwrites |
| `apex-mcp.blockedPaths` | `.git`, `.env`, `node_modules` | Paths Claude cannot access |
| `apex-mcp.readOnlyMode` | false | Analysis-only mode (no writes) |
| `apex-mcp.mcpServerPort` | 0 (auto) | MCP server port |

---

## Commands

All commands via `Ctrl+Shift+P` → type "Apex MCP":

| Command | Description |
|---|---|
| `Apex MCP: Start Agent` | Start the MCP server and agent loop |
| `Apex MCP: Pause Agent` | Pause mid-execution |
| `Apex MCP: Stop Agent` | Stop current session |
| `Apex MCP: Emergency Kill Switch` | Instantly halt everything |
| `Apex MCP: Toggle Read-Only Mode` | Switch analysis vs write mode |
| `Apex MCP: View Session History` | See all actions this session |
| `Apex MCP: Rollback Last Action` | Undo last agent change |
| `Apex MCP: Start MCP Server in Terminal` | Manually start MCP server |
| `Apex MCP: Manage License` | License management |
| `Apex MCP: Check License Status` | Verify license |

---

## Requirements

- VS Code 1.85 or higher
- Claude Desktop (free — [claude.ai/download](https://claude.ai/download))
- Node.js 18+ (bundled with extension)
- Windows, macOS, or Linux

**No Anthropic API key required.** Claude Desktop handles all AI — Apex MCP just provides the tools.

---

## FAQ

**Q: Do I need an API key?**
A: No. Apex MCP Agent has no AI of its own. It runs an MCP server that Claude Desktop connects to. Claude Desktop handles all the AI — you just need a free Claude account.

**Q: How is this different from just using Claude Desktop normally?**
A: Without Apex MCP, Claude Desktop can only read/write files through its built-in tools with limited workspace access. With Apex MCP, Claude gets 50+ specialized tools — surgical diffs, git operations, terminal commands, test runners, database queries, live streaming — all scoped to your exact workspace.

**Q: Does it modify my files automatically?**
A: Only when Claude calls a write tool. By default, destructive actions require confirmation. You can also enable read-only mode for pure analysis.

**Q: Is my code sent anywhere?**
A: Your code is sent to Anthropic's API through Claude Desktop (same as using Claude Desktop normally). The Apex MCP extension itself does not send your code anywhere — it only provides tools to Claude.


**Q: Can I use it with multiple projects?**
A: Yes. Every time you open a different folder in VS Code, the config updates to point to that workspace.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| MCP Protocol | `@modelcontextprotocol/sdk` |
| Transport | stdio (Claude Desktop ↔ Extension) |
| Live Streaming | VS Code file watcher + marker files |
| Auth | Firebase Admin SDK |
| Real-time IPC | OS temp directory marker files |
| Build | esbuild + tsc |
| Platform | VS Code Extension API (1.85+) |

---

## Roadmap

- [ ] Auto-restart MCP server on VS Code reload
- [ ] Multi-workspace support (monorepos)
- [ ] Tool usage analytics in sidebar
- [ ] Custom tool plugins
- [ ] Marketplace publish

---

## Built By

**Ratnam Sanjay** — Building the Apex ecosystem solo

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Contact me for license key — WhatsApp: [+91 70134 82085](https://wa.me/917013482085)
---

<div align="center">

⭐ **Star this if Apex MCP made Claude Desktop 10x more useful for you!** ⭐

</div>
