/**
 * =============================================================================
 * APEX MCP AGENT - TOOL REGISTRY
 * =============================================================================
 * 
 * Central registry for all MCP tools.
 * Manages tool registration, schema generation, and execution routing.
 * 
 * DESIGN PRINCIPLE:
 * All tools must be registered here to be accessible.
 * The registry enforces validation and security before any execution.
 */

import * as vscode from 'vscode';
import {
    ITool,
    MCPToolSchema,
    ToolCall,
    ToolResult,
    ToolExecutionContext,
    ValidationResult,
    ActionRecord,
    RollbackEntry
} from '../types';
import { SecurityManager } from '../security';
import { SessionManager } from '../session';

/**
 * ToolRegistry - central hub for all tool management
 */
export class ToolRegistry {
    private tools: Map<string, ITool> = new Map();
    private readonly securityManager: SecurityManager;
    private readonly sessionManager: SessionManager;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(
        securityManager: SecurityManager,
        sessionManager: SessionManager
    ) {
        this.securityManager = securityManager;
        this.sessionManager = sessionManager;
        this.outputChannel = vscode.window.createOutputChannel('Apex MCP Tools');
    }

    /**
     * Register a tool
     */
    public registerTool(tool: ITool): void {
        if (this.tools.has(tool.id)) {
            this.log(`Warning: Overwriting existing tool: ${tool.id}`);
        }
        this.tools.set(tool.id, tool);
        this.log(`Tool registered: ${tool.id}`);
    }

    /**
     * Unregister a tool
     */
    public unregisterTool(toolId: string): boolean {
        const removed = this.tools.delete(toolId);
        if (removed) {
            this.log(`Tool unregistered: ${toolId}`);
        }
        return removed;
    }

    /**
     * Get a tool by ID
     */
    public getTool(toolId: string): ITool | undefined {
        return this.tools.get(toolId);
    }

    /**
     * Get all registered tool schemas (for MCP tools/list)
     */
    public getAllSchemas(): MCPToolSchema[] {
        return Array.from(this.tools.values()).map(tool => tool.schema);
    }

    /**
     * Check if a tool exists
     */
    public hasTool(toolId: string): boolean {
        return this.tools.has(toolId);
    }

    /**
     * Validate a tool call before execution
     */
    public validateToolCall(
        toolCall: ToolCall,
        context: ToolExecutionContext
    ): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Check tool exists
        const tool = this.tools.get(toolCall.name);
        if (!tool) {
            return {
                valid: false,
                errors: [`Unknown tool: ${toolCall.name}`],
                warnings: []
            };
        }

        // 2. Check read-only mode
        if (context.readOnlyMode && tool.isDestructive) {
            return {
                valid: false,
                errors: [`Tool ${toolCall.name} is blocked in read-only mode`],
                warnings: []
            };
        }

        // 3. Check session limits
        if (this.sessionManager.isToolCallLimitExceeded()) {
            return {
                valid: false,
                errors: ['Tool call limit exceeded for this step'],
                warnings: []
            };
        }

        // 4. Validate against intent
        if (!this.sessionManager.validateAgainstIntent(toolCall.name, toolCall.parameters)) {
            return {
                valid: false,
                errors: ['Action violates session intent scope'],
                warnings: []
            };
        }

        // 5. Tool-specific validation
        const toolValidation = tool.validate(toolCall.parameters, context);
        if (!toolValidation.valid) {
            return toolValidation;
        }

        // Combine warnings
        warnings.push(...toolValidation.warnings);

        return {
            valid: true,
            errors: [],
            warnings,
            sanitizedParams: toolValidation.sanitizedParams
        };
    }

    /**
     * Execute a tool call
     */
    public async executeToolCall(
        toolCall: ToolCall,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        const startTime = Date.now();

        // Create action record
        const actionRecord: ActionRecord = {
            id: toolCall.id,
            tool: toolCall.name,
            parameters: toolCall.parameters,
            timestamp: startTime,
            status: 'pending'
        };
        this.sessionManager.recordAction(actionRecord);

        try {
            // Get tool
            const tool = this.tools.get(toolCall.name);
            if (!tool) {
                throw new Error(`Unknown tool: ${toolCall.name}`);
            }

            // Validate
            const validation = this.validateToolCall(toolCall, context);
            if (!validation.valid) {
                this.sessionManager.updateAction(toolCall.id, {
                    status: 'failed',
                    result: {
                        success: false,
                        content: [{ type: 'error', value: validation.errors.join(', ') }],
                        error: validation.errors.join(', ')
                    },
                    durationMs: Date.now() - startTime
                });

                this.sessionManager.recordFailure({
                    timestamp: Date.now(),
                    tool: toolCall.name,
                    error: validation.errors.join(', '),
                    parameters: toolCall.parameters
                });

                return {
                    success: false,
                    content: [{ type: 'error', value: validation.errors.join(', ') }],
                    error: validation.errors.join(', ')
                };
            }

            // Prepare rollback if tool supports it
            let rollbackEntry: RollbackEntry | null = null;
            if (tool.prepareRollback) {
                rollbackEntry = await tool.prepareRollback(
                    validation.sanitizedParams || toolCall.parameters,
                    context
                );
            }

            // Update status to executing
            this.sessionManager.updateAction(toolCall.id, { status: 'executing' });

            // Execute
            this.log(`Executing tool: ${toolCall.name}`);
            const result = await tool.execute(
                validation.sanitizedParams || toolCall.parameters,
                context
            );

            // Store rollback entry if successful and destructive
            if (result.success && rollbackEntry) {
                this.sessionManager.addRollback(rollbackEntry);
            }

            // Update action record
            const endTime = Date.now();
            this.sessionManager.updateAction(toolCall.id, {
                status: result.success ? 'success' : 'failed',
                result,
                durationMs: endTime - startTime
            });

            // Handle success/failure tracking
            if (result.success) {
                this.sessionManager.resetFailureCount();
            } else {
                this.sessionManager.recordFailure({
                    timestamp: Date.now(),
                    tool: toolCall.name,
                    error: result.error || 'Unknown error',
                    parameters: toolCall.parameters
                });
            }

            this.log(`Tool ${toolCall.name} completed: ${result.success ? 'success' : 'failed'}`);
            return result;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            this.sessionManager.updateAction(toolCall.id, {
                status: 'failed',
                result: {
                    success: false,
                    content: [{ type: 'error', value: errorMessage }],
                    error: errorMessage
                },
                durationMs: Date.now() - startTime
            });

            this.sessionManager.recordFailure({
                timestamp: Date.now(),
                tool: toolCall.name,
                error: errorMessage,
                parameters: toolCall.parameters
            });

            this.log(`Tool ${toolCall.name} error: ${errorMessage}`);

            return {
                success: false,
                content: [{ type: 'error', value: errorMessage }],
                error: errorMessage
            };
        }
    }

    /**
     * Get read-only tools (safe to execute in read-only mode)
     */
    public getReadOnlyTools(): ITool[] {
        return Array.from(this.tools.values()).filter(tool => !tool.isDestructive);
    }

    /**
     * Get destructive tools (require confirmation)
     */
    public getDestructiveTools(): ITool[] {
        return Array.from(this.tools.values()).filter(tool => tool.isDestructive);
    }

    /**
     * Get tools requiring confirmation
     */
    public getConfirmationRequiredTools(): ITool[] {
        return Array.from(this.tools.values()).filter(tool => tool.requiresConfirmation);
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.tools.clear();
        this.outputChannel.dispose();
    }
}
