/**
 * =============================================================================
 * APEX MCP AGENT - NPM TOOL
 * =============================================================================
 * 
 * Comprehensive npm package manager operations.
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

export class NpmTool extends BaseTool {
    public readonly id = 'npm_tool';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'npm_tool',
        description: 'NPM package manager: install, uninstall, update, list, audit, init, run scripts, and more',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Action: install, uninstall, update, list, audit, init, run, outdated, info'
                },
                packages: {
                    type: 'array',
                    description: 'Package names to install/uninstall/update'
                },
                path: {
                    type: 'string',
                    description: 'Project path (defaults to workspace root)'
                },
                global: {
                    type: 'boolean',
                    description: 'Global install (default: false)'
                },
                dev: {
                    type: 'boolean',
                    description: 'Install as devDependency'
                },
                exact: {
                    type: 'boolean',
                    description: 'Install exact version'
                },
                force: {
                    type: 'boolean',
                    description: 'Force operation'
                },
                script: {
                    type: 'string',
                    description: 'Script name for "run" action'
                },
                fix: {
                    type: 'boolean',
                    description: 'Auto-fix vulnerabilities (for audit)'
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
            const isGlobal = params.global as boolean || false;
            const isDev = params.dev as boolean || false;
            const isExact = params.exact as boolean || false;
            const force = params.force as boolean || false;
            const script = params.script as string;
            const fix = params.fix as boolean || false;

            switch (action) {
                case 'install':
                    return await this.install(workspacePath, packages, { isGlobal, isDev, isExact, force });
                case 'uninstall':
                    return await this.uninstall(workspacePath, packages, isGlobal);
                case 'update':
                    return await this.update(workspacePath, packages);
                case 'list':
                    return await this.list(workspacePath, isGlobal);
                case 'audit':
                    return await this.audit(workspacePath, fix);
                case 'init':
                    return await this.init(workspacePath);
                case 'run':
                    return await this.runScript(workspacePath, script);
                case 'outdated':
                    return await this.outdated(workspacePath);
                case 'info':
                    return await this.info(packages[0]);
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`npm operation failed: ${message}`);
        }
    }

    private async install(
        cwd: string,
        packages: string[],
        options: { isGlobal: boolean; isDev: boolean; isExact: boolean; force: boolean }
    ): Promise<ToolResult> {
        const args = ['install', '--json'];

        if (options.isGlobal) args.push('-g');
        if (options.isDev) args.push('--save-dev');
        if (options.isExact) args.push('--save-exact');
        if (options.force) args.push('--force');

        args.push(...packages);

        const output = await this.execNpm(args, cwd);

        // Parse installed packages
        let installed: any[] = [];
        try {
            const json = JSON.parse(output);
            installed = Object.entries(json.added || {}).map(([name, info]: [string, any]) => ({
                name,
                version: info.version,
                installed: true
            }));
        } catch {
            // Fallback to simple success message
        }

        // Read package.json to get installed versions
        if (installed.length === 0 && packages.length > 0) {
            const packageJsonPath = path.join(cwd, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
                installed = packages.map(p => {
                    const name = p.split('@')[0] || p;
                    return {
                        name,
                        version: deps[name] || 'installed',
                        installed: true
                    };
                });
            }
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'install',
                packages: installed.length > 0 ? installed : packages.map(p => ({ name: p, installed: true })),
                global: options.isGlobal,
                dev: options.isDev
            }
        });
    }

    private async uninstall(cwd: string, packages: string[], isGlobal: boolean): Promise<ToolResult> {
        const args = ['uninstall'];
        if (isGlobal) args.push('-g');
        args.push(...packages);

        await this.execNpm(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'uninstall',
                packages: packages.map(p => ({ name: p, removed: true })),
                global: isGlobal
            }
        });
    }

    private async update(cwd: string, packages: string[]): Promise<ToolResult> {
        const args = ['update', ...packages];
        await this.execNpm(args, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'update',
                packages: packages.length > 0 ? packages : ['all']
            }
        });
    }

    private async list(cwd: string, isGlobal: boolean): Promise<ToolResult> {
        const args = ['list', '--json', '--depth=0'];
        if (isGlobal) args.push('-g');

        const output = await this.execNpm(args, cwd);
        const json = JSON.parse(output);

        const dependencies: any[] = [];
        for (const [name, info] of Object.entries(json.dependencies || {})) {
            dependencies.push({
                name,
                version: (info as any).version,
                resolved: (info as any).resolved
            });
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'list',
                name: json.name,
                version: json.version,
                dependencies,
                count: dependencies.length
            }
        });
    }

    private async audit(cwd: string, fix: boolean): Promise<ToolResult> {
        const args = ['audit', '--json'];
        if (fix) args.push('fix');

        let output: string;
        try {
            output = await this.execNpm(args, cwd);
        } catch (error) {
            // Audit returns non-zero if vulnerabilities found
            output = error instanceof Error ? error.message : String(error);
            // Try to extract JSON from error output
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                output = jsonMatch[0];
            }
        }

        try {
            const json = JSON.parse(output);
            const vulnerabilities: any[] = [];

            for (const [name, vuln] of Object.entries(json.vulnerabilities || {})) {
                const v = vuln as any;
                vulnerabilities.push({
                    package: name,
                    severity: v.severity,
                    via: v.via,
                    fixAvailable: v.fixAvailable,
                    range: v.range
                });
            }

            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'audit',
                    vulnerabilities,
                    summary: json.metadata?.vulnerabilities || {
                        total: vulnerabilities.length
                    },
                    fixed: fix
                }
            });
        } catch {
            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'audit',
                    message: 'No vulnerabilities found'
                }
            });
        }
    }

    private async init(cwd: string): Promise<ToolResult> {
        await this.execNpm(['init', '-y'], cwd);

        const packageJsonPath = path.join(cwd, 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'init',
                packageJson
            }
        });
    }

    private async runScript(cwd: string, script: string): Promise<ToolResult> {
        if (!script) {
            // List available scripts
            const packageJsonPath = path.join(cwd, 'package.json');
            if (!fs.existsSync(packageJsonPath)) {
                return this.createErrorResult('No package.json found');
            }
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'run',
                    availableScripts: Object.keys(packageJson.scripts || {})
                }
            });
        }

        const output = await this.execNpm(['run', script], cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'run',
                script,
                output: output.substring(0, 5000) // Limit output
            }
        });
    }

    private async outdated(cwd: string): Promise<ToolResult> {
        let output: string;
        try {
            output = await this.execNpm(['outdated', '--json'], cwd);
        } catch (error) {
            // npm outdated exits with non-zero if outdated packages found
            output = error instanceof Error ? error.message : String(error);
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                output = jsonMatch[0];
            }
        }

        try {
            const json = JSON.parse(output);
            const packages = Object.entries(json).map(([name, info]: [string, any]) => ({
                name,
                current: info.current,
                wanted: info.wanted,
                latest: info.latest,
                type: info.type
            }));

            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'outdated',
                    packages,
                    count: packages.length
                }
            });
        } catch {
            return this.createSuccessResult({
                success: true,
                data: {
                    action: 'outdated',
                    packages: [],
                    message: 'All packages are up to date'
                }
            });
        }
    }

    private async info(packageName: string): Promise<ToolResult> {
        if (!packageName) {
            return this.createErrorResult('Package name is required for info');
        }

        const output = await this.execNpm(['info', packageName, '--json'], process.cwd());
        const json = JSON.parse(output);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'info',
                name: json.name,
                version: json.version,
                description: json.description,
                author: json.author,
                license: json.license,
                homepage: json.homepage,
                repository: json.repository,
                dependencies: Object.keys(json.dependencies || {}),
                keywords: json.keywords
            }
        });
    }

    private execNpm(args: string[], cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(`npm ${args.join(' ')}`, {
                cwd,
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                timeout: 300000 // 5 minute timeout
            }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(new Error(stderr || stdout || error.message));
                } else {
                    resolve(stdout || stderr);
                }
            });
        });
    }
}
