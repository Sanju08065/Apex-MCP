#!/usr/bin/env node
/**
 * =============================================================================
 * APEX MCP AGENT - AUTONOMOUS AGENT WITH CONTINUOUS LOOP
 * =============================================================================
 * 
 * Robust MCP Server with autonomous agent capabilities.
 * All tools are production-ready with proper error handling.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// =============================================================================
// CONFIGURATION
// =============================================================================

const BLOCKED_PATHS = ['.git', '.env', '.secret', '.ssh', '.aws', '__pycache__'];
const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.exe', '.dll', '.woff', '.ttf', '.vsix', '.bin', '.dat'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_CONTENT_LENGTH = 5 * 1024 * 1024; // 5MB for content strings
const DANGEROUS_COMMANDS = ['rm -rf /', 'format c:', 'del /f /s /q c:', 'mkfs', 'dd if='];
const IPC_DIR = path.join(os.tmpdir(), 'apex-mcp-ipc');

// =============================================================================
// TYPES
// =============================================================================

interface MCPRequest {
    jsonrpc: '2.0';
    id?: string | number;
    method: string;
    params?: Record<string, unknown>;
}

interface UserInputRequest {
    id: string;
    prompt: string;
    placeholder?: string;
    timestamp: number;
}

interface UserInputResponse {
    id: string;
    input: string | null;
    cancelled: boolean;
    timestamp: number;
}

interface ToolResult {
    success: boolean;
    message?: string;
    data?: unknown;
    error?: string;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function safeString(value: unknown, defaultValue: string = ''): string {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'string') return value;
    try {
        return String(value);
    } catch {
        return defaultValue;
    }
}

function safeNumber(value: unknown, defaultValue: number): number {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
}

function safeBoolean(value: unknown, defaultValue: boolean = false): boolean {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 1) return true;
    if (value === 'false' || value === 0) return false;
    return defaultValue;
}

function safeArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map(v => safeString(v)).filter(v => v.length > 0);
    }
    return [];
}

function truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + '... [truncated]';
}

// =============================================================================
// APEX AGENT SERVER
// =============================================================================

class ApexAgent {
    private inputBuffer = '';
    private workspaceRoot: string;
    private backups: Array<{ path: string; content: string; time: number; operation: string }> = [];
    private currentTask = '';
    private thinkingLog: string[] = [];
    private iterationCount = 0;
    private operationLog: string[] = [];

    private readonly tools = [
        // AGENT LOOP TOOLS
        {
            name: 'agent_loop',
            description: '🤖 START THE AUTONOMOUS AGENT LOOP. Call this FIRST with your task.',
            inputSchema: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'The task or goal to accomplish' }
                },
                required: ['task']
            }
        },
        {
            name: 'get_user_input',
            description: '📝 GET INPUT FROM USER via VS Code GUI. Call this to continue the conversation loop.',
            inputSchema: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Message to show the user' },
                    placeholder: { type: 'string', description: 'Placeholder text' }
                },
                required: ['prompt']
            }
        },
        {
            name: 'think',
            description: 'Record your thinking process for planning and reasoning.',
            inputSchema: {
                type: 'object',
                properties: {
                    thought: { type: 'string', description: 'Your reasoning or analysis' }
                },
                required: ['thought']
            }
        },
        {
            name: 'task_complete',
            description: 'Mark the current task as COMPLETE.',
            inputSchema: {
                type: 'object',
                properties: {
                    summary: { type: 'string', description: 'Summary of what was accomplished' },
                    filesModified: { type: 'array', items: { type: 'string' }, description: 'List of modified files' }
                },
                required: ['summary']
            }
        },
        // FILE TOOLS
        {
            name: 'read_file',
            description: 'Read file contents with optional line range.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path relative to workspace' },
                    startLine: { type: 'number', description: 'Start line (1-indexed, optional)' },
                    endLine: { type: 'number', description: 'End line (1-indexed, optional)' }
                },
                required: ['path']
            }
        },
        {
            name: 'list_directory',
            description: 'List directory contents with optional recursion.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path (default: workspace root)' },
                    recursive: { type: 'boolean', description: 'List recursively (default: false)' },
                    maxDepth: { type: 'number', description: 'Max depth for recursion (default: 3, max: 10)' }
                },
                required: ['path']
            }
        },
        {
            name: 'create_file',
            description: 'Create a new file or overwrite existing. Creates parent directories automatically.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path to create' },
                    content: { type: 'string', description: 'File content' },
                    overwrite: { type: 'boolean', description: 'Overwrite if exists (default: false)' }
                },
                required: ['path', 'content']
            }
        },
        {
            name: 'apply_diff',
            description: 'Search and replace text in a file. Supports multiple replacements.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path' },
                    oldText: { type: 'string', description: 'Text to find (exact match)' },
                    newText: { type: 'string', description: 'Replacement text' },
                    replaceAll: { type: 'boolean', description: 'Replace all occurrences (default: false)' }
                },
                required: ['path', 'oldText', 'newText']
            }
        },
        {
            name: 'search_codebase',
            description: 'Search for text patterns across files using regex.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Search pattern (regex supported)' },
                    path: { type: 'string', description: 'Directory to search (default: workspace root)' },
                    filePattern: { type: 'string', description: 'File pattern like *.ts, *.js' },
                    caseSensitive: { type: 'boolean', description: 'Case sensitive search (default: false)' },
                    maxResults: { type: 'number', description: 'Max results (default: 50, max: 100)' }
                },
                required: ['query']
            }
        },
        {
            name: 'run_command',
            description: 'Execute a shell command in the workspace.',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to execute' },
                    cwd: { type: 'string', description: 'Working directory (default: workspace root)' },
                    timeout: { type: 'number', description: 'Timeout in ms (default: 30000, max: 120000)' }
                },
                required: ['command']
            }
        },
        {
            name: 'delete_file',
            description: 'Delete a file or empty directory. Creates backup before deletion.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to delete' },
                    force: { type: 'boolean', description: 'Force delete non-empty directory (default: false)' }
                },
                required: ['path']
            }
        },
        {
            name: 'append_file',
            description: 'Append content to an existing file.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'File path' },
                    content: { type: 'string', description: 'Content to append' }
                },
                required: ['path', 'content']
            }
        },
        {
            name: 'get_file_info',
            description: 'Get detailed file or directory metadata.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to check' }
                },
                required: ['path']
            }
        },
        {
            name: 'move_file',
            description: 'Move or rename a file or directory.',
            inputSchema: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Source path' },
                    destination: { type: 'string', description: 'Destination path' }
                },
                required: ['source', 'destination']
            }
        },
        {
            name: 'copy_file',
            description: 'Copy a file or directory.',
            inputSchema: {
                type: 'object',
                properties: {
                    source: { type: 'string', description: 'Source path' },
                    destination: { type: 'string', description: 'Destination path' }
                },
                required: ['source', 'destination']
            }
        },
        {
            name: 'rollback',
            description: 'Undo the last file modification.',
            inputSchema: { type: 'object', properties: {}, required: [] }
        },
        {
            name: 'get_diagnostics',
            description: 'Get workspace diagnostics and statistics.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Path to analyze (default: workspace root)' }
                },
                required: []
            }
        },
        // ===================== P0 - GIT TOOLS =====================
        {
            name: 'git_status',
            description: '🔀 Get Git repository status with branch info, staged/unstaged changes',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Repository path (default: workspace)' }
                },
                required: []
            }
        },
        {
            name: 'git_diff',
            description: '📊 View Git changes/diff for files',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Repository path' },
                    file: { type: 'string', description: 'Specific file to diff' },
                    staged: { type: 'boolean', description: 'Show staged changes' }
                },
                required: []
            }
        },
        {
            name: 'git_commit',
            description: '✅ Create a Git commit',
            inputSchema: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Commit message' },
                    files: { type: 'array', description: 'Files to stage (all if empty)' },
                    path: { type: 'string', description: 'Repository path' }
                },
                required: ['message']
            }
        },
        {
            name: 'git_branch',
            description: '🌿 Git branch operations: list, create, checkout, delete, merge',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action: list, create, checkout, delete, merge' },
                    name: { type: 'string', description: 'Branch name' },
                    path: { type: 'string', description: 'Repository path' }
                },
                required: ['action']
            }
        },
        {
            name: 'git_log',
            description: '📜 View Git commit history',
            inputSchema: {
                type: 'object',
                properties: {
                    maxCount: { type: 'number', description: 'Max commits to return (default: 10)' },
                    path: { type: 'string', description: 'Repository path' },
                    file: { type: 'string', description: 'Show history for specific file' }
                },
                required: []
            }
        },
        {
            name: 'git_push',
            description: '⬆️ Push commits to remote repository',
            inputSchema: {
                type: 'object',
                properties: {
                    remote: { type: 'string', description: 'Remote name (default: origin)' },
                    branch: { type: 'string', description: 'Branch name' },
                    force: { type: 'boolean', description: 'Force push' },
                    path: { type: 'string', description: 'Repository path' }
                },
                required: []
            }
        },
        {
            name: 'git_pull',
            description: '⬇️ Pull changes from remote repository',
            inputSchema: {
                type: 'object',
                properties: {
                    remote: { type: 'string', description: 'Remote name (default: origin)' },
                    branch: { type: 'string', description: 'Branch name' },
                    rebase: { type: 'boolean', description: 'Use rebase instead of merge' },
                    path: { type: 'string', description: 'Repository path' }
                },
                required: []
            }
        },
        {
            name: 'git_stash',
            description: '📦 Git stash operations: push, pop, list, apply, drop',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action: push, pop, list, apply, drop' },
                    message: { type: 'string', description: 'Stash message (for push)' },
                    index: { type: 'number', description: 'Stash index' },
                    path: { type: 'string', description: 'Repository path' }
                },
                required: ['action']
            }
        },
        // ===================== P0 - PACKAGE MANAGERS =====================
        {
            name: 'npm_tool',
            description: '📦 NPM package manager: install, uninstall, update, list, audit, run scripts',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action: install, uninstall, update, list, audit, run, outdated' },
                    packages: { type: 'array', description: 'Package names' },
                    dev: { type: 'boolean', description: 'Install as devDependency' },
                    script: { type: 'string', description: 'Script name for run action' },
                    path: { type: 'string', description: 'Project path' }
                },
                required: ['action']
            }
        },
        {
            name: 'pip_tool',
            description: '🐍 Python pip: install, uninstall, list, freeze, show packages',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action: install, uninstall, list, freeze, show' },
                    packages: { type: 'array', description: 'Package names' },
                    requirements: { type: 'string', description: 'Path to requirements.txt' },
                    path: { type: 'string', description: 'Project path' }
                },
                required: ['action']
            }
        },
        // ===================== P1 - TESTING TOOLS =====================
        {
            name: 'test_runner',
            description: '🧪 Universal test runner: Jest, pytest, Mocha, Vitest, etc.',
            inputSchema: {
                type: 'object',
                properties: {
                    framework: { type: 'string', description: 'Framework: jest, pytest, mocha, vitest, auto' },
                    pattern: { type: 'string', description: 'Test file pattern' },
                    filter: { type: 'string', description: 'Test name filter' },
                    coverage: { type: 'boolean', description: 'Generate coverage' },
                    path: { type: 'string', description: 'Project path' }
                },
                required: []
            }
        },
        // ===================== P1 - DATABASE TOOLS =====================
        {
            name: 'db_query',
            description: '🗄️ Execute SQL queries on PostgreSQL, MySQL, SQLite',
            inputSchema: {
                type: 'object',
                properties: {
                    type: { type: 'string', description: 'Database: postgres, mysql, sqlite' },
                    query: { type: 'string', description: 'SQL query' },
                    database: { type: 'string', description: 'Database name or file path' },
                    host: { type: 'string', description: 'Database host' },
                    port: { type: 'number', description: 'Database port' },
                    username: { type: 'string', description: 'Username' }
                },
                required: ['type', 'query']
            }
        },
        // ===================== P1 - PROCESS MANAGEMENT =====================
        {
            name: 'process_start',
            description: '🚀 Start a background process',
            inputSchema: {
                type: 'object',
                properties: {
                    command: { type: 'string', description: 'Command to run' },
                    args: { type: 'array', description: 'Command arguments' },
                    cwd: { type: 'string', description: 'Working directory' },
                    detach: { type: 'boolean', description: 'Run in background' }
                },
                required: ['command']
            }
        },
        {
            name: 'process_list',
            description: '📋 List running processes',
            inputSchema: {
                type: 'object',
                properties: {},
                required: []
            }
        },
        {
            name: 'process_kill',
            description: '🛑 Kill a process by PID or name',
            inputSchema: {
                type: 'object',
                properties: {
                    pid: { type: 'number', description: 'Process ID' },
                    name: { type: 'string', description: 'Process name pattern' },
                    signal: { type: 'string', description: 'Signal: SIGTERM, SIGKILL' }
                },
                required: []
            }
        },
        // ===================== P2 - CODE ANALYSIS =====================
        {
            name: 'linter',
            description: '🔍 Run linter: ESLint, Pylint, etc.',
            inputSchema: {
                type: 'object',
                properties: {
                    tool: { type: 'string', description: 'Linter: eslint, pylint, auto' },
                    path: { type: 'string', description: 'File or directory' },
                    fix: { type: 'boolean', description: 'Auto-fix issues' }
                },
                required: []
            }
        },
        // ===================== P2 - API TESTING =====================
        {
            name: 'http_request',
            description: '🌐 Make HTTP requests for API testing',
            inputSchema: {
                type: 'object',
                properties: {
                    method: { type: 'string', description: 'HTTP method: GET, POST, PUT, DELETE' },
                    url: { type: 'string', description: 'Request URL' },
                    headers: { type: 'object', description: 'Request headers' },
                    body: { type: 'string', description: 'Request body (JSON)' },
                    timeout: { type: 'number', description: 'Timeout in ms' }
                },
                required: ['url']
            }
        },
        // ===================== P2 - DOCKER =====================
        {
            name: 'docker',
            description: '🐳 Docker: ps, images, run, stop, logs, exec, build',
            inputSchema: {
                type: 'object',
                properties: {
                    action: { type: 'string', description: 'Action: ps, images, run, stop, logs, exec, build, pull' },
                    target: { type: 'string', description: 'Container/image name' },
                    image: { type: 'string', description: 'Image name for run' },
                    command: { type: 'string', description: 'Command for exec' },
                    ports: { type: 'array', description: 'Port mappings' }
                },
                required: ['action']
            }
        }
    ];

    constructor() {
        this.workspaceRoot = path.resolve(process.argv[2] || process.cwd());
        this.ensureIpcDir();
    }

    private ensureIpcDir(): void {
        try {
            if (!fs.existsSync(IPC_DIR)) {
                fs.mkdirSync(IPC_DIR, { recursive: true });
            }
        } catch (e) {
            this.log(`Warning: Could not create IPC directory: ${e}`);
        }
    }

    start(): void {
        this.log('═══════════════════════════════════════════════════════════');
        this.log('  🤖 APEX MCP AGENT - Production Server');
        this.log('═══════════════════════════════════════════════════════════');
        this.log(`Workspace: ${this.workspaceRoot}`);
        this.log(`Tools: ${this.tools.length}`);
        this.log(`IPC Dir: ${IPC_DIR}`);
        this.log('Ready for MCP client connection...');
        this.log('───────────────────────────────────────────────────────────');

        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                this.inputBuffer += chunk;
                const lines = this.inputBuffer.split('\n');
                this.inputBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim()) this.processMessage(line.trim());
                }
            }
        });
        process.stdin.on('end', () => process.exit(0));
        process.stdin.on('error', (e) => this.log(`stdin error: ${e}`));
    }

    private async processMessage(msg: string): Promise<void> {
        let req: MCPRequest;
        try {
            req = JSON.parse(msg);
        } catch {
            return this.send({ jsonrpc: '2.0', id: 0, error: { code: -32700, message: 'Parse error' } });
        }

        if (req.jsonrpc !== '2.0') return;

        this.log(`← ${req.method}`);

        try {
            let result: unknown;
            switch (req.method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'apex-mcp-agent', version: '2.0.0' }
                    };
                    break;
                case 'initialized':
                    result = null;
                    break;
                case 'tools/list':
                    result = { tools: this.tools };
                    break;
                case 'tools/call':
                    result = await this.executeTool(req.params as { name: string; arguments?: Record<string, unknown> });
                    break;
                default:
                    result = {};
            }
            if (req.id !== undefined) {
                this.send({ jsonrpc: '2.0', id: req.id, result });
            }
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            if (req.id !== undefined) {
                this.send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: errorMsg } });
            }
        }
    }

    private async executeTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<object> {
        const name = safeString(params?.name);
        const args = params?.arguments || {};

        this.log(`🔧 ${name}`);

        try {
            let result: ToolResult | string;

            switch (name) {
                case 'agent_loop': result = await this.agentLoop(args); break;
                case 'get_user_input': result = await this.getUserInput(args); break;
                case 'think': result = await this.think(args); break;
                case 'task_complete': result = await this.taskComplete(args); break;
                case 'read_file': result = await this.readFile(args); break;
                case 'list_directory': result = await this.listDirectory(args); break;
                case 'create_file': result = await this.createFile(args); break;
                case 'apply_diff': result = await this.applyDiff(args); break;
                case 'search_codebase': result = await this.searchCodebase(args); break;
                case 'run_command': result = await this.runCommand(args); break;
                case 'delete_file': result = await this.deleteFile(args); break;
                case 'append_file': result = await this.appendFile(args); break;
                case 'get_file_info': result = await this.getFileInfo(args); break;
                case 'move_file': result = await this.moveFile(args); break;
                case 'copy_file': result = await this.copyFile(args); break;
                case 'rollback': result = await this.rollback(); break;
                case 'get_diagnostics': result = await this.getDiagnostics(args); break;
                // P0 - Git Tools
                case 'git_status': result = await this.gitStatus(args); break;
                case 'git_diff': result = await this.gitDiff(args); break;
                case 'git_commit': result = await this.gitCommit(args); break;
                case 'git_branch': result = await this.gitBranch(args); break;
                case 'git_log': result = await this.gitLog(args); break;
                case 'git_push': result = await this.gitPush(args); break;
                case 'git_pull': result = await this.gitPull(args); break;
                case 'git_stash': result = await this.gitStash(args); break;
                // P0 - Package Managers
                case 'npm_tool': result = await this.npmTool(args); break;
                case 'pip_tool': result = await this.pipTool(args); break;
                // P1 - Testing
                case 'test_runner': result = await this.testRunner(args); break;
                // P1 - Database
                case 'db_query': result = await this.dbQuery(args); break;
                // P1 - Process Management
                case 'process_start': result = await this.processStart(args); break;
                case 'process_list': result = await this.processList(args); break;
                case 'process_kill': result = await this.processKill(args); break;
                // P2 - Code Analysis
                case 'linter': result = await this.linterTool(args); break;
                // P2 - API Testing
                case 'http_request': result = await this.httpRequest(args); break;
                // P2 - Docker
                case 'docker': result = await this.dockerTool(args); break;
                default:
                    throw new Error(`Unknown tool: ${name}`);
            }

            // Format result
            let text: string;
            if (typeof result === 'string') {
                text = result;
            } else {
                text = JSON.stringify(result, null, 2);
            }

            // Ensure we don't return undefined
            if (text === undefined || text === null) {
                text = JSON.stringify({ success: true, message: 'Operation completed' });
            }

            return {
                content: [{ type: 'text', text }],
                isError: false
            };
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e);
            this.log(`❌ Error in ${name}: ${errorMsg}`);
            return {
                content: [{ type: 'text', text: `Error: ${errorMsg}` }],
                isError: true
            };
        }
    }


    // =========================================================================
    // PATH VALIDATION & SECURITY
    // =========================================================================

    private validatePath(inputPath: unknown): string {
        const p = safeString(inputPath);
        if (!p) throw new Error('Path is required');

        // Normalize and resolve
        const normalized = path.normalize(p).replace(/^(\.\.[\/\\])+/, '');
        const fullPath = path.resolve(this.workspaceRoot, normalized);

        // Security check: must be within workspace
        if (!fullPath.startsWith(this.workspaceRoot)) {
            throw new Error(`Path outside workspace: ${p}`);
        }

        // Check for blocked paths
        const relativePath = path.relative(this.workspaceRoot, fullPath);
        for (const blocked of BLOCKED_PATHS) {
            if (relativePath.includes(blocked) || normalized.includes(blocked)) {
                throw new Error(`Access denied: ${blocked} is blocked`);
            }
        }

        return fullPath;
    }

    private getRelativePath(fullPath: string): string {
        return path.relative(this.workspaceRoot, fullPath).replace(/\\/g, '/') || '.';
    }

    // =========================================================================
    // BACKUP SYSTEM
    // =========================================================================

    private createBackup(filePath: string, operation: string): void {
        try {
            if (fs.existsSync(filePath)) {
                const stat = fs.statSync(filePath);
                if (stat.isFile() && stat.size < MAX_FILE_SIZE) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    this.backups.push({
                        path: filePath,
                        content,
                        time: Date.now(),
                        operation
                    });
                    // Keep only last 50 backups
                    while (this.backups.length > 50) {
                        this.backups.shift();
                    }
                    this.log(`📦 Backup created for: ${this.getRelativePath(filePath)}`);
                }
            }
        } catch (e) {
            this.log(`Warning: Could not create backup: ${e}`);
        }
    }

    // =========================================================================
    // AGENT LOOP TOOLS
    // =========================================================================

    private async agentLoop(args: Record<string, unknown>): Promise<string> {
        const task = safeString(args.task);
        if (!task) throw new Error('Task is required');

        this.currentTask = task;
        this.iterationCount = 0;
        this.thinkingLog = [];
        this.operationLog = [];

        const tree = this.getTree(this.workspaceRoot, 0, 2);
        const projectInfo = this.getProjectInfo();

        return `
╔══════════════════════════════════════════════════════════════════════════════╗
║                    🤖 APEX AUTONOMOUS AGENT ACTIVATED                        ║
╚══════════════════════════════════════════════════════════════════════════════╝

📋 TASK: ${task}
📂 WORKSPACE: ${this.workspaceRoot}

${projectInfo}

📁 PROJECT STRUCTURE:
${tree}

═══════════════════════════════════════════════════════════════════════════════
                        🔄 AGENT LOOP WORKFLOW
═══════════════════════════════════════════════════════════════════════════════

1. THINK     → Plan your approach with 'think' tool
2. ACT       → Use file/command tools to make progress  
3. RESPOND   → Explain what you did
4. CONTINUE  → Call 'get_user_input' for next instruction
              OR 'task_complete' if done

⚠️ ALWAYS end with get_user_input OR task_complete!

🔧 TOOLS: read_file, create_file, apply_diff, append_file, delete_file,
         move_file, copy_file, list_directory, search_codebase, run_command,
         get_file_info, get_diagnostics, rollback, think, get_user_input, task_complete

🚀 BEGIN NOW!
`;
    }

    private async getUserInput(args: Record<string, unknown>): Promise<string> {
        const prompt = safeString(args.prompt, 'What would you like me to do next?');
        const placeholder = safeString(args.placeholder, 'Type your instruction here...');

        this.iterationCount++;

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

        const request: UserInputRequest = {
            id: requestId,
            prompt,
            placeholder,
            timestamp: Date.now()
        };

        const requestFile = path.join(IPC_DIR, `input_request_${requestId}.json`);
        const responseFile = path.join(IPC_DIR, `input_response_${requestId}.json`);

        try {
            fs.writeFileSync(requestFile, JSON.stringify(request, null, 2), 'utf-8');
            this.log(`📝 Waiting for user input...`);
        } catch (e) {
            throw new Error(`Failed to create input request: ${e}`);
        }

        // Poll for response (5 minute timeout)
        const timeout = 5 * 60 * 1000;
        const pollInterval = 500;
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                if (fs.existsSync(responseFile)) {
                    const responseContent = fs.readFileSync(responseFile, 'utf-8');
                    const response: UserInputResponse = JSON.parse(responseContent);

                    // Cleanup
                    try { fs.unlinkSync(requestFile); } catch { }
                    try { fs.unlinkSync(responseFile); } catch { }

                    if (response.cancelled || !response.input) {
                        return `
⏸️ USER CANCELLED INPUT

Options:
1. Call 'get_user_input' again
2. Call 'task_complete' if done
3. Continue working on current task
`;
                    }

                    const userInput = safeString(response.input);
                    this.log(`✅ User input received`);

                    return `
📨 USER INPUT RECEIVED

🗣️ USER SAYS:
${userInput}

📊 Session: Iteration ${this.iterationCount} | Task: ${this.currentTask}

🔄 Process the input, then call 'get_user_input' again or 'task_complete' when done.
`;
                }
            } catch (e) {
                // Continue polling
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        // Timeout cleanup
        try { fs.unlinkSync(requestFile); } catch { }

        return `
⏰ INPUT TIMEOUT (5 minutes)

The VS Code extension may not be running.
Options:
1. Call 'get_user_input' to retry
2. Call 'task_complete' to end session
`;
    }

    private async think(args: Record<string, unknown>): Promise<string> {
        const thought = safeString(args.thought);
        if (!thought) throw new Error('Thought content is required');

        this.thinkingLog.push(`[${new Date().toISOString()}] ${thought}`);

        return `💭 THOUGHT RECORDED:\n${thought}\n\nContinue with your next action.`;
    }

    private async taskComplete(args: Record<string, unknown>): Promise<string> {
        const summary = safeString(args.summary, 'Task completed');
        const files = safeArray(args.filesModified);

        const result = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                         ✅ TASK COMPLETED                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

📋 TASK: ${this.currentTask}
📝 SUMMARY: ${summary}
${files.length > 0 ? `📁 FILES: ${files.join(', ')}` : ''}
📊 STATS: ${this.iterationCount} iterations, ${this.thinkingLog.length} thoughts

🎉 Done! Call 'agent_loop' for a new task.
`;

        // Reset state
        this.currentTask = '';
        this.iterationCount = 0;
        this.thinkingLog = [];

        return result;
    }

    // =========================================================================
    // FILE OPERATIONS - ROBUST IMPLEMENTATIONS
    // =========================================================================

    private async readFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);
        const startLine = safeNumber(args.startLine, 0);
        const endLine = safeNumber(args.endLine, 0);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${safeString(args.path)}`);
        }

        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            throw new Error(`Path is a directory, not a file: ${safeString(args.path)}`);
        }

        if (stat.size > MAX_FILE_SIZE) {
            throw new Error(`File too large (${(stat.size / 1024 / 1024).toFixed(2)}MB). Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
        }

        // Check if binary
        const ext = path.extname(filePath).toLowerCase();
        if (BINARY_EXTENSIONS.includes(ext)) {
            return {
                success: true,
                data: {
                    path: this.getRelativePath(filePath),
                    binary: true,
                    size: stat.size,
                    extension: ext
                }
            };
        }

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to read file: ${e}`);
        }

        const lines = content.split('\n');
        const totalLines = lines.length;

        // Apply line range if specified
        if (startLine > 0 || endLine > 0) {
            const start = Math.max(1, startLine) - 1;
            const end = endLine > 0 ? Math.min(endLine, totalLines) : totalLines;
            content = lines.slice(start, end).join('\n');
        }

        return {
            success: true,
            data: {
                path: this.getRelativePath(filePath),
                content,
                totalLines,
                size: stat.size,
                range: (startLine > 0 || endLine > 0) ? { start: startLine || 1, end: endLine || totalLines } : null
            }
        };
    }

    private async createFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);
        const content = safeString(args.content);
        const overwrite = safeBoolean(args.overwrite, false);

        if (content.length > MAX_CONTENT_LENGTH) {
            throw new Error(`Content too large (${(content.length / 1024 / 1024).toFixed(2)}MB). Max: ${MAX_CONTENT_LENGTH / 1024 / 1024}MB`);
        }

        const exists = fs.existsSync(filePath);

        if (exists && !overwrite) {
            throw new Error(`File already exists: ${safeString(args.path)}. Set overwrite=true to replace.`);
        }

        // Backup existing file
        if (exists) {
            this.createBackup(filePath, 'create_file (overwrite)');
        }

        // Create parent directories
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            try {
                fs.mkdirSync(dir, { recursive: true });
            } catch (e) {
                throw new Error(`Failed to create directory: ${e}`);
            }
        }

        // Write file
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to write file: ${e}`);
        }

        this.operationLog.push(`Created: ${this.getRelativePath(filePath)}`);

        return {
            success: true,
            message: exists ? 'File overwritten successfully' : 'File created successfully',
            data: {
                path: this.getRelativePath(filePath),
                created: !exists,
                overwritten: exists,
                size: Buffer.byteLength(content, 'utf-8'),
                lines: content.split('\n').length
            }
        };
    }

    private async applyDiff(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);
        const oldText = safeString(args.oldText);
        const newText = safeString(args.newText);
        const replaceAll = safeBoolean(args.replaceAll, false);

        if (!oldText) {
            throw new Error('oldText is required');
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${safeString(args.path)}`);
        }

        // Backup before modification
        this.createBackup(filePath, 'apply_diff');

        let content: string;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to read file: ${e}`);
        }

        // Normalize line endings for comparison
        const normalizedContent = content.replace(/\r\n/g, '\n');
        const normalizedOldText = oldText.replace(/\r\n/g, '\n');

        // Check if text exists
        if (!normalizedContent.includes(normalizedOldText)) {
            // Try to find similar text for better error message
            const firstLine = normalizedOldText.split('\n')[0].trim();
            const similarLines = normalizedContent.split('\n')
                .map((line, i) => ({ line: line.trim(), num: i + 1 }))
                .filter(({ line }) => line.includes(firstLine.substring(0, 20)))
                .slice(0, 3);

            let hint = '';
            if (similarLines.length > 0) {
                hint = `\n\nSimilar content found at lines: ${similarLines.map(s => s.num).join(', ')}`;
            }

            throw new Error(`Old text not found in file.${hint}\n\nSearched for:\n${truncateString(oldText, 200)}`);
        }

        // Perform replacement
        let newContent: string;
        let replacementCount: number;

        if (replaceAll) {
            const parts = normalizedContent.split(normalizedOldText);
            replacementCount = parts.length - 1;
            newContent = parts.join(newText);
        } else {
            newContent = normalizedContent.replace(normalizedOldText, newText);
            replacementCount = 1;
        }

        // Write back
        try {
            fs.writeFileSync(filePath, newContent, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to write file: ${e}`);
        }

        this.operationLog.push(`Modified: ${this.getRelativePath(filePath)}`);

        return {
            success: true,
            message: `Replaced ${replacementCount} occurrence(s)`,
            data: {
                path: this.getRelativePath(filePath),
                replacements: replacementCount,
                oldSize: content.length,
                newSize: newContent.length
            }
        };
    }

    private async appendFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);
        const content = safeString(args.content);

        if (!content) {
            throw new Error('Content is required');
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${safeString(args.path)}. Use create_file to create new files.`);
        }

        // Backup before modification
        this.createBackup(filePath, 'append_file');

        let existing: string;
        try {
            existing = fs.readFileSync(filePath, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to read file: ${e}`);
        }

        // Add newline if needed
        const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
        const toAppend = prefix + content;

        try {
            fs.appendFileSync(filePath, toAppend, 'utf-8');
        } catch (e) {
            throw new Error(`Failed to append to file: ${e}`);
        }

        this.operationLog.push(`Appended to: ${this.getRelativePath(filePath)}`);

        return {
            success: true,
            message: 'Content appended successfully',
            data: {
                path: this.getRelativePath(filePath),
                appendedBytes: Buffer.byteLength(toAppend, 'utf-8'),
                appendedLines: content.split('\n').length,
                totalSize: existing.length + toAppend.length
            }
        };
    }

    private async deleteFile(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);
        const force = safeBoolean(args.force, false);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Path not found: ${safeString(args.path)}`);
        }

        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            const contents = fs.readdirSync(filePath);
            if (contents.length > 0 && !force) {
                throw new Error(`Directory not empty (${contents.length} items). Set force=true to delete recursively.`);
            }

            if (force && contents.length > 0) {
                // Recursive delete
                this.deleteRecursive(filePath);
            } else {
                fs.rmdirSync(filePath);
            }
        } else {
            // Backup file before deletion
            this.createBackup(filePath, 'delete_file');
            fs.unlinkSync(filePath);
        }

        this.operationLog.push(`Deleted: ${this.getRelativePath(filePath)}`);

        return {
            success: true,
            message: stat.isDirectory() ? 'Directory deleted' : 'File deleted',
            data: {
                path: this.getRelativePath(filePath),
                type: stat.isDirectory() ? 'directory' : 'file',
                canRollback: !stat.isDirectory()
            }
        };
    }

    private deleteRecursive(dirPath: string): void {
        if (fs.existsSync(dirPath)) {
            for (const file of fs.readdirSync(dirPath)) {
                const curPath = path.join(dirPath, file);
                if (fs.statSync(curPath).isDirectory()) {
                    this.deleteRecursive(curPath);
                } else {
                    fs.unlinkSync(curPath);
                }
            }
            fs.rmdirSync(dirPath);
        }
    }

    private async moveFile(args: Record<string, unknown>): Promise<ToolResult> {
        const sourcePath = this.validatePath(args.source);
        const destPath = this.validatePath(args.destination);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source not found: ${safeString(args.source)}`);
        }

        if (fs.existsSync(destPath)) {
            throw new Error(`Destination already exists: ${safeString(args.destination)}`);
        }

        // Create destination directory if needed
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        // Backup source if it's a file
        const stat = fs.statSync(sourcePath);
        if (stat.isFile()) {
            this.createBackup(sourcePath, 'move_file');
        }

        try {
            fs.renameSync(sourcePath, destPath);
        } catch (e) {
            throw new Error(`Failed to move: ${e}`);
        }

        this.operationLog.push(`Moved: ${this.getRelativePath(sourcePath)} → ${this.getRelativePath(destPath)}`);

        return {
            success: true,
            message: 'Moved successfully',
            data: {
                source: this.getRelativePath(sourcePath),
                destination: this.getRelativePath(destPath),
                type: stat.isDirectory() ? 'directory' : 'file'
            }
        };
    }

    private async copyFile(args: Record<string, unknown>): Promise<ToolResult> {
        const sourcePath = this.validatePath(args.source);
        const destPath = this.validatePath(args.destination);

        if (!fs.existsSync(sourcePath)) {
            throw new Error(`Source not found: ${safeString(args.source)}`);
        }

        if (fs.existsSync(destPath)) {
            throw new Error(`Destination already exists: ${safeString(args.destination)}`);
        }

        const stat = fs.statSync(sourcePath);

        // Create destination directory if needed
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        if (stat.isDirectory()) {
            this.copyRecursive(sourcePath, destPath);
        } else {
            fs.copyFileSync(sourcePath, destPath);
        }

        this.operationLog.push(`Copied: ${this.getRelativePath(sourcePath)} → ${this.getRelativePath(destPath)}`);

        return {
            success: true,
            message: 'Copied successfully',
            data: {
                source: this.getRelativePath(sourcePath),
                destination: this.getRelativePath(destPath),
                type: stat.isDirectory() ? 'directory' : 'file'
            }
        };
    }

    private copyRecursive(src: string, dest: string): void {
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            fs.mkdirSync(dest, { recursive: true });
            for (const file of fs.readdirSync(src)) {
                this.copyRecursive(path.join(src, file), path.join(dest, file));
            }
        } else {
            fs.copyFileSync(src, dest);
        }
    }


    private async listDirectory(args: Record<string, unknown>): Promise<ToolResult> {
        const dirPath = this.validatePath(args.path || '.');
        const recursive = safeBoolean(args.recursive, false);
        const maxDepth = Math.min(safeNumber(args.maxDepth, 3), 10);

        if (!fs.existsSync(dirPath)) {
            throw new Error(`Directory not found: ${safeString(args.path)}`);
        }

        const stat = fs.statSync(dirPath);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${safeString(args.path)}`);
        }

        const entries: Array<{ name: string; type: string; size?: number }> = [];

        const listDir = (dir: string, depth: number) => {
            if (depth > maxDepth || entries.length >= 500) return;

            try {
                const items = fs.readdirSync(dir);
                for (const item of items) {
                    if (entries.length >= 500) break;
                    if (BLOCKED_PATHS.includes(item) || item === 'node_modules') continue;

                    const fullPath = path.join(dir, item);
                    try {
                        const itemStat = fs.statSync(fullPath);
                        entries.push({
                            name: this.getRelativePath(fullPath),
                            type: itemStat.isDirectory() ? 'directory' : 'file',
                            size: itemStat.isFile() ? itemStat.size : undefined
                        });

                        if (recursive && itemStat.isDirectory()) {
                            listDir(fullPath, depth + 1);
                        }
                    } catch { }
                }
            } catch { }
        };

        listDir(dirPath, 0);

        return {
            success: true,
            data: {
                path: this.getRelativePath(dirPath),
                entries,
                total: entries.length,
                truncated: entries.length >= 500
            }
        };
    }

    private async searchCodebase(args: Record<string, unknown>): Promise<ToolResult> {
        const query = safeString(args.query);
        const searchPath = this.validatePath(args.path || '.');
        const filePattern = safeString(args.filePattern);
        const caseSensitive = safeBoolean(args.caseSensitive, false);
        const maxResults = Math.min(safeNumber(args.maxResults, 50), 100);

        if (!query) {
            throw new Error('Search query is required');
        }

        // Create regex
        let regex: RegExp;
        try {
            regex = new RegExp(query, caseSensitive ? 'g' : 'gi');
        } catch {
            // Escape special characters if regex is invalid
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, caseSensitive ? 'g' : 'gi');
        }

        const matches: Array<{ file: string; line: number; text: string; column?: number }> = [];

        const searchDir = (dir: string) => {
            if (matches.length >= maxResults) return;

            try {
                for (const item of fs.readdirSync(dir)) {
                    if (matches.length >= maxResults) return;
                    if (BLOCKED_PATHS.includes(item) || item === 'node_modules') continue;

                    const fullPath = path.join(dir, item);
                    try {
                        const stat = fs.statSync(fullPath);

                        if (stat.isDirectory()) {
                            searchDir(fullPath);
                            continue;
                        }

                        // Check file pattern
                        if (filePattern) {
                            const patternRegex = new RegExp('^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                            if (!patternRegex.test(item)) continue;
                        }

                        // Skip binary files
                        const ext = path.extname(item).toLowerCase();
                        if (BINARY_EXTENSIONS.includes(ext)) continue;

                        // Skip large files
                        if (stat.size > 1024 * 1024) continue;

                        const content = fs.readFileSync(fullPath, 'utf-8');
                        const lines = content.split('\n');

                        for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
                            const line = lines[i];
                            regex.lastIndex = 0; // Reset regex state

                            if (regex.test(line)) {
                                matches.push({
                                    file: this.getRelativePath(fullPath),
                                    line: i + 1,
                                    text: truncateString(line.trim(), 150)
                                });
                            }
                        }
                    } catch { }
                }
            } catch { }
        };

        searchDir(searchPath);

        return {
            success: true,
            data: {
                query,
                matches,
                total: matches.length,
                truncated: matches.length >= maxResults
            }
        };
    }

    private async runCommand(args: Record<string, unknown>): Promise<ToolResult> {
        const command = safeString(args.command);
        const cwd = args.cwd ? this.validatePath(args.cwd) : this.workspaceRoot;
        const timeout = Math.min(safeNumber(args.timeout, 30000), 120000);

        if (!command) {
            throw new Error('Command is required');
        }

        // Security check
        const lowerCmd = command.toLowerCase();
        for (const dangerous of DANGEROUS_COMMANDS) {
            if (lowerCmd.includes(dangerous.toLowerCase())) {
                throw new Error(`Dangerous command blocked: ${dangerous}`);
            }
        }

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd,
                timeout,
                maxBuffer: 10 * 1024 * 1024 // 10MB buffer
            });

            return {
                success: true,
                data: {
                    command,
                    cwd: this.getRelativePath(cwd),
                    stdout: truncateString(stdout.trim(), 50000),
                    stderr: truncateString(stderr.trim(), 10000),
                    exitCode: 0
                }
            };
        } catch (e: any) {
            return {
                success: false,
                error: e.message,
                data: {
                    command,
                    cwd: this.getRelativePath(cwd),
                    stdout: truncateString(safeString(e.stdout), 50000),
                    stderr: truncateString(safeString(e.stderr || e.message), 10000),
                    exitCode: e.code || 1
                }
            };
        }
    }

    private async getFileInfo(args: Record<string, unknown>): Promise<ToolResult> {
        const filePath = this.validatePath(args.path);

        if (!fs.existsSync(filePath)) {
            throw new Error(`Path not found: ${safeString(args.path)}`);
        }

        const stat = fs.statSync(filePath);
        const isDir = stat.isDirectory();

        const info: Record<string, unknown> = {
            path: this.getRelativePath(filePath),
            type: isDir ? 'directory' : 'file',
            size: stat.size,
            sizeFormatted: this.formatSize(stat.size),
            created: stat.birthtime.toISOString(),
            modified: stat.mtime.toISOString(),
            accessed: stat.atime.toISOString()
        };

        if (!isDir) {
            info.extension = path.extname(filePath);
            info.basename = path.basename(filePath);
        } else {
            try {
                const contents = fs.readdirSync(filePath);
                info.itemCount = contents.length;
            } catch { }
        }

        return {
            success: true,
            data: info
        };
    }

    private async rollback(): Promise<ToolResult> {
        if (this.backups.length === 0) {
            return {
                success: false,
                message: 'No backups available to rollback'
            };
        }

        const backup = this.backups.pop()!;

        try {
            // Ensure directory exists
            const dir = path.dirname(backup.path);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(backup.path, backup.content, 'utf-8');

            return {
                success: true,
                message: 'Rollback successful',
                data: {
                    restored: this.getRelativePath(backup.path),
                    operation: backup.operation,
                    backupTime: new Date(backup.time).toISOString(),
                    remainingBackups: this.backups.length
                }
            };
        } catch (e) {
            // Put backup back if restore failed
            this.backups.push(backup);
            throw new Error(`Rollback failed: ${e}`);
        }
    }

    private async getDiagnostics(args: Record<string, unknown>): Promise<ToolResult> {
        const targetPath = args.path ? this.validatePath(args.path) : this.workspaceRoot;

        let totalFiles = 0;
        let totalDirs = 0;
        let totalSize = 0;
        const extensions: Record<string, number> = {};
        const largestFiles: Array<{ path: string; size: number }> = [];

        const analyze = (dir: string, depth: number) => {
            if (depth > 10) return;

            try {
                for (const item of fs.readdirSync(dir)) {
                    if (BLOCKED_PATHS.includes(item) || item === 'node_modules') continue;

                    const fullPath = path.join(dir, item);
                    try {
                        const stat = fs.statSync(fullPath);

                        if (stat.isDirectory()) {
                            totalDirs++;
                            analyze(fullPath, depth + 1);
                        } else {
                            totalFiles++;
                            totalSize += stat.size;

                            const ext = path.extname(item).toLowerCase() || '(no ext)';
                            extensions[ext] = (extensions[ext] || 0) + 1;

                            // Track largest files
                            if (largestFiles.length < 10 || stat.size > largestFiles[largestFiles.length - 1].size) {
                                largestFiles.push({ path: this.getRelativePath(fullPath), size: stat.size });
                                largestFiles.sort((a, b) => b.size - a.size);
                                if (largestFiles.length > 10) largestFiles.pop();
                            }
                        }
                    } catch { }
                }
            } catch { }
        };

        analyze(targetPath, 0);

        return {
            success: true,
            data: {
                path: this.getRelativePath(targetPath),
                totalFiles,
                totalDirectories: totalDirs,
                totalSize: this.formatSize(totalSize),
                totalSizeBytes: totalSize,
                fileTypes: Object.entries(extensions)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 15)
                    .map(([ext, count]) => ({ extension: ext, count })),
                largestFiles: largestFiles.map(f => ({ ...f, sizeFormatted: this.formatSize(f.size) })),
                backupsAvailable: this.backups.length,
                currentTask: this.currentTask || '(none)',
                iterations: this.iterationCount
            }
        };
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    private getTree(dir: string, depth: number, maxDepth: number): string {
        if (depth > maxDepth) return '';

        const indent = '  '.repeat(depth);
        const lines: string[] = [];

        try {
            const items = fs.readdirSync(dir)
                .filter(i => !BLOCKED_PATHS.includes(i) && i !== 'node_modules' && !i.startsWith('.'))
                .slice(0, 15);

            for (const item of items) {
                const fullPath = path.join(dir, item);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        lines.push(`${indent}📁 ${item}/`);
                        const subtree = this.getTree(fullPath, depth + 1, maxDepth);
                        if (subtree) lines.push(subtree);
                    } else {
                        lines.push(`${indent}📄 ${item}`);
                    }
                } catch { }
            }
        } catch { }

        return lines.filter(l => l).join('\n');
    }

    private getProjectInfo(): string {
        const info: string[] = [];
        const pkgPath = path.join(this.workspaceRoot, 'package.json');

        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                info.push('📦 PROJECT INFO:');
                if (pkg.name) info.push(`   Name: ${pkg.name}`);
                if (pkg.version) info.push(`   Version: ${pkg.version}`);
                if (pkg.description) info.push(`   Description: ${truncateString(pkg.description, 60)}`);
                if (pkg.scripts) {
                    const scripts = Object.keys(pkg.scripts).slice(0, 5).join(', ');
                    info.push(`   Scripts: ${scripts}`);
                }
            } catch { }
        }

        return info.length > 0 ? info.join('\n') : '';
    }

    private formatSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    private send(msg: object): void {
        try {
            const json = JSON.stringify(msg);
            process.stdout.write(json + '\n');
        } catch (e) {
            this.log(`Error sending message: ${e}`);
        }
    }

    private log(msg: string): void {
        const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
        process.stderr.write(`[${timestamp}] ${msg}\n`);
    }

    // =========================================================================
    // P0 - GIT TOOLS
    // =========================================================================

    private async gitStatus(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        try {
            const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
            const { stdout: status } = await execAsync('git status --porcelain', { cwd });
            const { stdout: remote } = await execAsync('git remote -v', { cwd }).catch(() => ({ stdout: '' }));

            const lines = status.trim().split('\n').filter(l => l);
            const staged = lines.filter(l => l[0] !== ' ' && l[0] !== '?').map(l => ({ status: l.substring(0, 2), file: l.substring(3) }));
            const unstaged = lines.filter(l => l[1] !== ' ' && l[0] === ' ').map(l => ({ status: l.substring(0, 2), file: l.substring(3) }));
            const untracked = lines.filter(l => l.startsWith('??')).map(l => l.substring(3));

            return { success: true, data: { branch: branch.trim(), staged, unstaged, untracked, remote: remote.trim() } };
        } catch (e) { return { success: false, error: `Git status failed: ${e}` }; }
    }

    private async gitDiff(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const file = safeString(args.file);
        const staged = safeBoolean(args.staged);
        try {
            const cmd = `git diff ${staged ? '--staged' : ''} ${file || ''}`.trim();
            const { stdout } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
            return { success: true, data: { diff: stdout, staged, file: file || 'all' } };
        } catch (e) { return { success: false, error: `Git diff failed: ${e}` }; }
    }

    private async gitCommit(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const message = safeString(args.message);
        const files = safeArray(args.files);
        if (!message) throw new Error('Commit message is required');
        try {
            if (files.length > 0) {
                await execAsync(`git add ${files.join(' ')}`, { cwd });
            } else {
                await execAsync('git add -A', { cwd });
            }
            const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd });
            return { success: true, message: 'Committed successfully', data: { output: stdout.trim() } };
        } catch (e) { return { success: false, error: `Git commit failed: ${e}` }; }
    }

    private async gitBranch(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const action = safeString(args.action, 'list');
        const name = safeString(args.name);
        try {
            let result: string;
            switch (action) {
                case 'list': result = (await execAsync('git branch -a', { cwd })).stdout; break;
                case 'create': result = (await execAsync(`git branch ${name}`, { cwd })).stdout; break;
                case 'checkout': result = (await execAsync(`git checkout ${name}`, { cwd })).stdout; break;
                case 'delete': result = (await execAsync(`git branch -d ${name}`, { cwd })).stdout; break;
                case 'merge': result = (await execAsync(`git merge ${name}`, { cwd })).stdout; break;
                default: throw new Error(`Unknown action: ${action}`);
            }
            return { success: true, data: { action, name, output: result.trim() } };
        } catch (e) { return { success: false, error: `Git branch failed: ${e}` }; }
    }

    private async gitLog(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const maxCount = safeNumber(args.maxCount, 10);
        const file = safeString(args.file);
        try {
            const cmd = `git log --oneline -n ${maxCount} ${file || ''}`.trim();
            const { stdout } = await execAsync(cmd, { cwd });
            const commits = stdout.trim().split('\n').filter(l => l).map(l => {
                const [hash, ...msg] = l.split(' ');
                return { hash, message: msg.join(' ') };
            });
            return { success: true, data: { commits, count: commits.length } };
        } catch (e) { return { success: false, error: `Git log failed: ${e}` }; }
    }

    private async gitPush(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const remote = safeString(args.remote, 'origin');
        const branch = safeString(args.branch);
        const force = safeBoolean(args.force);
        try {
            const cmd = `git push ${force ? '-f' : ''} ${remote} ${branch || ''}`.trim();
            const { stdout, stderr } = await execAsync(cmd, { cwd });
            return { success: true, message: 'Push successful', data: { output: (stdout + stderr).trim() } };
        } catch (e) { return { success: false, error: `Git push failed: ${e}` }; }
    }

    private async gitPull(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const remote = safeString(args.remote, 'origin');
        const branch = safeString(args.branch);
        const rebase = safeBoolean(args.rebase);
        try {
            const cmd = `git pull ${rebase ? '--rebase' : ''} ${remote} ${branch || ''}`.trim();
            const { stdout } = await execAsync(cmd, { cwd });
            return { success: true, message: 'Pull successful', data: { output: stdout.trim() } };
        } catch (e) { return { success: false, error: `Git pull failed: ${e}` }; }
    }

    private async gitStash(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const action = safeString(args.action, 'list');
        const message = safeString(args.message);
        const index = safeNumber(args.index, 0);
        try {
            let cmd: string;
            switch (action) {
                case 'push': cmd = message ? `git stash push -m "${message}"` : 'git stash push'; break;
                case 'pop': cmd = 'git stash pop'; break;
                case 'list': cmd = 'git stash list'; break;
                case 'apply': cmd = `git stash apply stash@{${index}}`; break;
                case 'drop': cmd = `git stash drop stash@{${index}}`; break;
                default: throw new Error(`Unknown action: ${action}`);
            }
            const { stdout } = await execAsync(cmd, { cwd });
            return { success: true, data: { action, output: stdout.trim() } };
        } catch (e) { return { success: false, error: `Git stash failed: ${e}` }; }
    }

    // =========================================================================
    // P0 - PACKAGE MANAGERS
    // =========================================================================

    private async npmTool(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const action = safeString(args.action, 'list');
        const packages = safeArray(args.packages);
        const dev = safeBoolean(args.dev);
        const script = safeString(args.script);
        try {
            let cmd: string;
            switch (action) {
                case 'install': cmd = packages.length ? `npm install ${dev ? '-D' : ''} ${packages.join(' ')}` : 'npm install'; break;
                case 'uninstall': cmd = `npm uninstall ${packages.join(' ')}`; break;
                case 'update': cmd = packages.length ? `npm update ${packages.join(' ')}` : 'npm update'; break;
                case 'list': cmd = 'npm list --depth=0 --json'; break;
                case 'audit': cmd = 'npm audit --json'; break;
                case 'run': cmd = `npm run ${script}`; break;
                case 'outdated': cmd = 'npm outdated --json'; break;
                default: throw new Error(`Unknown action: ${action}`);
            }
            const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
            let data: any = { action, output: stdout.trim() };
            try { data = { action, ...JSON.parse(stdout) }; } catch { }
            return { success: true, data };
        } catch (e) { return { success: false, error: `NPM failed: ${e}` }; }
    }

    private async pipTool(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const action = safeString(args.action, 'list');
        const packages = safeArray(args.packages);
        const requirements = safeString(args.requirements);
        try {
            let cmd: string;
            switch (action) {
                case 'install': cmd = requirements ? `pip install -r ${requirements}` : `pip install ${packages.join(' ')}`; break;
                case 'uninstall': cmd = `pip uninstall -y ${packages.join(' ')}`; break;
                case 'list': cmd = 'pip list --format=json'; break;
                case 'freeze': cmd = 'pip freeze'; break;
                case 'show': cmd = `pip show ${packages[0] || ''}`; break;
                default: throw new Error(`Unknown action: ${action}`);
            }
            const { stdout } = await execAsync(cmd, { cwd });
            let data: any = { action, output: stdout.trim() };
            try { data = { action, packages: JSON.parse(stdout) }; } catch { }
            return { success: true, data };
        } catch (e) { return { success: false, error: `Pip failed: ${e}` }; }
    }

    // =========================================================================
    // P1 - TESTING, DATABASE, PROCESS
    // =========================================================================

    private async testRunner(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = safeString(args.path) || this.workspaceRoot;
        const framework = safeString(args.framework, 'auto');
        const pattern = safeString(args.pattern);
        const coverage = safeBoolean(args.coverage);
        try {
            let cmd: string;
            const detected = framework === 'auto' ? this.detectTestFramework(cwd) : framework;
            switch (detected) {
                case 'jest': cmd = `npx jest ${pattern || ''} ${coverage ? '--coverage' : ''} --passWithNoTests`; break;
                case 'pytest': cmd = `python -m pytest ${pattern || ''} ${coverage ? '--cov' : ''} -q`; break;
                case 'mocha': cmd = `npx mocha ${pattern || ''}`; break;
                case 'vitest': cmd = `npx vitest run ${pattern || ''} ${coverage ? '--coverage' : ''}`; break;
                default: cmd = 'npm test';
            }
            const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
            return { success: true, data: { framework: detected, output: (stdout + stderr).trim() } };
        } catch (e) { return { success: false, error: `Test failed: ${e}` }; }
    }

    private detectTestFramework(cwd: string): string {
        if (fs.existsSync(path.join(cwd, 'jest.config.js'))) return 'jest';
        if (fs.existsSync(path.join(cwd, 'vitest.config.ts'))) return 'vitest';
        if (fs.existsSync(path.join(cwd, 'pytest.ini'))) return 'pytest';
        if (fs.existsSync(path.join(cwd, 'package.json'))) {
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps.jest) return 'jest';
                if (deps.vitest) return 'vitest';
                if (deps.mocha) return 'mocha';
            } catch { }
        }
        return 'npm';
    }

    private async dbQuery(args: Record<string, unknown>): Promise<ToolResult> {
        const dbType = safeString(args.type, 'sqlite');
        const query = safeString(args.query);
        const database = safeString(args.database);
        if (!query) throw new Error('Query is required');
        try {
            let cmd: string;
            switch (dbType) {
                case 'sqlite': cmd = `sqlite3 -header -csv "${database}" "${query.replace(/"/g, '\\"')}"`; break;
                case 'postgres': cmd = `psql -c "${query.replace(/"/g, '\\"')}" ${database || ''}`; break;
                case 'mysql': cmd = `mysql -e "${query.replace(/"/g, '\\"')}" ${database || ''}`; break;
                default: throw new Error(`Unsupported database: ${dbType}`);
            }
            const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
            return { success: true, data: { type: dbType, query, result: stdout.trim() } };
        } catch (e) { return { success: false, error: `Database query failed: ${e}` }; }
    }

    private async processStart(args: Record<string, unknown>): Promise<ToolResult> {
        const command = safeString(args.command);
        const cmdArgs = safeArray(args.args);
        const cwd = safeString(args.cwd) || this.workspaceRoot;
        if (!command) throw new Error('Command is required');
        try {
            const { spawn } = require('child_process');
            const fullCmd = cmdArgs.length ? `${command} ${cmdArgs.join(' ')}` : command;
            const child = spawn(command, cmdArgs, { cwd, detached: true, shell: true, stdio: 'ignore' });
            child.unref();
            return { success: true, data: { command: fullCmd, pid: child.pid, status: 'started' } };
        } catch (e) { return { success: false, error: `Process start failed: ${e}` }; }
    }

    private async processList(args: Record<string, unknown>): Promise<ToolResult> {
        try {
            const isWindows = process.platform === 'win32';
            const cmd = isWindows ? 'tasklist /FO CSV' : 'ps aux';
            const { stdout } = await execAsync(cmd);
            return { success: true, data: { processes: stdout.trim().split('\n').slice(0, 50) } };
        } catch (e) { return { success: false, error: `Process list failed: ${e}` }; }
    }

    private async processKill(args: Record<string, unknown>): Promise<ToolResult> {
        const pid = safeNumber(args.pid, 0);
        const name = safeString(args.name);
        const signal = safeString(args.signal, 'SIGTERM');
        try {
            const isWindows = process.platform === 'win32';
            let cmd: string;
            if (pid) {
                cmd = isWindows ? `taskkill /PID ${pid} /F` : `kill -${signal} ${pid}`;
            } else if (name) {
                cmd = isWindows ? `taskkill /IM ${name} /F` : `pkill -${signal} ${name}`;
            } else {
                throw new Error('PID or name required');
            }
            await execAsync(cmd);
            return { success: true, message: `Process killed: ${pid || name}` };
        } catch (e) { return { success: false, error: `Process kill failed: ${e}` }; }
    }

    // =========================================================================
    // P2 - CODE ANALYSIS, API, DOCKER
    // =========================================================================

    private async linterTool(args: Record<string, unknown>): Promise<ToolResult> {
        const cwd = this.workspaceRoot;
        const tool = safeString(args.tool, 'eslint');
        const targetPath = safeString(args.path, '.');
        const fix = safeBoolean(args.fix);
        try {
            let cmd: string;
            switch (tool) {
                case 'eslint': cmd = `npx eslint ${targetPath} ${fix ? '--fix' : ''} --format json`; break;
                case 'pylint': cmd = `pylint ${targetPath} --output-format=json`; break;
                default: cmd = `npx eslint ${targetPath} --format json`;
            }
            const { stdout, stderr } = await execAsync(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 });
            let issues: any = [];
            try { issues = JSON.parse(stdout); } catch { }
            return { success: true, data: { tool, path: targetPath, issues, fixed: fix } };
        } catch (e) { return { success: false, error: `Linter failed: ${e}` }; }
    }

    private async httpRequest(args: Record<string, unknown>): Promise<ToolResult> {
        const method = safeString(args.method, 'GET').toUpperCase();
        const url = safeString(args.url);
        const headers = args.headers as Record<string, string> || {};
        const body = safeString(args.body);
        const timeout = safeNumber(args.timeout, 30000);
        if (!url) throw new Error('URL is required');

        return new Promise((resolve) => {
            const https = require('https');
            const http = require('http');
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;

            const options = {
                method, hostname: urlObj.hostname, port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
                path: urlObj.pathname + urlObj.search, headers, timeout
            };

            const req = client.request(options, (res: any) => {
                let data = '';
                res.on('data', (chunk: string) => data += chunk);
                res.on('end', () => {
                    let parsed = data;
                    try { parsed = JSON.parse(data); } catch { }
                    resolve({ success: true, data: { status: res.statusCode, headers: res.headers, body: parsed } });
                });
            });

            req.on('error', (e: Error) => resolve({ success: false, error: `HTTP request failed: ${e.message}` }));
            req.on('timeout', () => { req.destroy(); resolve({ success: false, error: 'Request timeout' }); });
            if (body) req.write(body);
            req.end();
        });
    }

    private async dockerTool(args: Record<string, unknown>): Promise<ToolResult> {
        const action = safeString(args.action, 'ps');
        const target = safeString(args.target);
        const image = safeString(args.image);
        const command = safeString(args.command);
        const ports = safeArray(args.ports);
        try {
            let cmd: string;
            switch (action) {
                case 'ps': cmd = 'docker ps --format "{{json .}}"'; break;
                case 'images': cmd = 'docker images --format "{{json .}}"'; break;
                case 'run':
                    const portArgs = ports.map(p => `-p ${p}`).join(' ');
                    cmd = `docker run -d ${portArgs} ${image}`;
                    break;
                case 'stop': cmd = `docker stop ${target}`; break;
                case 'logs': cmd = `docker logs --tail 100 ${target}`; break;
                case 'exec': cmd = `docker exec ${target} ${command}`; break;
                case 'build': cmd = `docker build -t ${image} .`; break;
                case 'pull': cmd = `docker pull ${image}`; break;
                default: throw new Error(`Unknown action: ${action}`);
            }
            const { stdout } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
            return { success: true, data: { action, output: stdout.trim() } };
        } catch (e) { return { success: false, error: `Docker failed: ${e}` }; }
    }
}

// Start the server
new ApexAgent().start();
