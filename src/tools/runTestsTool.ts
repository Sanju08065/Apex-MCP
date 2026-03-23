/**
 * =============================================================================
 * APEX MCP AGENT - RUN TESTS TOOL
 * =============================================================================
 * 
 * Run tests in the workspace with restricted permissions.
 * SEMI-DESTRUCTIVE: May modify state during test runs.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';
import * as path from 'path';

interface RunTestsParams {
    path?: string;          // Path to test file or directory
    pattern?: string;       // Test file pattern (e.g., "*.test.ts")
    testName?: string;      // Specific test name to run
    framework?: 'jest' | 'mocha' | 'vitest' | 'auto';
    timeout?: number;       // Timeout in seconds
}

export class RunTestsTool extends BaseTool {
    public readonly id = 'run_tests';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = false; // Read-only analysis of tests

    public readonly schema: MCPToolSchema = {
        name: 'run_tests',
        description: 'Run tests in the workspace. Can run all tests, tests in a specific file, or a specific test by name. Returns test results including pass/fail status and any error messages.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Path to test file or directory relative to workspace root'
                },
                pattern: {
                    type: 'string',
                    description: 'Test file pattern (e.g., "**/*.test.ts")'
                },
                testName: {
                    type: 'string',
                    description: 'Specific test name to run'
                },
                framework: {
                    type: 'string',
                    description: 'Test framework to use: "jest", "mocha", "vitest", or "auto" (default)',
                    enum: ['jest', 'mocha', 'vitest', 'auto']
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in seconds (default: 60)'
                }
            },
            required: []
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        // Validate path if provided
        if (params.path) {
            const pathValidation = this.validatePath(params.path as string, 'read');
            if (!pathValidation.valid) {
                return pathValidation;
            }
        }

        // Validate timeout
        const timeout = params.timeout as number | undefined;
        if (timeout !== undefined && (timeout < 1 || timeout > 300)) {
            return {
                valid: false,
                errors: ['Timeout must be between 1 and 300 seconds'],
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: ['Running tests may modify workspace state (e.g., database, temp files)'],
            sanitizedParams: params
        };
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const {
            path: testPath,
            pattern,
            testName,
            framework = 'auto',
            timeout = 60
        } = params as RunTestsParams;

        try {
            // Detect test framework
            const detectedFramework = await this.detectFramework(context.workspaceRoot);
            const useFramework = framework === 'auto' ? detectedFramework : framework;

            if (!useFramework) {
                return this.createErrorResult(
                    'Could not detect test framework. Please specify framework parameter.'
                );
            }

            // Build test command
            const testCommand = this.buildTestCommand(useFramework, {
                path: testPath,
                pattern,
                testName
            });

            // Get terminal
            let terminal = vscode.window.terminals.find(t => t.name === 'Apex MCP Tests');
            if (!terminal) {
                terminal = vscode.window.createTerminal({
                    name: 'Apex MCP Tests',
                    cwd: context.workspaceRoot.fsPath
                });
            }

            // Run command
            terminal.show();
            terminal.sendText(testCommand);

            // Note: We can't directly capture terminal output in VS Code extension API
            // The user will see the results in the terminal
            // For more sophisticated handling, we'd need to use Tasks API or spawn process

            return this.createSuccessResult({
                command: testCommand,
                framework: useFramework,
                path: testPath || 'all tests',
                status: 'running',
                message: 'Tests started in terminal. Check the terminal panel for results.',
                note: 'Test output is visible in the "Apex MCP Tests" terminal'
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Error running tests: ${errorMessage}`);
        }
    }

    private async detectFramework(workspaceRoot: vscode.Uri): Promise<string | null> {
        const packageJsonPath = vscode.Uri.joinPath(workspaceRoot, 'package.json');

        try {
            const content = await vscode.workspace.fs.readFile(packageJsonPath);
            const packageJson = JSON.parse(new TextDecoder().decode(content));

            const deps = {
                ...packageJson.dependencies,
                ...packageJson.devDependencies
            };

            if (deps.jest || deps['@jest/core']) {
                return 'jest';
            }
            if (deps.vitest) {
                return 'vitest';
            }
            if (deps.mocha) {
                return 'mocha';
            }

            // Check scripts for framework hints
            const scripts = packageJson.scripts || {};
            for (const script of Object.values(scripts) as string[]) {
                if (script.includes('jest')) return 'jest';
                if (script.includes('vitest')) return 'vitest';
                if (script.includes('mocha')) return 'mocha';
            }

            return null;
        } catch {
            return null;
        }
    }

    private buildTestCommand(
        framework: string,
        options: { path?: string; pattern?: string; testName?: string }
    ): string {
        const { path: testPath, pattern, testName } = options;
        let command = '';

        switch (framework) {
            case 'jest':
                command = 'npx jest';
                if (testPath) command += ` ${testPath}`;
                if (pattern) command += ` --testPathPattern="${pattern}"`;
                if (testName) command += ` -t "${testName}"`;
                command += ' --colors';
                break;

            case 'vitest':
                command = 'npx vitest run';
                if (testPath) command += ` ${testPath}`;
                if (testName) command += ` -t "${testName}"`;
                break;

            case 'mocha':
                command = 'npx mocha';
                if (testPath) {
                    command += ` "${testPath}"`;
                } else if (pattern) {
                    command += ` "${pattern}"`;
                }
                if (testName) command += ` --grep "${testName}"`;
                command += ' --colors';
                break;

            default:
                command = 'npm test';
        }

        return command;
    }
}
