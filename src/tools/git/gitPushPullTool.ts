/**
 * =============================================================================
 * APEX MCP AGENT - GIT PUSH/PULL TOOL
 * =============================================================================
 * 
 * Sync with remote repositories.
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

export class GitPushTool extends BaseTool {
    public readonly id = 'git_push';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'git_push',
        description: 'Push commits to remote repository',
        inputSchema: {
            type: 'object',
            properties: {
                remote: {
                    type: 'string',
                    description: 'Remote name (default: origin)'
                },
                branch: {
                    type: 'string',
                    description: 'Branch name (default: current branch)'
                },
                force: {
                    type: 'boolean',
                    description: 'Force push (default: false)'
                },
                setUpstream: {
                    type: 'boolean',
                    description: 'Set upstream tracking (default: false)'
                },
                tags: {
                    type: 'boolean',
                    description: 'Push tags (default: false)'
                },
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
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

            const remote = params.remote as string || 'origin';
            let branch = params.branch as string | undefined;
            const force = params.force as boolean || false;
            const setUpstream = params.setUpstream as boolean || false;
            const tags = params.tags as boolean || false;

            // Get current branch if not specified
            if (!branch) {
                branch = (await this.execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath)).trim();
            }

            // Count commits to push
            let commitsToPush = 0;
            try {
                const countOutput = await this.execGit(['rev-list', '--count', `${remote}/${branch}..HEAD`], workspacePath);
                commitsToPush = parseInt(countOutput.trim(), 10);
            } catch {
                // New branch, no remote tracking yet
                const countOutput = await this.execGit(['rev-list', '--count', 'HEAD'], workspacePath);
                commitsToPush = parseInt(countOutput.trim(), 10);
            }

            // Build push command
            const args = ['push'];

            if (force) {
                args.push('--force');
            }
            if (setUpstream) {
                args.push('--set-upstream');
            }
            if (tags) {
                args.push('--tags');
            }

            args.push(remote, branch);

            await this.execGit(args, workspacePath);

            return this.createSuccessResult({
                success: true,
                data: {
                    remote,
                    branch,
                    pushed: true,
                    commits: commitsToPush,
                    upstreamSet: setUpstream,
                    force,
                    tags
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git push failed: ${message}`);
        }
    }

    private execGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`git ${args.join(' ')}`, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
}

export class GitPullTool extends BaseTool {
    public readonly id = 'git_pull';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'git_pull',
        description: 'Fetch and merge from remote repository',
        inputSchema: {
            type: 'object',
            properties: {
                remote: {
                    type: 'string',
                    description: 'Remote name (default: origin)'
                },
                branch: {
                    type: 'string',
                    description: 'Branch name (optional)'
                },
                rebase: {
                    type: 'boolean',
                    description: 'Use rebase instead of merge (default: false)'
                },
                strategy: {
                    type: 'string',
                    description: 'Merge strategy: ours, theirs, recursive'
                },
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
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

            const remote = params.remote as string || 'origin';
            const branch = params.branch as string | undefined;
            const rebase = params.rebase as boolean || false;
            const strategy = params.strategy as string | undefined;

            // Get current state before pull
            const beforeHash = (await this.execGit(['rev-parse', 'HEAD'], workspacePath)).trim();

            // Build pull command
            const args = ['pull'];

            if (rebase) {
                args.push('--rebase');
            }
            if (strategy) {
                args.push('-X', strategy);
            }

            args.push(remote);
            if (branch) {
                args.push(branch);
            }

            try {
                const output = await this.execGit(args, workspacePath);

                // Get new state
                const afterHash = (await this.execGit(['rev-parse', 'HEAD'], workspacePath)).trim();

                // Calculate changes
                let filesChanged = 0;
                let insertions = 0;
                let deletions = 0;

                if (beforeHash !== afterHash) {
                    const diffStat = await this.execGit(['diff', '--stat', beforeHash, afterHash], workspacePath);
                    const statsMatch = diffStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
                    if (statsMatch) {
                        filesChanged = parseInt(statsMatch[1], 10);
                        insertions = statsMatch[2] ? parseInt(statsMatch[2], 10) : 0;
                        deletions = statsMatch[3] ? parseInt(statsMatch[3], 10) : 0;
                    }
                }

                return this.createSuccessResult({
                    success: true,
                    data: {
                        updated: beforeHash !== afterHash,
                        strategy: rebase ? 'rebase' : 'merge',
                        filesChanged,
                        insertions,
                        deletions,
                        conflicts: []
                    }
                });

            } catch (error) {
                // Check for merge conflicts
                const status = await this.execGit(['status', '--porcelain'], workspacePath);
                const conflicts = status.split('\n')
                    .filter(l => l.startsWith('UU') || l.startsWith('AA') || l.startsWith('DD'))
                    .map(l => l.substring(3));

                if (conflicts.length > 0) {
                    return this.createSuccessResult({
                        success: false,
                        data: {
                            updated: false,
                            strategy: rebase ? 'rebase' : 'merge',
                            filesChanged: 0,
                            insertions: 0,
                            deletions: 0,
                            conflicts,
                            message: 'Pull resulted in conflicts. Resolve and commit.'
                        }
                    });
                }
                throw error;
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git pull failed: ${message}`);
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
