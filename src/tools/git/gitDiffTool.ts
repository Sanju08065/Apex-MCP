/**
 * =============================================================================
 * APEX MCP AGENT - GIT DIFF TOOL
 * =============================================================================
 * 
 * View changes with structured diff output.
 * Priority: P0 - CRITICAL
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import {
    MCPToolSchema,
    ToolExecutionContext,
    ToolResult
} from '../../types';
import * as cp from 'child_process';

interface DiffChunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: Array<{ type: 'context' | 'add' | 'delete'; content: string }>;
}

interface DiffFile {
    path: string;
    oldPath?: string;
    additions: number;
    deletions: number;
    binary: boolean;
    chunks: DiffChunk[];
}

export class GitDiffTool extends BaseTool {
    public readonly id = 'git_diff';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'git_diff',
        description: 'View changes with structured diff output including line-by-line changes',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
                },
                file: {
                    type: 'string',
                    description: 'Specific file to diff'
                },
                staged: {
                    type: 'boolean',
                    description: 'Show staged changes (default: false)'
                },
                commit: {
                    type: 'string',
                    description: 'Compare against specific commit'
                },
                unified: {
                    type: 'number',
                    description: 'Number of context lines (default: 3)'
                }
            },
            required: []
        }
    };

    public async execute(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        try {
            const workspacePath = params.path as string ||
                vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

            if (!workspacePath) {
                return this.createErrorResult('No workspace folder open');
            }

            const file = params.file as string | undefined;
            const staged = params.staged as boolean || false;
            const commit = params.commit as string | undefined;
            const unified = params.unified as number || 3;

            // Build diff command
            const args = ['diff', `--unified=${unified}`, '--no-color'];

            if (staged) {
                args.push('--cached');
            }

            if (commit) {
                args.push(commit);
            }

            if (file) {
                args.push('--', file);
            }

            const diffOutput = await this.execGit(args, workspacePath);

            // Parse diff output
            const files = this.parseDiff(diffOutput);

            const result = {
                success: true,
                data: {
                    files,
                    totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
                    totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
                    filesChanged: files.length
                }
            };

            return this.createSuccessResult(result);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git diff failed: ${message}`);
        }
    }

    private parseDiff(diffOutput: string): DiffFile[] {
        const files: DiffFile[] = [];
        const lines = diffOutput.split('\n');

        let currentFile: DiffFile | null = null;
        let currentChunk: DiffChunk | null = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // New file header
            if (line.startsWith('diff --git')) {
                if (currentFile) {
                    if (currentChunk) {
                        currentFile.chunks.push(currentChunk);
                    }
                    files.push(currentFile);
                }

                const match = line.match(/diff --git a\/(.+) b\/(.+)/);
                currentFile = {
                    path: match ? match[2] : '',
                    oldPath: match && match[1] !== match[2] ? match[1] : undefined,
                    additions: 0,
                    deletions: 0,
                    binary: false,
                    chunks: []
                };
                currentChunk = null;
            }
            // Binary file
            else if (line.startsWith('Binary files')) {
                if (currentFile) {
                    currentFile.binary = true;
                }
            }
            // Chunk header
            else if (line.startsWith('@@')) {
                if (currentFile && currentChunk) {
                    currentFile.chunks.push(currentChunk);
                }

                const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                if (match) {
                    currentChunk = {
                        oldStart: parseInt(match[1], 10),
                        oldLines: parseInt(match[2] || '1', 10),
                        newStart: parseInt(match[3], 10),
                        newLines: parseInt(match[4] || '1', 10),
                        lines: []
                    };
                }
            }
            // Diff content
            else if (currentChunk) {
                if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentChunk.lines.push({ type: 'add', content: line.substring(1) });
                    if (currentFile) currentFile.additions++;
                } else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentChunk.lines.push({ type: 'delete', content: line.substring(1) });
                    if (currentFile) currentFile.deletions++;
                } else if (line.startsWith(' ')) {
                    currentChunk.lines.push({ type: 'context', content: line.substring(1) });
                }
            }
        }

        // Add last file and chunk
        if (currentFile) {
            if (currentChunk) {
                currentFile.chunks.push(currentChunk);
            }
            files.push(currentFile);
        }

        return files;
    }

    private execGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`git ${args.join(' ')}`, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
