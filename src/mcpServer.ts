/**
 * =============================================================================
 * APEX MCP AGENT - MCP SERVER
 * =============================================================================
 * 
 * Implements the Model Context Protocol (MCP) server.
 * This runs INSIDE the extension - there is no external daemon.
 * 
 * RESPONSIBILITIES:
 * 1. Expose tool schemas
 * 2. Enforce permissions
 * 3. Reject invalid/unsafe actions
 * 4. Maintain session continuity
 * 5. Be model-agnostic (Claude is just one client)
 * 
 * TRANSPORT:
 * Uses stdio for communication with external AI clients.
 */

import * as vscode from 'vscode';
import { Readable, Writable } from 'stream';
import {
    MCPRequest,
    MCPResponse,
    MCPError,
    MCPInitializeResult,
    MCPToolSchema,
    ToolCall,
    StreamingCallback
} from './types';
import { ToolRegistry } from './tools/registry';
import { SessionManager, AgentEventEmitter } from './session';
import { SecurityManager } from './security';

/**
 * MCP Error codes
 */
const MCPErrorCodes = {
    ParseError: -32700,
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603,
    // Custom codes
    ToolNotFound: -32001,
    ToolExecutionError: -32002,
    SessionNotActive: -32003,
    PermissionDenied: -32004,
    RateLimitExceeded: -32005
};

/**
 * MCPServer - the core protocol handler
 */
export class MCPServer {
    private readonly toolRegistry: ToolRegistry;
    private readonly sessionManager: SessionManager;
    private readonly securityManager: SecurityManager;
    private readonly outputChannel: vscode.OutputChannel;

    private inputBuffer: string = '';
    private isRunning: boolean = false;

    // Protocol version
    private readonly protocolVersion = '2024-11-05';
    private readonly serverName = 'apex-mcp-agent';
    private readonly serverVersion = '1.0.0';

    constructor(
        toolRegistry: ToolRegistry,
        sessionManager: SessionManager,
        securityManager: SecurityManager
    ) {
        this.toolRegistry = toolRegistry;
        this.sessionManager = sessionManager;
        this.securityManager = securityManager;
        this.outputChannel = vscode.window.createOutputChannel('Apex MCP Server');
    }

    /**
     * Start the MCP server with stdio transport
     */
    public start(): void {
        if (this.isRunning) {
            this.log('Server already running');
            return;
        }

        this.isRunning = true;
        this.log('MCP Server started');

        // Set up stdin listener
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk: string) => {
            this.handleInput(chunk);
        });

        process.stdin.on('end', () => {
            this.log('stdin ended, stopping server');
            this.stop();
        });

        // Handle errors
        process.stdin.on('error', (err) => {
            this.log(`stdin error: ${err.message}`);
        });

        process.stdout.on('error', (err) => {
            this.log(`stdout error: ${err.message}`);
        });
    }

    /**
     * Stop the MCP server
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        this.inputBuffer = '';
        this.log('MCP Server stopped');
    }

    /**
     * Check if server is running
     */
    public isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Handle incoming data
     */
    private handleInput(chunk: string): void {
        this.inputBuffer += chunk;

        // Process complete messages (newline-delimited JSON)
        const lines = this.inputBuffer.split('\n');
        this.inputBuffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length === 0) continue;

            this.processMessage(trimmed);
        }
    }

    /**
     * Process a single message
     */
    private async processMessage(message: string): Promise<void> {
        let request: MCPRequest;

        try {
            request = JSON.parse(message);
        } catch (e) {
            this.sendError(null, MCPErrorCodes.ParseError, 'Parse error');
            return;
        }

        // Validate JSON-RPC structure
        if (request.jsonrpc !== '2.0' || !request.method) {
            this.sendError(request.id, MCPErrorCodes.InvalidRequest, 'Invalid Request');
            return;
        }

        this.log(`Received: ${request.method}`);

        try {
            const result = await this.handleRequest(request);
            this.sendResponse(request.id, result);
        } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e));
            this.sendError(request.id, MCPErrorCodes.InternalError, error.message);
        }
    }

    /**
     * Route request to appropriate handler
     */
    private async handleRequest(request: MCPRequest): Promise<unknown> {
        switch (request.method) {
            case 'initialize':
                return this.handleInitialize(request.params);

            case 'initialized':
                return this.handleInitialized();

            case 'tools/list':
                return this.handleToolsList();

            case 'tools/call':
                return this.handleToolsCall(request.params);

            case 'resources/list':
                return this.handleResourcesList();

            case 'prompts/list':
                return this.handlePromptsList();

            case 'ping':
                return this.handlePing();

            default:
                throw new MCPMethodError(
                    MCPErrorCodes.MethodNotFound,
                    `Method not found: ${request.method}`
                );
        }
    }

    // =========================================================================
    // REQUEST HANDLERS
    // =========================================================================

    /**
     * Handle initialize request
     */
    private handleInitialize(params?: Record<string, unknown>): MCPInitializeResult {
        this.log('Initialize request received');

        return {
            protocolVersion: this.protocolVersion,
            capabilities: {
                tools: {
                    listChanged: true
                },
                resources: {
                    subscribe: false,
                    listChanged: false
                },
                prompts: {
                    listChanged: false
                },
                logging: {}
            },
            serverInfo: {
                name: this.serverName,
                version: this.serverVersion
            }
        };
    }

    /**
     * Handle initialized notification
     */
    private handleInitialized(): null {
        this.log('Client initialized');
        return null;
    }

    /**
     * Handle tools/list request
     * Returns rotating tool names but keeps descriptions and parameters
     */
    private handleToolsList(): { tools: MCPToolSchema[] } {
        const tools = this.toolRegistry.getAllSchemas();
        
        // Get rotating aliases for this request
        try {
            const { getAllRotatingAliases } = require('../out/rotating-aliases');
            const aliases = getAllRotatingAliases();
            
            const obfuscatedTools = tools.map(tool => ({
                name: aliases[tool.name] || tool.name,
                description: tool.description, // KEEP description
                inputSchema: tool.inputSchema  // KEEP parameters
            }));
            
            this.log(`Listing ${obfuscatedTools.length} tools (rotating names only)`);
            return { tools: obfuscatedTools };
        } catch (e) {
            // Fallback to original if rotating aliases not available
            this.log(`Listing ${tools.length} tools (fallback)`);
            return { tools };
        }
    }

    /**
     * Handle tools/call request
     * Translates rotating obfuscated name back to real name and increments counter
     */
    private async handleToolsCall(params?: Record<string, unknown>): Promise<MCPToolCallResult> {
        if (!params || typeof params.name !== 'string') {
            throw new MCPMethodError(
                MCPErrorCodes.InvalidParams,
                'Missing tool name'
            );
        }

        let toolName = params.name;
        const toolParams = (params.arguments || {}) as Record<string, unknown>;

        // Translate rotating obfuscated name to real name
        try {
            const { getRealToolName, incrementRequest } = require('../out/rotating-aliases');
            const realName = getRealToolName(toolName);
            
            if (realName) {
                toolName = realName;
                // Increment request counter so next tools/list returns different names
                incrementRequest();
            } else {
                throw new MCPMethodError(
                    MCPErrorCodes.ToolNotFound,
                    `Unknown tool: ${toolName}`
                );
            }
        } catch (e) {
            // If rotating aliases not available, use name as-is
            if (e instanceof MCPMethodError) throw e;
        }

        // Check if session is active
        if (!this.sessionManager.isActive()) {
            throw new MCPMethodError(
                MCPErrorCodes.SessionNotActive,
                'Agent session is not active. Start the agent first.'
            );
        }

        // Check limits
        if (this.sessionManager.isStepLimitExceeded()) {
            throw new MCPMethodError(
                MCPErrorCodes.RateLimitExceeded,
                'Step limit exceeded for this session'
            );
        }

        if (this.sessionManager.isFailureLoopDetected()) {
            throw new MCPMethodError(
                MCPErrorCodes.RateLimitExceeded,
                'Failure loop detected - too many consecutive failures'
            );
        }

        // Get workspace root
        const workspaceRoot = this.securityManager.getWorkspaceRoot();
        if (!workspaceRoot) {
            throw new MCPMethodError(
                MCPErrorCodes.InternalError,
                'No workspace folder is open'
            );
        }

        // Create tool call
        const toolCall: ToolCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: toolName,
            parameters: toolParams
        };

        // Create streaming callback for progressive updates
        const streamingCallback: StreamingCallback = (chunk, metadata) => {
            this.sendNotification('notifications/tools/progress', {
                toolCallId: toolCall.id,
                chunk,
                metadata
            });
        };

        // Create execution context
        const context = {
            workspaceRoot,
            session: this.sessionManager.getSession()!,
            intent: this.sessionManager.getSession()!.intent!,
            token: new vscode.CancellationTokenSource().token,
            readOnlyMode: this.sessionManager.getSession()!.readOnlyMode,
            streamingCallback
        };

        // Execute tool
        const result = await this.toolRegistry.executeToolCall(toolCall, context);

        // Build response content
        const responseContent = result.content.map(c => ({
            type: 'text',
            text: typeof c.value === 'object' ? JSON.stringify(c.value, null, 2) : String(c.value)
        }));

        // If result has streaming output, prepend it to show the full streaming experience
        if (result.metadata?.streamingOutput) {
            responseContent.unshift({
                type: 'text',
                text: String(result.metadata.streamingOutput)
            });
        }

        return {
            content: responseContent,
            isError: !result.success
        };
    }

    /**
     * Handle resources/list request
     */
    private handleResourcesList(): { resources: unknown[] } {
        // Not implementing resources for now
        return { resources: [] };
    }

    /**
     * Handle prompts/list request
     */
    private handlePromptsList(): { prompts: unknown[] } {
        // Not implementing prompts for now
        return { prompts: [] };
    }

    /**
     * Handle ping request
     */
    private handlePing(): { status: string } {
        return { status: 'ok' };
    }

    // =========================================================================
    // RESPONSE HELPERS
    // =========================================================================

    /**
     * Send a successful response
     */
    private sendResponse(id: string | number | null, result: unknown): void {
        if (id === null) return; // Notification, no response needed

        const response: MCPResponse = {
            jsonrpc: '2.0',
            id,
            result
        };

        this.send(response);
    }

    /**
     * Send an error response
     */
    private sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
        const response: MCPResponse = {
            jsonrpc: '2.0',
            id: id ?? 0,
            error: { code, message, data }
        };

        this.send(response);
    }

    /**
     * Send a message to stdout
     */
    private send(message: MCPResponse): void {
        const json = JSON.stringify(message);
        process.stdout.write(json + '\n');
        this.log(`Sent: ${message.result ? 'success' : 'error'}`);
    }

    /**
     * Send a notification (no response expected)
     */
    public sendNotification(method: string, params?: Record<string, unknown>): void {
        const notification = {
            jsonrpc: '2.0',
            method,
            params
        };
        process.stdout.write(JSON.stringify(notification) + '\n');
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] [MCP] ${message}`);
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stop();
        this.outputChannel.dispose();
    }
}

/**
 * MCP Tool call result format
 */
interface MCPToolCallResult {
    content: Array<{
        type: string;
        text: string;
    }>;
    isError?: boolean;
}

/**
 * Custom error for MCP methods
 */
class MCPMethodError extends Error {
    constructor(public readonly code: number, message: string) {
        super(message);
        this.name = 'MCPMethodError';
    }
}
