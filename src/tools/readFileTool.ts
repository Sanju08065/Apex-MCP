/**
 * =============================================================================
 * APEX MCP AGENT - READ FILE TOOL
 * =============================================================================
 * 
 * Read file contents from the workspace.
 * Non-destructive, safe for read-only mode.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';

interface ReadFileParams {
    path: string;
    startLine?: number;
    endLine?: number;
}

export class ReadFileTool extends BaseTool {
    public readonly id = 'read_file';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'read_file',
        description: 'Read the contents of a file from the workspace. Use this tool to examine code, configuration files, or any text file. You can optionally specify line ranges for large files.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root'
                },
                startLine: {
                    type: 'number',
                    description: 'Starting line number (1-indexed, optional)'
                },
                endLine: {
                    type: 'number',
                    description: 'Ending line number (1-indexed, optional)'
                }
            },
            required: ['path']
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        // Base validation
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        // Path security validation
        const pathValidation = this.validatePath(params.path as string, 'read');
        if (!pathValidation.valid) {
            return pathValidation;
        }

        // Validate line numbers if provided
        const startLine = params.startLine as number | undefined;
        const endLine = params.endLine as number | undefined;

        if (startLine !== undefined && startLine < 1) {
            return {
                valid: false,
                errors: ['startLine must be >= 1'],
                warnings: []
            };
        }

        if (endLine !== undefined && endLine < 1) {
            return {
                valid: false,
                errors: ['endLine must be >= 1'],
                warnings: []
            };
        }

        if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
            return {
                valid: false,
                errors: ['startLine cannot be greater than endLine'],
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: pathValidation.warnings,
            sanitizedParams: {
                ...params,
                ...pathValidation.sanitizedParams
            }
        };
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const filePath = params.path as string;
        const startLine = params.startLine as number | undefined;
        const endLine = params.endLine as number | undefined;

        try {
            const fileUri = this.resolvePath(filePath);
            if (!fileUri) {
                return this.createErrorResult(`Cannot resolve path: ${filePath}`);
            }

            // Check if file exists
            try {
                await vscode.workspace.fs.stat(fileUri);
            } catch {
                return this.createErrorResult(`File not found: ${filePath}`);
            }

            // Check file size
            const stat = await vscode.workspace.fs.stat(fileUri);
            if (stat.type === vscode.FileType.Directory) {
                return this.createErrorResult('Path is a directory, not a file');
            }

            const sizeValidation = this.securityManager.validateFileSize(stat.size);
            if (!sizeValidation.valid) {
                return this.createErrorResult(sizeValidation.errors[0]);
            }

            // Read file
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
            let content = new TextDecoder().decode(contentBytes);
            const lines = content.split('\n');
            const totalLines = lines.length;

            // Apply line range if specified
            if (startLine !== undefined || endLine !== undefined) {
                const start = Math.max(1, startLine || 1) - 1;
                const end = Math.min(totalLines, endLine || totalLines);
                content = lines.slice(start, end).join('\n');
            }

            return this.createSuccessResult({
                path: filePath,
                totalLines,
                size: stat.size,
                content,
                range: (startLine || endLine) ? {
                    start: startLine || 1,
                    end: endLine || totalLines
                } : null
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Error reading file: ${errorMessage}`);
        }
    }
}
