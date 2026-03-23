/**
 * =============================================================================
 * APEX MCP AGENT - UNIVERSAL TEST RUNNER TOOL
 * =============================================================================
 * 
 * Universal test execution with framework auto-detection.
 * Priority: P1 - HIGH
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

type TestFramework = 'jest' | 'pytest' | 'mocha' | 'vitest' | 'cargo' | 'rspec' | 'phpunit' | 'junit' | 'go' | 'unknown' | 'auto';

interface TestResult {
    name: string;
    status: 'passed' | 'failed' | 'skipped' | 'pending';
    duration?: number;
    error?: {
        message: string;
        stack?: string;
        expected?: any;
        actual?: any;
    };
}

interface TestSuite {
    file: string;
    status: 'passed' | 'failed' | 'skipped';
    tests: TestResult[];
    duration?: number;
}

export class TestRunnerTool extends BaseTool {
    public readonly id = 'test_runner';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'test_runner',
        description: 'Universal test execution with framework auto-detection. Supports Jest, pytest, Mocha, Vitest, Cargo, and more.',
        inputSchema: {
            type: 'object',
            properties: {
                framework: {
                    type: 'string',
                    description: 'Test framework: jest, pytest, mocha, vitest, cargo, rspec, phpunit, go, auto'
                },
                path: {
                    type: 'string',
                    description: 'Project or test file path'
                },
                pattern: {
                    type: 'string',
                    description: 'Test file pattern (e.g., "**/*.test.js")'
                },
                filter: {
                    type: 'string',
                    description: 'Test name filter'
                },
                watch: {
                    type: 'boolean',
                    description: 'Watch mode (default: false)'
                },
                coverage: {
                    type: 'boolean',
                    description: 'Generate coverage report'
                },
                verbose: {
                    type: 'boolean',
                    description: 'Verbose output'
                },
                bail: {
                    type: 'boolean',
                    description: 'Stop on first failure'
                },
                parallel: {
                    type: 'boolean',
                    description: 'Run tests in parallel'
                },
                timeout: {
                    type: 'number',
                    description: 'Test timeout in ms (default: 30000)'
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

            let framework = params.framework as TestFramework || 'auto';
            const pattern = params.pattern as string;
            const filter = params.filter as string;
            const watch = params.watch as boolean || false;
            const coverage = params.coverage as boolean || false;
            const verbose = params.verbose as boolean || false;
            const bail = params.bail as boolean || false;
            const parallel = params.parallel as boolean || false;
            const timeout = params.timeout as number || 30000;

            // Auto-detect framework
            if (framework === 'auto') {
                framework = await this.detectFramework(workspacePath);
            }

            // Build and execute test command
            const command = this.buildCommand(framework, {
                pattern, filter, watch, coverage, verbose, bail, parallel, timeout
            });

            const startTime = Date.now();
            let output: string;
            let exitCode = 0;

            try {
                output = await this.exec(command, workspacePath, timeout + 60000);
            } catch (error: any) {
                output = error.message || String(error);
                exitCode = 1;
            }

            const duration = Date.now() - startTime;

            // Parse results
            const results = this.parseResults(framework, output);

            return this.createSuccessResult({
                success: true,
                data: {
                    framework,
                    command,
                    summary: {
                        total: results.total,
                        passed: results.passed,
                        failed: results.failed,
                        skipped: results.skipped,
                        duration: `${(duration / 1000).toFixed(2)}s`
                    },
                    suites: results.suites,
                    coverage: coverage ? results.coverage : undefined,
                    exitCode
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Test runner failed: ${message}`);
        }
    }

    private async detectFramework(cwd: string): Promise<TestFramework> {
        // Check package.json
        const packageJsonPath = path.join(cwd, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            if (deps.vitest) return 'vitest';
            if (deps.jest) return 'jest';
            if (deps.mocha) return 'mocha';
        }

        // Check for framework-specific files
        if (fs.existsSync(path.join(cwd, 'jest.config.js')) ||
            fs.existsSync(path.join(cwd, 'jest.config.ts'))) return 'jest';
        if (fs.existsSync(path.join(cwd, 'vitest.config.ts')) ||
            fs.existsSync(path.join(cwd, 'vitest.config.js'))) return 'vitest';
        if (fs.existsSync(path.join(cwd, 'pytest.ini')) ||
            fs.existsSync(path.join(cwd, 'pyproject.toml'))) return 'pytest';
        if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) return 'cargo';
        if (fs.existsSync(path.join(cwd, 'Gemfile'))) return 'rspec';
        if (fs.existsSync(path.join(cwd, 'phpunit.xml'))) return 'phpunit';
        if (fs.existsSync(path.join(cwd, 'go.mod'))) return 'go';

        return 'unknown';
    }

    private buildCommand(
        framework: TestFramework,
        options: {
            pattern?: string;
            filter?: string;
            watch?: boolean;
            coverage?: boolean;
            verbose?: boolean;
            bail?: boolean;
            parallel?: boolean;
            timeout?: number;
        }
    ): string {
        const args: string[] = [];

        switch (framework) {
            case 'jest':
                args.push('npx jest');
                if (options.pattern) args.push(options.pattern);
                if (options.filter) args.push('-t', `"${options.filter}"`);
                if (options.watch) args.push('--watch');
                if (options.coverage) args.push('--coverage');
                if (options.verbose) args.push('--verbose');
                if (options.bail) args.push('--bail');
                if (options.parallel) args.push('--maxWorkers=auto');
                args.push('--json', '--outputFile=jest-results.json');
                break;

            case 'vitest':
                args.push('npx vitest run');
                if (options.pattern) args.push(options.pattern);
                if (options.filter) args.push('-t', `"${options.filter}"`);
                if (options.coverage) args.push('--coverage');
                args.push('--reporter=json');
                break;

            case 'pytest':
                args.push('python -m pytest');
                if (options.pattern) args.push(options.pattern);
                if (options.filter) args.push('-k', `"${options.filter}"`);
                if (options.verbose) args.push('-v');
                if (options.bail) args.push('-x');
                if (options.parallel) args.push('-n', 'auto');
                if (options.coverage) args.push('--cov', '--cov-report=json');
                args.push('--tb=short', '-q');
                break;

            case 'mocha':
                args.push('npx mocha');
                if (options.pattern) args.push(options.pattern);
                if (options.filter) args.push('-g', `"${options.filter}"`);
                if (options.timeout) args.push('--timeout', options.timeout.toString());
                if (options.bail) args.push('--bail');
                args.push('--reporter', 'json');
                break;

            case 'cargo':
                args.push('cargo test');
                if (options.filter) args.push(options.filter);
                args.push('--', '--format=json', '-Z', 'unstable-options');
                break;

            case 'rspec':
                args.push('bundle exec rspec');
                if (options.pattern) args.push(options.pattern);
                args.push('--format', 'json');
                break;

            case 'phpunit':
                args.push('vendor/bin/phpunit');
                if (options.filter) args.push('--filter', options.filter);
                if (options.coverage) args.push('--coverage-html', 'coverage');
                break;

            case 'go':
                args.push('go test');
                if (options.verbose) args.push('-v');
                if (options.coverage) args.push('-cover');
                args.push('-json', './...');
                break;

            default:
                return 'echo "Unknown test framework"';
        }

        return args.join(' ');
    }

    private parseResults(framework: TestFramework, output: string): {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        suites: TestSuite[];
        coverage?: any;
    } {
        const suites: TestSuite[] = [];
        let total = 0, passed = 0, failed = 0, skipped = 0;

        // Try to parse JSON output
        try {
            // Jest format
            const jestMatch = output.match(/\{[\s\S]*"numTotalTests"[\s\S]*\}/);
            if (jestMatch) {
                const json = JSON.parse(jestMatch[0]);
                total = json.numTotalTests || 0;
                passed = json.numPassedTests || 0;
                failed = json.numFailedTests || 0;
                skipped = json.numPendingTests || 0;

                for (const result of json.testResults || []) {
                    const suite: TestSuite = {
                        file: result.name,
                        status: result.status === 'passed' ? 'passed' : 'failed',
                        tests: [],
                        duration: result.endTime - result.startTime
                    };

                    for (const assertion of result.assertionResults || []) {
                        suite.tests.push({
                            name: assertion.title,
                            status: assertion.status,
                            duration: assertion.duration,
                            error: assertion.failureMessages?.length > 0 ? {
                                message: assertion.failureMessages.join('\n')
                            } : undefined
                        });
                    }

                    suites.push(suite);
                }

                return { total, passed, failed, skipped, suites };
            }
        } catch (e) {
            // Fall through to line parsing
        }

        // Fallback: Parse output lines
        const lines = output.split('\n');

        // Look for common patterns
        for (const line of lines) {
            // Jest/Vitest pattern: "Tests: X passed, Y failed"
            const jestPattern = line.match(/Tests:\s+(\d+)\s+passed,?\s*(\d+)?\s*failed?/i);
            if (jestPattern) {
                passed = parseInt(jestPattern[1], 10) || 0;
                failed = parseInt(jestPattern[2], 10) || 0;
                total = passed + failed;
            }

            // Pytest pattern: "X passed, Y failed"
            const pytestPattern = line.match(/(\d+)\s+passed.*?(\d+)?\s*failed?/i);
            if (pytestPattern) {
                passed = parseInt(pytestPattern[1], 10) || 0;
                failed = parseInt(pytestPattern[2], 10) || 0;
                total = passed + failed;
            }

            // Generic PASS/FAIL detection
            if (line.includes('PASS') || line.includes('✓')) {
                passed++;
                total++;
            }
            if (line.includes('FAIL') || line.includes('✗')) {
                failed++;
                total++;
            }
        }

        return { total, passed, failed, skipped, suites };
    }

    private exec(command: string, cwd: string, timeout: number): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                cwd,
                encoding: 'utf8',
                maxBuffer: 20 * 1024 * 1024,
                timeout
            }, (error, stdout, stderr) => {
                const output = stdout + '\n' + stderr;
                if (error) {
                    // Tests might fail but still produce output
                    resolve(output);
                } else {
                    resolve(output);
                }
            });
        });
    }
}
