/**
 * =============================================================================
 * APEX MCP AGENT - BASE TOOL CLASS
 * =============================================================================
 * 
 * Abstract base class for all tools.
 * Provides common functionality and enforces the tool interface.
 */

import * as vscode from 'vscode';
import {
    ITool,
    MCPToolSchema,
    ToolExecutionContext,
    ToolResult,
    ValidationResult,
    RollbackEntry
} from '../types';
import { SecurityManager, getSecurityManager } from '../security';

/**
 * Abstract base class for all tools
 */
export abstract class BaseTool implements ITool {
    public abstract readonly id: string;
    public abstract readonly schema: MCPToolSchema;
    public abstract readonly requiresConfirmation: boolean;
    public abstract readonly isDestructive: boolean;

    protected readonly securityManager: SecurityManager;

    constructor() {
        this.securityManager = getSecurityManager();
    }

    /**
     * Validate parameters - override in subclass for specific validation
     */
    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate required parameters from schema
        const required = this.schema.inputSchema.required || [];
        for (const param of required) {
            if (params[param] === undefined || params[param] === null) {
                errors.push(`Missing required parameter: ${param}`);
            }
        }

        // Validate parameter types
        for (const [key, value] of Object.entries(params)) {
            const propSchema = this.schema.inputSchema.properties[key];
            if (propSchema) {
                const typeError = this.validateType(key, value, propSchema.type);
                if (typeError) {
                    errors.push(typeError);
                }
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            sanitizedParams: errors.length === 0 ? params : undefined
        };
    }

    /**
     * Execute the tool - must be implemented by subclass
     */
    public abstract execute(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult>;

    /**
     * Prepare rollback - override in subclass if rollback is supported
     */
    public async prepareRollback(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<RollbackEntry | null> {
        return null; // Default: no rollback support
    }

    /**
     * Helper: Create a success result
     */
    protected createSuccessResult(value: unknown, metadata?: Record<string, unknown>): ToolResult {
        return {
            success: true,
            content: [{
                type: typeof value === 'object' ? 'json' : 'text',
                value: typeof value === 'object' ? value as Record<string, unknown> : String(value)
            }],
            metadata
        };
    }

    /**
     * Helper: Create an error result
     */
    protected createErrorResult(error: string, metadata?: Record<string, unknown>): ToolResult {
        return {
            success: false,
            content: [{ type: 'error', value: error }],
            error,
            metadata
        };
    }

    /**
     * Helper: Validate path parameter
     */
    protected validatePath(
        path: string,
        operation: 'read' | 'write' | 'delete'
    ): ValidationResult {
        return this.securityManager.validatePath(path, operation);
    }

    /**
     * Helper: Resolve path to URI
     */
    protected resolvePath(relativePath: string): vscode.Uri | null {
        return this.securityManager.resolvePath(relativePath);
    }

    /**
     * Helper: Validate type
     */
    private validateType(
        paramName: string,
        value: unknown,
        expectedType: string
    ): string | null {
        const actualType = typeof value;

        switch (expectedType) {
            case 'string':
                if (actualType !== 'string') {
                    return `Parameter '${paramName}' must be a string, got ${actualType}`;
                }
                break;
            case 'number':
                if (actualType !== 'number' || isNaN(value as number)) {
                    return `Parameter '${paramName}' must be a number, got ${actualType}`;
                }
                break;
            case 'boolean':
                if (actualType !== 'boolean') {
                    return `Parameter '${paramName}' must be a boolean, got ${actualType}`;
                }
                break;
            case 'array':
                if (!Array.isArray(value)) {
                    return `Parameter '${paramName}' must be an array, got ${actualType}`;
                }
                break;
            case 'object':
                if (actualType !== 'object' || value === null || Array.isArray(value)) {
                    return `Parameter '${paramName}' must be an object, got ${actualType}`;
                }
                break;
        }

        return null;
    }
}
