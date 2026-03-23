/**
 * =============================================================================
 * APEX MCP AGENT - GIT COMMIT TOOL
 * =============================================================================
 * 
 * Create commits with validation.
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

export class GitCommitTool extends BaseTool {
    public readonly id = 'git_commit';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'git_commit',
        description: 'Create a git commit with the specified message. Can stage specific files or all changes.',
        inputSchema: {
            type: 'object',
            properties: {
                message: {
                    type: 'string',
                    description: 'Commit message (required)'
                },
                files: {
                    type: 'array',
                    description: 'Files to stage (all if empty)'
                },
                amend: {
                    type: 'boolean',
                    description: 'Amend the last commit (default: false)'
                },
                author: {
                    type: 'string',
                    description: 'Author in format "Name <email>"'
                },
                allowEmpty: {
                    type: 'boolean',
                    description: 'Allow empty commit (default: false)'
                },
                path: {
                    type: 'string',
                    description: 'Repository path (defaults to workspace root)'
                }
            },
            required: ['message']
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

            const message = params.message as string;
            const files = params.files as string[] | undefined;
            const amend = params.amend as boolean || false;
            const author = params.author as string | undefined;
            const allowEmpty = params.allowEmpty as boolean || false;

            if (!message && !amend) {
                return this.createErrorResult('Commit message is required');
            }

            // Stage files
            if (files && files.length > 0) {
                await this.execGit(['add', ...files], workspacePath);
            } else if (!amend) {
                // Stage all changes if no specific files
                await this.execGit(['add', '-A'], workspacePath);
            }

            // Build commit command
            const commitArgs = ['commit'];

            if (amend) {
                commitArgs.push('--amend');
            }

            if (message) {
                commitArgs.push('-m', message);
            }

            if (author) {
                commitArgs.push('--author', author);
            }

            if (allowEmpty) {
                commitArgs.push('--allow-empty');
            }

            // Execute commit
            const commitOutput = await this.execGit(commitArgs, workspacePath);

            // Get commit details
            const hash = await this.execGit(['rev-parse', 'HEAD'], workspacePath);
            const shortHash = await this.execGit(['rev-parse', '--short', 'HEAD'], workspacePath);
            const showOutput = await this.execGit(['show', '--stat', '--format=%an <%ae>|%ai', 'HEAD'], workspacePath);

            const showLines = showOutput.split('\n');
            const authorInfo = showLines[0];
            const [authorName, timestamp] = authorInfo.split('|');

            // Parse stats
            const statsMatch = commitOutput.match(/(\d+) file[s]? changed(?:, (\d+) insertion[s]?\(\+\))?(?:, (\d+) deletion[s]?\(-\))?/);
            const filesChanged = statsMatch ? parseInt(statsMatch[1], 10) : 0;
            const insertions = statsMatch && statsMatch[2] ? parseInt(statsMatch[2], 10) : 0;
            const deletions = statsMatch && statsMatch[3] ? parseInt(statsMatch[3], 10) : 0;

            const result = {
                success: true,
                data: {
                    hash: hash.trim(),
                    shortHash: shortHash.trim(),
                    message,
                    author: authorName,
                    timestamp: timestamp?.trim(),
                    filesChanged,
                    insertions,
                    deletions,
                    amended: amend
                }
            };

            return this.createSuccessResult(result);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Git commit failed: ${message}`);
        }
    }

    private execGit(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            // Properly escape arguments
            const escapedArgs = args.map(arg => {
                if (arg.includes(' ') || arg.includes('"')) {
                    return `"${arg.replace(/"/g, '\\"')}"`;
                }
                return arg;
            });

            cp.exec(`git ${escapedArgs.join(' ')}`, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
