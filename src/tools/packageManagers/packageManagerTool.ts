/**
 * =============================================================================
 * APEX MCP AGENT - UNIVERSAL PACKAGE MANAGER TOOL
 * =============================================================================
 * 
 * Auto-detect and use appropriate package manager.
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

type PackageManagerType = 'npm' | 'yarn' | 'pnpm' | 'pip' | 'cargo' | 'composer' | 'maven' | 'gradle' | 'bundler' | 'nuget' | 'unknown';

interface DetectionResult {
    manager: PackageManagerType;
    lockFile?: string;
    configFile: string;
    version?: string;
}

export class PackageManagerTool extends BaseTool {
    public readonly id = 'package_manager';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'package_manager',
        description: 'Auto-detect and use appropriate package manager for any project type',
        inputSchema: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    description: 'Action: detect, install, update, list, add, remove'
                },
                packages: {
                    type: 'array',
                    description: 'Package names (for add/remove)'
                },
                path: {
                    type: 'string',
                    description: 'Project path (defaults to workspace root)'
                },
                dev: {
                    type: 'boolean',
                    description: 'Add as dev dependency'
                }
            },
            required: ['action']
        }
    };

    private readonly detectionRules: Array<{
        manager: PackageManagerType;
        configFile: string;
        lockFiles: string[];
    }> = [
            { manager: 'npm', configFile: 'package.json', lockFiles: ['package-lock.json', 'npm-shrinkwrap.json'] },
            { manager: 'yarn', configFile: 'package.json', lockFiles: ['yarn.lock'] },
            { manager: 'pnpm', configFile: 'package.json', lockFiles: ['pnpm-lock.yaml'] },
            { manager: 'pip', configFile: 'requirements.txt', lockFiles: [] },
            { manager: 'pip', configFile: 'pyproject.toml', lockFiles: ['poetry.lock', 'Pipfile.lock'] },
            { manager: 'cargo', configFile: 'Cargo.toml', lockFiles: ['Cargo.lock'] },
            { manager: 'composer', configFile: 'composer.json', lockFiles: ['composer.lock'] },
            { manager: 'maven', configFile: 'pom.xml', lockFiles: [] },
            { manager: 'gradle', configFile: 'build.gradle', lockFiles: ['gradle.lockfile'] },
            { manager: 'gradle', configFile: 'build.gradle.kts', lockFiles: ['gradle.lockfile'] },
            { manager: 'bundler', configFile: 'Gemfile', lockFiles: ['Gemfile.lock'] },
            { manager: 'nuget', configFile: '*.csproj', lockFiles: ['packages.lock.json'] }
        ];

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
            const isDev = params.dev as boolean || false;

            // Always detect first
            const detection = await this.detectPackageManager(workspacePath);

            switch (action) {
                case 'detect':
                    return this.createSuccessResult({
                        success: true,
                        data: detection
                    });
                case 'install':
                    return await this.install(workspacePath, detection);
                case 'add':
                    return await this.add(workspacePath, detection, packages, isDev);
                case 'remove':
                    return await this.remove(workspacePath, detection, packages);
                case 'update':
                    return await this.update(workspacePath, detection, packages);
                case 'list':
                    return await this.list(workspacePath, detection);
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Package manager operation failed: ${message}`);
        }
    }

    private async detectPackageManager(cwd: string): Promise<DetectionResult> {
        // Check for lock files first (more specific)
        for (const rule of this.detectionRules) {
            for (const lockFile of rule.lockFiles) {
                const lockPath = path.join(cwd, lockFile);
                if (fs.existsSync(lockPath)) {
                    return {
                        manager: rule.manager,
                        lockFile,
                        configFile: rule.configFile
                    };
                }
            }
        }

        // Fall back to config file detection
        for (const rule of this.detectionRules) {
            if (rule.configFile.includes('*')) {
                // Glob pattern - check for any matching file
                const files = fs.readdirSync(cwd);
                const pattern = rule.configFile.replace('*', '');
                const match = files.find(f => f.endsWith(pattern));
                if (match) {
                    return {
                        manager: rule.manager,
                        configFile: match
                    };
                }
            } else {
                const configPath = path.join(cwd, rule.configFile);
                if (fs.existsSync(configPath)) {
                    return {
                        manager: rule.manager,
                        configFile: rule.configFile
                    };
                }
            }
        }

        return {
            manager: 'unknown',
            configFile: 'none'
        };
    }

    private async install(cwd: string, detection: DetectionResult): Promise<ToolResult> {
        const commands: Record<PackageManagerType, string> = {
            npm: 'npm install',
            yarn: 'yarn install',
            pnpm: 'pnpm install',
            pip: 'pip install -r requirements.txt',
            cargo: 'cargo build',
            composer: 'composer install',
            maven: 'mvn install',
            gradle: 'gradle build',
            bundler: 'bundle install',
            nuget: 'dotnet restore',
            unknown: ''
        };

        const cmd = commands[detection.manager];
        if (!cmd) {
            return this.createErrorResult(`Cannot determine install command for: ${detection.manager}`);
        }

        const output = await this.exec(cmd, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'install',
                detectedManager: detection.manager,
                command: cmd,
                output: output.substring(0, 3000)
            }
        });
    }

    private async add(cwd: string, detection: DetectionResult, packages: string[], isDev: boolean): Promise<ToolResult> {
        const commands: Record<PackageManagerType, (pkgs: string[], dev: boolean) => string> = {
            npm: (pkgs, dev) => `npm install ${dev ? '--save-dev' : ''} ${pkgs.join(' ')}`,
            yarn: (pkgs, dev) => `yarn add ${dev ? '--dev' : ''} ${pkgs.join(' ')}`,
            pnpm: (pkgs, dev) => `pnpm add ${dev ? '-D' : ''} ${pkgs.join(' ')}`,
            pip: (pkgs) => `pip install ${pkgs.join(' ')}`,
            cargo: (pkgs) => pkgs.map(p => `cargo add ${p}`).join(' && '),
            composer: (pkgs, dev) => `composer require ${dev ? '--dev' : ''} ${pkgs.join(' ')}`,
            maven: () => 'echo "Use pom.xml to add dependencies"',
            gradle: () => 'echo "Use build.gradle to add dependencies"',
            bundler: (pkgs) => pkgs.map(p => `bundle add ${p}`).join(' && '),
            nuget: (pkgs) => pkgs.map(p => `dotnet add package ${p}`).join(' && '),
            unknown: () => ''
        };

        const cmdFn = commands[detection.manager];
        if (!cmdFn) {
            return this.createErrorResult(`Cannot determine add command for: ${detection.manager}`);
        }

        const cmd = cmdFn(packages, isDev);
        const output = await this.exec(cmd, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'add',
                detectedManager: detection.manager,
                packages,
                isDev,
                output: output.substring(0, 3000)
            }
        });
    }

    private async remove(cwd: string, detection: DetectionResult, packages: string[]): Promise<ToolResult> {
        const commands: Record<PackageManagerType, (pkgs: string[]) => string> = {
            npm: (pkgs) => `npm uninstall ${pkgs.join(' ')}`,
            yarn: (pkgs) => `yarn remove ${pkgs.join(' ')}`,
            pnpm: (pkgs) => `pnpm remove ${pkgs.join(' ')}`,
            pip: (pkgs) => `pip uninstall -y ${pkgs.join(' ')}`,
            cargo: (pkgs) => pkgs.map(p => `cargo rm ${p}`).join(' && '),
            composer: (pkgs) => `composer remove ${pkgs.join(' ')}`,
            maven: () => 'echo "Edit pom.xml to remove dependencies"',
            gradle: () => 'echo "Edit build.gradle to remove dependencies"',
            bundler: (pkgs) => `bundle remove ${pkgs.join(' ')}`,
            nuget: (pkgs) => pkgs.map(p => `dotnet remove package ${p}`).join(' && '),
            unknown: () => ''
        };

        const cmdFn = commands[detection.manager];
        if (!cmdFn) {
            return this.createErrorResult(`Cannot determine remove command for: ${detection.manager}`);
        }

        const cmd = cmdFn(packages);
        const output = await this.exec(cmd, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'remove',
                detectedManager: detection.manager,
                packages,
                output: output.substring(0, 3000)
            }
        });
    }

    private async update(cwd: string, detection: DetectionResult, packages: string[]): Promise<ToolResult> {
        const commands: Record<PackageManagerType, (pkgs: string[]) => string> = {
            npm: (pkgs) => pkgs.length > 0 ? `npm update ${pkgs.join(' ')}` : 'npm update',
            yarn: (pkgs) => pkgs.length > 0 ? `yarn upgrade ${pkgs.join(' ')}` : 'yarn upgrade',
            pnpm: (pkgs) => pkgs.length > 0 ? `pnpm update ${pkgs.join(' ')}` : 'pnpm update',
            pip: (pkgs) => pkgs.length > 0 ? `pip install --upgrade ${pkgs.join(' ')}` : 'pip install --upgrade -r requirements.txt',
            cargo: () => 'cargo update',
            composer: (pkgs) => pkgs.length > 0 ? `composer update ${pkgs.join(' ')}` : 'composer update',
            maven: () => 'mvn versions:use-latest-versions',
            gradle: () => 'gradle dependencies --refresh-dependencies',
            bundler: () => 'bundle update',
            nuget: () => 'dotnet restore',
            unknown: () => ''
        };

        const cmdFn = commands[detection.manager];
        if (!cmdFn) {
            return this.createErrorResult(`Cannot determine update command for: ${detection.manager}`);
        }

        const cmd = cmdFn(packages);
        const output = await this.exec(cmd, cwd);

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'update',
                detectedManager: detection.manager,
                packages: packages.length > 0 ? packages : ['all'],
                output: output.substring(0, 3000)
            }
        });
    }

    private async list(cwd: string, detection: DetectionResult): Promise<ToolResult> {
        const commands: Record<PackageManagerType, string> = {
            npm: 'npm list --depth=0 --json',
            yarn: 'yarn list --depth=0 --json',
            pnpm: 'pnpm list --depth=0 --json',
            pip: 'pip list --format=json',
            cargo: 'cargo tree --depth=1',
            composer: 'composer show --format=json',
            maven: 'mvn dependency:list',
            gradle: 'gradle dependencies',
            bundler: 'bundle list',
            nuget: 'dotnet list package',
            unknown: ''
        };

        const cmd = commands[detection.manager];
        if (!cmd) {
            return this.createErrorResult(`Cannot determine list command for: ${detection.manager}`);
        }

        const output = await this.exec(cmd, cwd);

        let packages: any[] = [];
        try {
            if (detection.manager === 'npm' || detection.manager === 'yarn' || detection.manager === 'pnpm') {
                const json = JSON.parse(output);
                packages = Object.entries(json.dependencies || {}).map(([name, info]: [string, any]) => ({
                    name,
                    version: info.version || info
                }));
            } else if (detection.manager === 'pip') {
                packages = JSON.parse(output);
            }
        } catch {
            // Use raw output for non-JSON formats
        }

        return this.createSuccessResult({
            success: true,
            data: {
                action: 'list',
                detectedManager: detection.manager,
                packages: packages.length > 0 ? packages : undefined,
                output: packages.length === 0 ? output.substring(0, 3000) : undefined
            }
        });
    }

    private exec(command: string, cwd: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                cwd,
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 300000
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
