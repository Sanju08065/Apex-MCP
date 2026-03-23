/**
 * =============================================================================
 * APEX MCP AGENT - GIT STATUS TOOL
 * =============================================================================
 * 
 * Get repository status with structured output.
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
import * as path from 'path';

export class GitStatusTool extends BaseTool {
    public readonly id = 'git_status';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'git_status',
        description: 'Get repository status with structured output including branch info, staged/unstaged changes, and sync status',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
                },
                includeUntracked: {
                    type: 'boolean',
                    description: 'Include untracked files (default: true)'
                },
                includeIgnored: {
                    type: 'boolean',
                    description: 'Include ignored files (default: false)'
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

            const includeUntracked = params.includeUntracked !== false;
            const includeIgnored = params.includeIgnored === true;

            // Get branch info
            const branch = await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath);

            // Get ahead/behind info
            let ahead = 0;
            let behind = 0;
            try {
                const revList = await this.execGit(['rev-list', '--left-right', '--count', '@{upstream}...HEAD'], workspacePath);
                const [behindStr, aheadStr] = revList.trim().split('\t');
                behind = parseInt(behindStr, 10) || 0;
                ahead = parseInt(aheadStr, 10) || 0;
            } catch {
                // No upstream or not a git repo
            }

            // Get status with porcelain format for easy parsing
            let statusArgs = ['status', '--porcelain=v2', '--branch'];
            if (includeUntracked) {
                statusArgs.push('-uall');
            } else {
                statusArgs.push('-uno');
            }
            if (includeIgnored) {
                statusArgs.push('--ignored');
            }

            const statusOutput = await this.execGit(statusArgs, workspacePath);

            // Parse status output
            const modified: string[] = [];
            const staged: string[] = [];
            const untracked: string[] = [];
            const deleted: string[] = [];
            const renamed: { from: string; to: string }[] = [];
            const conflicted: string[] = [];
            const ignored: string[] = [];

            const lines = statusOutput.split('\n').filter(line => line.length > 0);

            for (const line of lines) {
                if (line.startsWith('#')) continue; // Branch header

                if (line.startsWith('1 ') || line.startsWith('2 ')) {
                    // Changed entries
                    const parts = line.split(' ');
                    const xy = parts[1];
                    const filePath = line.substring(line.lastIndexOf('\t') + 1) || parts[parts.length - 1];

                    const indexStatus = xy[0];
                    const workTreeStatus = xy[1];

                    // Handle index (staged) status
                    if (indexStatus === 'M' || indexStatus === 'A') {
                        staged.push(filePath);
                    }
                    if (indexStatus === 'D') {
                        staged.push(filePath);
                    }
                    if (indexStatus === 'R') {
                        const oldPath = parts[parts.length - 2];
                        renamed.push({ from: oldPath, to: filePath });
                    }

                    // Handle work tree status
                    if (workTreeStatus === 'M') {
                        modified.push(filePath);
                    }
                    if (workTreeStatus === 'D') {
                        deleted.push(filePath);
                    }

                    // Handle conflicts
                    if (xy === 'UU' || xy === 'AA' || xy === 'DD') {
                        conflicted.push(filePath);
                    }
                } else if (line.startsWith('? ')) {
                    // Untracked
                    untracked.push(line.substring(2));
                } else if (line.startsWith('! ')) {
                    // Ignored
                    ignored.push(line.substring(2));
                }
            }

            const isClean = modified.length === 0 && staged.length === 0 &&
                untracked.length === 0 && deleted.length === 0 &&
                renamed.length === 0 && conflicted.length === 0;

            const result = {
                success: true,
                data: {
                    branch: branch.trim(),
                    ahead,
                    behind,
                    modified,
                    staged,
                    untracked,
                    deleted,
                    renamed,
                    conflicted,
                    ignored: includeIgnored ? ignored : undefined,
                    clean: isClean
                }
            };

            return this.createSuccessResult(result);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git status failed: ${message}`);
        }
    }

    private execGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`git ${args.join(' ')}`, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
