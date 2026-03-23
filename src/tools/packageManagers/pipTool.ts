/**
 * =============================================================================
 * APEX MCP AGENT - PIP TOOL
 * =============================================================================
 * 
 * Python package manager operations.
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
import * as fs from 'fs';
import * as path from 'path';

export class PipTool extends BaseTool {
    public readonly id = 'pip_tool';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'pip_tool',
        description: 'Python pip package manager: install, uninstall, list, freeze, show, check packages',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Action: install, uninstall, list, freeze, show, check, search'
                },
                packages: {
                    type: 'array',
                    description: 'Package names'
                },
                path: {
                    type: 'string',
                    description: 'Project path (defaults to workspace root)'
                },
                upgrade: {
                    type: 'boolean',
                    description: 'Upgrade packages'
                },
                requirements: {
                    type: 'string',
                    description: 'Path to requirements.txt'
                },
                editable: {
                    type: 'boolean',
                    description: 'Install in editable mode'
                },
                user: {
                    type: 'boolean',
                    description: 'Install to user site-packages'
                },
                venv: {
                    type: 'string',
                    description: 'Virtual environment path'
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
            const packages = params.packages as string[] || [];
            const upgrade = params.upgrade as boolean || false;
            const requirements = params.requirements as string;
            const editable = params.editable as boolean || false;
            const user = params.user as boolean || false;
            const venv = params.venv as string;

            // Build pip command
            let pipCmd = 'pip';
            if (venv) {
                const venvPip = path.join(venv, process.platform === 'win32' ? 'Scripts/pip' : 'bin/pip');
                if (fs.existsSync(venvPip) || fs.existsSync(venvPip + '.exe')) {
                    pipCmd = venvPip;
                }
            }

            switch (action) {
                case 'install':
                    return await this.install(workspacePath, pipCmd, packages, { upgrade, requirements, editable, user });
                case 'uninstall':
                    return await this.uninstall(workspacePath, pipCmd, packages);
                case 'list':
                    return await this.list(workspacePath, pipCmd);
                case 'freeze':
                    return await this.freeze(workspacePath, pipCmd);
                case 'show':
                    return await this.show(workspacePath, pipCmd, packages);
                case 'check':
                    return await this.check(workspacePath, pipCmd);
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`pip operation failed: ${message}`);
        }
    }

    private async install(
        cwd: string,
        pipCmd: string,
        packages: string[],
        options: { upgrade: boolean; requirements: string; editable: boolean; user: boolean }
    ): Promise<ToolResult> {
        const args = ['install'];

        if (options.upgrade) args.push('--upgrade');
        if (options.user) args.push('--user');
        if (options.editable) args.push('-e');

        if (options.requirements) {
            args.push('-r', options.requirements);
        } else {
            args.push(...packages);
        }

        const output = await this.execPip(pipCmd, args, cwd);

        // Parse installed packages from output
        const installed: any[] = [];
        const lines = output.split('\n');
        for (const line of lines) {
            const match = line.match(/Successfully installed (.+)/);
            if (match) {
                const pkgs = match[1].split(' ');
                for (const pkg of pkgs) {
                    const [name, version] = pkg.split('-');
                    installed.push({ name, version, installed: true });
                }
            }
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'install',
                packages: installed.length > 0 ? installed : packages.map(p => ({ name: p, installed: true }))
            }
        });
    }

    private async uninstall(cwd: string, pipCmd: string, packages: string[]): Promise<ToolResult> {
        const args = ['uninstall', '-y', ...packages];
        await this.execPip(pipCmd, args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'uninstall',
                packages: packages.map(p => ({ name: p, removed: true }))
            }
        });
    }

    private async list(cwd: string, pipCmd: string): Promise<ToolResult> {
        const output = await this.execPip(pipCmd, ['list', '--format=json'], cwd);
        const packages = JSON.parse(output);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'list',
                packages,
                count: packages.length
            }
        });
    }

    private async freeze(cwd: string, pipCmd: string): Promise<ToolResult> {
        const output = await this.execPip(pipCmd, ['freeze'], cwd);
        const packages = output.split('\n')
            .filter(l => l.trim())
            .map(l => {
                const [name, version] = l.split('==');
                return { name, version };
            });

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'freeze',
                packages,
                requirements: output
            }
        });
    }

    private async show(cwd: string, pipCmd: string, packages: string[]): Promise<ToolResult> {
        const results: any[] = [];

        for (const pkg of packages) {
            const output = await this.execPip(pipCmd, ['show', pkg], cwd);
            const info: any = {};

            for (const line of output.split('\n')) {
                const [key, ...valueParts] = line.split(':');
                if (key && valueParts.length > 0) {
                    info[key.trim().toLowerCase().replace(/-/g, '_')] = valueParts.join(':').trim();
                }
            }

            results.push(info);
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'show',
                packages: results
            }
        });
    }

    private async check(cwd: string, pipCmd: string): Promise<ToolResult> {
        let output: string;
        let hasIssues = false;

        try {
            output = await this.execPip(pipCmd, ['check'], cwd);
        } catch (error) {
            output = error instanceof Error ? error.message : String(error);
            hasIssues = true;
        }

        const issues: any[] = [];
        const lines = output.split('\n').filter(l => l.trim());

        for (const line of lines) {
            if (line.includes('has requirement') || line.includes('requires')) {
                issues.push({
                    message: line,
                    type: 'dependency_conflict'
                });
            }
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'check',
                valid: !hasIssues && issues.length === 0,
                issues
            }
        });
    }

    private execPip(pipCmd: string, args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`${pipCmd} ${args.join(' ')}`, {
                cwd,
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024
            }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
}
