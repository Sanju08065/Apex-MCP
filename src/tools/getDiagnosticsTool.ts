/**
 * =============================================================================
 * APEX MCP AGENT - GET DIAGNOSTICS TOOL
 * =============================================================================
 * 
 * Get diagnostic information (errors, warnings, hints) from VS Code.
 * Non-destructive, safe for read-only mode.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';

interface GetDiagnosticsParams {
    path?: string;
    severity?: 'error' | 'warning' | 'info' | 'hint';
}

interface DiagnosticEntry {
    path: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    message: string;
    severity: 'error' | 'warning' | 'info' | 'hint';
    source?: string;
    code?: string | number;
}

export class GetDiagnosticsTool extends BaseTool {
    public readonly id = 'get_diagnostics';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'get_diagnostics',
        description: 'Get diagnostic information (errors, warnings, hints) for files. Use this to check for compilation errors, linting issues, or type errors before and after making changes.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path to check (omit for all files with diagnostics)'
                },
                severity: {
                    type: 'string',
                    description: 'Filter by severity level',
                    enum: ['error', 'warning', 'info', 'hint']
                }
            },
            required: []
        }
    };

    private severityToString(severity: vscode.DiagnosticSeverity): 'error' | 'warning' | 'info' | 'hint' {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error:
                return 'error';
            case vscode.DiagnosticSeverity.Warning:
                return 'warning';
            case vscode.DiagnosticSeverity.Information:
                return 'info';
            case vscode.DiagnosticSeverity.Hint:
                return 'hint';
            default:
                return 'info';
        }
    }

    private stringToSeverity(severity: string): vscode.DiagnosticSeverity | undefined {
        switch (severity) {
            case 'error':
                return vscode.DiagnosticSeverity.Error;
            case 'warning':
                return vscode.DiagnosticSeverity.Warning;
            case 'info':
                return vscode.DiagnosticSeverity.Information;
            case 'hint':
                return vscode.DiagnosticSeverity.Hint;
            default:
                return undefined;
        }
    }

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        // Path validation if provided
        if (params.path) {
            const pathValidation = this.validatePath(params.path as string, 'read');
            if (!pathValidation.valid) {
                return pathValidation;
            }
        }

        return {
            valid: true,
            errors: [],
            warnings: [],
            sanitizedParams: params
        };
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const { path: filePath, severity } = params as GetDiagnosticsParams;

        try {
            const diagnostics: DiagnosticEntry[] = [];
            const severityFilter = severity ? this.stringToSeverity(severity) : undefined;

            // Get all diagnostics from VS Code
            const allDiagnostics = vscode.languages.getDiagnostics();

            for (const [uri, fileDiagnostics] of allDiagnostics) {
                // Check if file is in workspace
                const relativePath = vscode.workspace.asRelativePath(uri);
                if (relativePath === uri.fsPath) {
                    // File is outside workspace
                    continue;
                }

                // Filter by path if specified
                if (filePath && relativePath !== filePath) {
                    continue;
                }

                for (const diagnostic of fileDiagnostics) {
                    // Filter by severity if specified
                    if (severityFilter !== undefined && diagnostic.severity !== severityFilter) {
                        continue;
                    }

                    const codeValue = typeof diagnostic.code === 'object'
                        ? diagnostic.code.value
                        : diagnostic.code;

                    diagnostics.push({
                        path: relativePath,
                        line: diagnostic.range.start.line + 1,
                        column: diagnostic.range.start.character + 1,
                        endLine: diagnostic.range.end.line + 1,
                        endColumn: diagnostic.range.end.character + 1,
                        message: diagnostic.message,
                        severity: this.severityToString(diagnostic.severity),
                        source: diagnostic.source,
                        code: codeValue
                    });
                }
            }

            // Calculate summary
            const summary = {
                errors: diagnostics.filter(d => d.severity === 'error').length,
                warnings: diagnostics.filter(d => d.severity === 'warning').length,
                info: diagnostics.filter(d => d.severity === 'info').length,
                hints: diagnostics.filter(d => d.severity === 'hint').length
            };

            return this.createSuccessResult({
                diagnostics,
                summary,
                total: diagnostics.length
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Error getting diagnostics: ${errorMessage}`);
        }
    }
}
