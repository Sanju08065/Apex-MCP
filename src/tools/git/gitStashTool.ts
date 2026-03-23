/**
 * =============================================================================
 * APEX MCP AGENT - GIT STASH TOOL
 * =============================================================================
 * 
 * Stash working directory changes.
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

interface StashEntry {
    index: number;
    branch: string;
    message: string;
    timestamp?: string;
}

export class GitStashTool extends BaseTool {
    public readonly id = 'git_stash';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'git_stash',
        description: 'Stash working directory changes: push, pop, list, apply, drop, clear',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Action: push, pop, list, apply, drop, clear'
                },
                message: {
                    type: 'string',
                    description: 'Stash message (for push)'
                },
                index: {
                    type: 'number',
                    description: 'Stash index (for pop, apply, drop)'
                },
                includeUntracked: {
                    type: 'boolean',
                    description: 'Include untracked files (for push)'
                },
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
                }
            },
            required: ['action']
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

            const action = params.action as string;
            const message = params.message as string | undefined;
            const index = params.index as number | undefined;
            const includeUntracked = params.includeUntracked as boolean || false;

            switch (action) {
                case 'push':
                    return await this.stashPush(workspacePath, message, includeUntracked);
                case 'pop':
                    return await this.stashPop(workspacePath, index);
                case 'list':
                    return await this.stashList(workspacePath);
                case 'apply':
                    return await this.stashApply(workspacePath, index);
                case 'drop':
                    return await this.stashDrop(workspacePath, index);
                case 'clear':
                    return await this.stashClear(workspacePath);
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git stash failed: ${msg}`);
        }
    }

    private async stashPush(cwd: string, message?: string, includeUntracked?: boolean): Promise<ToolResult> {
        const args = ['stash', 'push'];

        if (includeUntracked) {
            args.push('-u');
        }
        if (message) {
            args.push('-m', `"${message}"`);
        }

        await this.execGit(args, cwd);
        const stashes = await this.parseStashList(cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'push',
                message: message || 'WIP',
                stashCount: stashes.length
            }
        });
    }

    private async stashPop(cwd: string, index?: number): Promise<ToolResult> {
        const stashRef = index !== undefined ? `stash@{${index}}` : '';
        const args = ['stash', 'pop'];
        if (stashRef) {
            args.push(stashRef);
        }

        await this.execGit(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'pop',
                index: index || 0
            }
        });
    }

    private async stashList(cwd: string): Promise<ToolResult> {
        const stashes = await this.parseStashList(cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'list',
                stashes
            }
        });
    }

    private async stashApply(cwd: string, index?: number): Promise<ToolResult> {
        const stashRef = index !== undefined ? `stash@{${index}}` : '';
        const args = ['stash', 'apply'];
        if (stashRef) {
            args.push(stashRef);
        }

        await this.execGit(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'apply',
                index: index || 0
            }
        });
    }

    private async stashDrop(cwd: string, index?: number): Promise<ToolResult> {
        const stashRef = index !== undefined ? `stash@{${index}}` : '';
        const args = ['stash', 'drop'];
        if (stashRef) {
            args.push(stashRef);
        }

        await this.execGit(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'drop',
                index: index || 0
            }
        });
    }

    private async stashClear(cwd: string): Promise<ToolResult> {
        await this.execGit(['stash', 'clear'], cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'clear'
            }
        });
    }

    private async parseStashList(cwd: string): Promise<StashEntry[]> {
        const output = await this.execGit(['stash', 'list', '--format=%gd|%gs|%ar'], cwd);
        const stashes: StashEntry[] = [];

        const lines = output.split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            const [ref, message, timestamp] = line.split('|');
            const indexMatch = ref?.match(/stash@\{(\d+)\}/);
            const branchMatch = message?.match(/On (\S+):/);

            stashes.push({
                index: indexMatch ? parseInt(indexMatch[1], 10) : stashes.length,
                branch: branchMatch ? branchMatch[1] : 'unknown',
                message: message || '',
                timestamp
            });
        }

        return stashes;
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
