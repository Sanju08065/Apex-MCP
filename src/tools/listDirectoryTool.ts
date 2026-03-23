/**
 * =============================================================================
 * APEX MCP AGENT - LIST DIRECTORY TOOL
 * =============================================================================
 * 
 * List files and directories in the workspace.
 * Non-destructive, safe for read-only mode.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';

interface ListDirectoryParams {
    path: string;
    recursive?: boolean;
    depth?: number;
    includeHidden?: boolean;
}

interface DirectoryEntry {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'symlink';
    size?: number;
    children?: DirectoryEntry[];
}

export class ListDirectoryTool extends BaseTool {
    public readonly id = 'list_directory';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'list_directory',
        description: 'List files and folders in a directory. Use this to explore project structure, find files, or understand the codebase organization. Can list recursively with depth control.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Directory path relative to workspace root. Use "." for root.'
                },
                recursive: {
                    type: 'boolean',
                    description: 'Whether to list subdirectories recursively (default: false)'
                },
                depth: {
                    type: 'number',
                    description: 'Maximum depth for recursive listing (default: 3)'
                },
                includeHidden: {
                    type: 'boolean',
                    description: 'Whether to include hidden files starting with . (default: false)'
                }
            },
            required: ['path']
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        const path = params.path as string;

        // Allow "." for root
        if (path !== '.') {
            const pathValidation = this.validatePath(path, 'read');
            if (!pathValidation.valid) {
                return pathValidation;
            }
        }

        // Validate depth
        const depth = params.depth as number | undefined;
        if (depth !== undefined && (depth < 1 || depth > 10)) {
            return {
                valid: false,
                errors: ['Depth must be between 1 and 10'],
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: [],
            sanitizedParams: params
        };
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const dirPath = params.path as string;
        const recursive = (params.recursive as boolean | undefined) ?? false;
        const depth = (params.depth as number | undefined) ?? 3;
        const includeHidden = (params.includeHidden as boolean | undefined) ?? false;

        try {
            const targetUri = dirPath === '.'
                ? context.workspaceRoot
                : this.resolvePath(dirPath);

            if (!targetUri) {
                return this.createErrorResult(`Cannot resolve path: ${dirPath}`);
            }

            // Check if directory exists
            try {
                const stat = await vscode.workspace.fs.stat(targetUri);
                if (stat.type !== vscode.FileType.Directory) {
                    return this.createErrorResult('Path is not a directory');
                }
            } catch {
                return this.createErrorResult(`Directory not found: ${dirPath}`);
            }

            let totalFiles = 0;
            let totalDirectories = 0;

            const listDir = async (uri: vscode.Uri, currentDepth: number): Promise<DirectoryEntry[]> => {
                if (currentDepth > depth) {
                    return [];
                }

                const entries: DirectoryEntry[] = [];
                const dirContents = await vscode.workspace.fs.readDirectory(uri);

                for (const [name, type] of dirContents) {
                    // Skip hidden files if not requested
                    if (!includeHidden && name.startsWith('.')) {
                        continue;
                    }

                    // Skip blocked directories
                    const blockedDirs = ['node_modules', '.git', '__pycache__', 'dist', 'build'];
                    if (type === vscode.FileType.Directory && blockedDirs.includes(name)) {
                        continue;
                    }

                    const entryUri = vscode.Uri.joinPath(uri, name);
                    const relativePath = vscode.workspace.asRelativePath(entryUri);
                    const isDirectory = type === vscode.FileType.Directory;
                    const isSymlink = type === vscode.FileType.SymbolicLink;

                    let size: number | undefined;
                    if (!isDirectory) {
                        try {
                            const stat = await vscode.workspace.fs.stat(entryUri);
                            size = stat.size;
                        } catch {
                            // Ignore size errors
                        }
                    }

                    const entry: DirectoryEntry = {
                        name,
                        path: relativePath,
                        type: isSymlink ? 'symlink' : (isDirectory ? 'directory' : 'file'),
                        size
                    };

                    if (isDirectory) {
                        totalDirectories++;
                        if (recursive && currentDepth < depth) {
                            entry.children = await listDir(entryUri, currentDepth + 1);
                        }
                    } else {
                        totalFiles++;
                    }

                    entries.push(entry);
                }

                // Sort: directories first, then files, alphabetically
                entries.sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1;
                    if (a.type !== 'directory' && b.type === 'directory') return 1;
                    return a.name.localeCompare(b.name);
                });

                return entries;
            };

            const entries = await listDir(targetUri, 1);

            return this.createSuccessResult({
                path: dirPath,
                entries,
                totalFiles,
                totalDirectories
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Error listing directory: ${errorMessage}`);
        }
    }
}
