/**
 * =============================================================================
 * APEX MCP AGENT - GIT BRANCH TOOL
 * =============================================================================
 * 
 * Branch management operations.
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

interface BranchInfo {
    name: string;
    current: boolean;
    remote: string | null;
    lastCommit: string;
    ahead: number;
    behind: number;
}

export class GitBranchTool extends BaseTool {
    public readonly id = 'git_branch';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'git_branch',
        description: 'Branch management: list, create, delete, checkout, or merge branches',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Action: list, create, delete, checkout, merge'
                },
                name: {
                    type: 'string',
                    description: 'Branch name (required for most actions)'
                },
                base: {
                    type: 'string',
                    description: 'Base branch for create'
                },
                force: {
                    type: 'boolean',
                    description: 'Force delete (default: false)'
                },
                remote: {
                    type: 'boolean',
                    description: 'Include remote branches in list (default: false)'
                },
                track: {
                    type: 'boolean',
                    description: 'Set upstream on create (default: false)'
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
            const name = params.name as string | undefined;
            const base = params.base as string | undefined;
            const force = params.force as boolean || false;
            const includeRemote = params.remote as boolean || false;
            const track = params.track as boolean || false;

            switch (action) {
                case 'list':
                    return await this.listBranches(workspacePath, includeRemote);
                case 'create':
                    if (!name) {
                        return this.createErrorResult('Branch name is required for create');
                    }
                    return await this.createBranch(workspacePath, name, base, track);
                case 'delete':
                    if (!name) {
                        return this.createErrorResult('Branch name is required for delete');
                    }
                    return await this.deleteBranch(workspacePath, name, force);
                case 'checkout':
                    if (!name) {
                        return this.createErrorResult('Branch name is required for checkout');
                    }
                    return await this.checkoutBranch(workspacePath, name);
                case 'merge':
                    if (!name) {
                        return this.createErrorResult('Branch name is required for merge');
                    }
                    return await this.mergeBranch(workspacePath, name);
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git branch failed: ${message}`);
        }
    }

    private async listBranches(cwd: string, includeRemote: boolean): Promise<ToolResult> {
        const args = ['branch', '-vv', '--format=%(refname:short)|%(objectname:short)|%(upstream:short)|%(upstream:track)'];
        if (includeRemote) {
            args.push('-a');
        }

        const output = await this.execGit(args, cwd);
        const currentBranch = (await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();

        const branches: BranchInfo[] = [];
        const lines = output.split('\n').filter(l => l.length > 0);

        for (const line of lines) {
            const [name, commit, upstream, tracking] = line.split('|');

            let ahead = 0;
            let behind = 0;
            if (tracking) {
                const aheadMatch = tracking.match(/ahead (\d+)/);
                const behindMatch = tracking.match(/behind (\d+)/);
                ahead = aheadMatch ? parseInt(aheadMatch[1], 10) : 0;
                behind = behindMatch ? parseInt(behindMatch[1], 10) : 0;
            }

            branches.push({
                name,
                current: name === currentBranch,
                remote: upstream || null,
                lastCommit: commit,
                ahead,
                behind
            });
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'list',
                current: currentBranch,
                branches
            }
        });
    }

    private async createBranch(cwd: string, name: string, base?: string, track?: boolean): Promise<ToolResult> {
        const args = ['checkout', '-b', name];
        if (base) {
            args.push(base);
        }
        if (track) {
            args.push('--track');
        }

        await this.execGit(args, cwd);
        const commit = await this.execGit(['rev-parse', '--short', 'HEAD'], cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'create',
                branch: name,
                base: base || 'HEAD',
                commit: commit.trim(),
                checkedOut: true
            }
        });
    }

    private async deleteBranch(cwd: string, name: string, force: boolean): Promise<ToolResult> {
        const args = ['branch', force ? '-D' : '-d', name];
        await this.execGit(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'delete',
                branch: name,
                force
            }
        });
    }

    private async checkoutBranch(cwd: string, name: string): Promise<ToolResult> {
        await this.execGit(['checkout', name], cwd);
        const commit = await this.execGit(['rev-parse', '--short', 'HEAD'], cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'checkout',
                branch: name,
                commit: commit.trim()
            }
        });
    }

    private async mergeBranch(cwd: string, name: string): Promise<ToolResult> {
        const currentBranch = (await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim();

        try {
            const output = await this.execGit(['merge', name], cwd);
            const commit = await this.execGit(['rev-parse', '--short', 'HEAD'], cwd);

            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'merge',
                    branch: name,
                    into: currentBranch,
                    commit: commit.trim(),
                    conflicts: []
                }
            });
        } catch (error) {
            // Check for merge conflicts
            const status = await this.execGit(['status', '--porcelain'], cwd);
            const conflicts = status.split('\n')
                .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
                .map(l => l.substring(3));

            if (conflicts.length > 0) {
                return this.createSuccessResult({
                    success: false,
                    data: {
                        action: 'merge',
                        branch: name,
                        into: currentBranch,
                        conflicts,
                        message: 'Merge conflicts detected. Resolve conflicts and commit.'
                    }
                });
            }
            throw error;
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
