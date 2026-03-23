/**
 * APEX MCP AGENT - LINTER TOOL
 * Priority: P2 - MEDIUM
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult } from '../../types';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export class LinterTool extends BaseTool {
    public readonly id = 'linter';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'linter',
        description: 'Run linters: ESLint, Pylint, RuboCop, golint, rustfmt with structured output',
        inputSchema: {
            type: 'object',
            properties: {
                tool: { type: 'string', description: 'Linter: eslint, pylint, rubocop, golint, rustfmt, auto' },
                path: { type: 'string', description: 'File or directory to lint' },
                fix: { type: 'boolean', description: 'Auto-fix issues' },
                format: { type: 'string', description: 'Output format: json, stylish, compact' },
                config: { type: 'string', description: 'Path to config file' }
            },
            required: []
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            let tool = params.tool as string || 'auto';
            const targetPath = params.path as string || workspacePath;
            const fix = params.fix as boolean || false;
            const config = params.config as string;

            if (tool === 'auto') {
                tool = this.detectLinter(workspacePath);
            }

            const result = await this.runLinter(tool, targetPath, fix, config);
            return this.createSuccessResult({ success: true, data: result });
        } catch (error) {
            return this.createErrorResult(`Linter failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    private detectLinter(cwd: string): string {
        if (fs.existsSync(path.join(cwd, '.eslintrc.js')) || fs.existsSync(path.join(cwd, '.eslintrc.json'))) return 'eslint';
        if (fs.existsSync(path.join(cwd, 'package.json'))) return 'eslint';
        if (fs.existsSync(path.join(cwd, 'pylintrc')) || fs.existsSync(path.join(cwd, 'setup.py'))) return 'pylint';
        if (fs.existsSync(path.join(cwd, '.rubocop.yml'))) return 'rubocop';
        if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'golint';
        if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'rustfmt';
        return 'eslint';
    }

    private async runLinter(tool: string, targetPath: string, fix: boolean, config?: string): Promise<any> {
        let command: string;

        switch (tool) {
            case 'eslint':
                command = `npx eslint "${targetPath}" --format json ${fix ? '--fix' : ''} ${config ? `-c ${config}` : ''}`;
                break;
            case 'pylint':
                command = `pylint "${targetPath}" --output-format=json ${config ? `--rcfile=${config}` : ''}`;
                break;
            case 'rubocop':
                command = `rubocop "${targetPath}" --format json ${fix ? '-a' : ''} ${config ? `-c ${config}` : ''}`;
                break;
            case 'golint':
                command = `golangci-lint run "${targetPath}" --out-format json`;
                break;
            case 'rustfmt':
                command = `cargo clippy --message-format=json ${fix ? '--fix' : ''}`;
                break;
            default:
                throw new Error(`Unknown linter: ${tool}`);
        }

        const output = await this.exec(command, path.dirname(targetPath));
        return this.parseOutput(tool, output, fix);
    }

    private parseOutput(tool: string, output: string, fixed: boolean): any {
        const issues: any[] = [];
        let errors = 0, warnings = 0, fixable = 0;

        try {
            const json = JSON.parse(output);

            if (tool === 'eslint') {
                for (const file of json) {
                    for (const msg of file.messages || []) {
                        issues.push({
                            file: file.filePath,
                            line: msg.line,
                            column: msg.column,
                            severity: msg.severity === 2 ? 'error' : 'warning',
                            rule: msg.ruleId,
                            message: msg.message,
                            fixable: !!msg.fix
                        });
                        if (msg.severity === 2) errors++; else warnings++;
                        if (msg.fix) fixable++;
                    }
                }
            }
        } catch {
            // Parse line-based output
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.includes('error') || line.includes('warning')) {
                    issues.push({ raw: line });
                }
            }
        }

        return {
            tool,
            summary: { errors, warnings, fixable, filesAnalyzed: issues.length > 0 ? new Set(issues.map(i => i.file)).size : 0 },
            issues: issues.slice(0, 100),
            fixed
        };
    }

    private exec(command: string, cwd: string): Promise<string> {
        return new Promise((resolve) => {
            cp.exec(command, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                resolve(stdout || stderr || '');
            });
        });
    }
}
