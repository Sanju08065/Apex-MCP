/**
 * =============================================================================
 * APEX MCP AGENT - SEARCH CODEBASE TOOL
 * =============================================================================
 * 
 * Search for patterns in the workspace using VS Code's search API.
 * Non-destructive, safe for read-only mode.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';

interface SearchCodebaseParams {
    pattern: string;
    path?: string;
    includePattern?: string;
    excludePattern?: string;
    caseSensitive?: boolean;
    maxResults?: number;
}

interface SearchMatch {
    path: string;
    line: number;
    column: number;
    content: string;
}

export class SearchCodebaseTool extends BaseTool {
    public readonly id = 'search_codebase';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'search_codebase',
        description: 'Search for text or code patterns within files. Returns matching lines with file locations. Use this to find function definitions, variable usages, imports, or any code pattern.',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: {
                    type: 'string',
                    description: 'Search pattern (literal text)'
                },
                path: {
                    type: 'string',
                    description: 'Directory to search in relative to workspace root (default: entire workspace)'
                },
                includePattern: {
                    type: 'string',
                    description: 'Glob pattern for files to include (e.g., "**/*.ts")'
                },
                excludePattern: {
                    type: 'string',
                    description: 'Glob pattern for files to exclude'
                },
                caseSensitive: {
                    type: 'boolean',
                    description: 'Whether search is case sensitive (default: false)'
                },
                maxResults: {
                    type: 'number',
                    description: 'Maximum number of results to return (default: 50)'
                }
            },
            required: ['pattern']
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        const pattern = params.pattern as string | undefined;
        if (!pattern || pattern.length === 0) {
            return {
                valid: false,
                errors: ['Search pattern cannot be empty'],
                warnings: []
            };
        }

        // Validate path if provided
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
        const pattern = params.pattern as string;
        const searchPath = params.path as string | undefined;
        const includePattern = params.includePattern as string | undefined;
        const excludePattern = params.excludePattern as string | undefined;
        const caseSensitive = (params.caseSensitive as boolean | undefined) ?? false;
        const maxResults = (params.maxResults as number | undefined) ?? 50;

        try {
            // Build include pattern
            let includeGlob = includePattern || '**/*';
            if (searchPath) {
                const resolvedPath = this.resolvePath(searchPath);
                if (resolvedPath) {
                    const relativePath = searchPath.replace(/\\/g, '/');
                    includeGlob = `${relativePath}/**/*`;
                }
            }

            // Build exclude pattern with defaults
            const defaultExcludes = [
                '**/node_modules/**',
                '**/.git/**',
                '**/dist/**',
                '**/build/**',
                '**/out/**',
                '**/.vscode/**'
            ];

            // Use VS Code's findFiles and then search manually
            const files = await vscode.workspace.findFiles(
                includeGlob,
                `{${defaultExcludes.join(',')}}`,
                maxResults * 10 // Get more files since we'll filter
            );

            const matches: SearchMatch[] = [];
            const patternLower = caseSensitive ? pattern : pattern.toLowerCase();

            for (const fileUri of files) {
                if (matches.length >= maxResults) {
                    break;
                }

                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    const text = document.getText();
                    const lines = text.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const searchLine = caseSensitive ? line : line.toLowerCase();
                        const index = searchLine.indexOf(patternLower);

                        if (index !== -1) {
                            const relativePath = vscode.workspace.asRelativePath(fileUri);
                            matches.push({
                                path: relativePath,
                                line: i + 1, // 1-indexed
                                column: index + 1,
                                content: line.trim().substring(0, 200) // Truncate long lines
                            });

                            if (matches.length >= maxResults) {
                                break;
                            }
                        }
                    }
                } catch {
                    // Skip files that can't be opened
                    continue;
                }
            }

            return this.createSuccessResult({
                pattern,
                matches,
                totalMatches: matches.length,
                truncated: matches.length >= maxResults,
                searchPath: searchPath || 'workspace root'
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Search error: ${errorMessage}`);
        }
    }
}
