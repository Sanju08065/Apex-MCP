/**
 * =============================================================================
 * APEX MCP AGENT - GIT LOG TOOL
 * =============================================================================
 * 
 * Retrieve commit history with filtering.
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

interface CommitInfo {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: string;
    message: string;
    body?: string;
    files?: string[];
    stats?: {
        insertions: number;
        deletions: number;
        filesChanged: number;
    };
}

export class GitLogTool extends BaseTool {
    public readonly id = 'git_log';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'git_log',
        description: 'Retrieve commit history with filtering by date, author, file, and message',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
                },
                maxCount: {
                    type: 'number',
                    description: 'Maximum commits to return (default: 20, max: 1000)'
                },
                since: {
                    type: 'string',
                    description: 'ISO date or relative (e.g., "1 week ago")'
                },
                until: {
                    type: 'string',
                    description: 'ISO date or relative'
                },
                author: {
                    type: 'string',
                    description: 'Filter by author name or email'
                },
                grep: {
                    type: 'string',
                    description: 'Search commit messages'
                },
                file: {
                    type: 'string',
                    description: 'Commits affecting specific file'
                },
                format: {
                    type: 'string',
                    description: 'Output format: oneline, full, stat (default: full)'
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

            let maxCount = params.maxCount as number || 20;
            maxCount = Math.min(maxCount, 1000); // Cap at 1000

            const since = params.since as string | undefined;
            const until = params.until as string | undefined;
            const author = params.author as string | undefined;
            const grep = params.grep as string | undefined;
            const file = params.file as string | undefined;
            const format = params.format as string || 'full';

            // Build log command with custom format
            const delimiter = '|||';
            const separator = '<<<COMMIT>>>';
            const formatString = `${separator}%H${delimiter}%h${delimiter}%an${delimiter}%ae${delimiter}%aI${delimiter}%s${delimiter}%b`;

            const args = ['log', `--format=${formatString}`, `-n${maxCount}`];

            if (since) {
                args.push(`--since="${since}"`);
            }
            if (until) {
                args.push(`--until="${until}"`);
            }
            if (author) {
                args.push(`--author=${author}`);
            }
            if (grep) {
                args.push(`--grep=${grep}`);
            }
            if (format === 'stat') {
                args.push('--stat');
            }
            if (file) {
                args.push('--', file);
            }

            const output = await this.execGit(args, workspacePath);

            // Parse commits
            const commits: CommitInfo[] = [];
            const commitStrings = output.split(separator).filter(s => s.trim());

            for (const commitStr of commitStrings) {
                const lines = commitStr.trim().split('\n');
                const firstLine = lines[0];
                const parts = firstLine.split(delimiter);

                if (parts.length >= 6) {
                    const commit: CommitInfo = {
                        hash: parts[0],
                        shortHash: parts[1],
                        author: parts[2],
                        email: parts[3],
                        date: parts[4],
                        message: parts[5],
                        body: parts[6]?.trim() || undefined
                    };

                    // Parse stats if present
                    if (format === 'stat' && lines.length > 1) {
                        const statsLine = lines[lines.length - 1];
                        const statsMatch = statsLine.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
                        if (statsMatch) {
                            commit.stats = {
                                filesChanged: parseInt(statsMatch[1], 10),
                                insertions: statsMatch[2] ? parseInt(statsMatch[2], 10) : 0,
                                deletions: statsMatch[3] ? parseInt(statsMatch[3], 10) : 0
                            };
                        }

                        // Get changed files
                        commit.files = lines.slice(1, -2)
                            .map(l => l.trim())
                            .filter(l => l && l.includes('|'))
                            .map(l => l.split('|')[0].trim());
                    }

                    commits.push(commit);
                }
            }

            // Count total if showing less than all
            let hasMore = false;
            if (commits.length === maxCount) {
                try {
                    const countOutput = await this.execGit(['rev-list', '--count', 'HEAD'], workspacePath);
                    const totalCount = parseInt(countOutput.trim(), 10);
                    hasMore = totalCount > maxCount;
                } catch {
                    // Ignore count errors
                }
            }

            return this.createSuccessResult({
                success: true,
                data: {
                    commits,
                    count: commits.length,
                    hasMore
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git log failed: ${message}`);
        }
    }

    private execGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`git ${args.join(' ')}`, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
