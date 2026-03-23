/**
 * =============================================================================
 * APEX MCP AGENT - COVERAGE REPORT TOOL
 * =============================================================================
 * 
 * Generate and analyze code coverage reports.
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

interface CoverageSummary {
    lines: { total: number; covered: number; percent: number };
    statements: { total: number; covered: number; percent: number };
    functions: { total: number; covered: number; percent: number };
    branches: { total: number; covered: number; percent: number };
}

interface FileCoverage {
    path: string;
    lines: { total: number; covered: number; percent: number; uncovered: number[] };
    functions: { total: number; covered: number; percent: number };
    branches: { total: number; covered: number; percent: number };
}

export class CoverageReportTool extends BaseTool {
    public readonly id = 'coverage_report';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'coverage_report',
        description: 'Generate and analyze code coverage reports from test runs',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'Project path (defaults to workspace root)'
                },
                format: {
                    type: 'string',
                    description: 'Output format: json, html, lcov, text, cobertura'
                },
                threshold: {
                    type: 'object',
                    description: 'Coverage thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 }'
                },
                include: {
                    type: 'array',
                    description: 'File patterns to include'
                },
                exclude: {
                    type: 'array',
                    description: 'File patterns to exclude'
                },
                outputDir: {
                    type: 'string',
                    description: 'Output directory (default: coverage/)'
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

            const format = params.format as string || 'json';
            const threshold = params.threshold as Record<string, number> || {
                lines: 80,
                statements: 80,
                functions: 80,
                branches: 80
            };
            const outputDir = params.outputDir as string || 'coverage';

            // Look for existing coverage reports
            const coverageData = await this.findAndParseCoverage(workspacePath, outputDir);

            if (!coverageData) {
                return this.createErrorResult('No coverage data found. Run tests with coverage first.');
            }

            // Calculate summary
            const summary = this.calculateSummary(coverageData);

            // Check thresholds
            const thresholdsMet = this.checkThresholds(summary, threshold);
            const belowThreshold: string[] = [];

            if (summary.lines.percent < threshold.lines) belowThreshold.push('lines');
            if (summary.statements.percent < threshold.statements) belowThreshold.push('statements');
            if (summary.functions.percent < threshold.functions) belowThreshold.push('functions');
            if (summary.branches.percent < threshold.branches) belowThreshold.push('branches');

            // Get file-level coverage
            const files = this.getFileCoverage(coverageData);

            return this.createSuccessResult({
                success: true,
                data: {
                    format,
                    reportPath: path.join(outputDir, 'coverage-summary.json'),
                    summary,
                    thresholdsMet,
                    belowThreshold,
                    files: files.slice(0, 20), // Limit to top 20 files
                    fileCount: files.length
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Coverage report failed: ${message}`);
        }
    }

    private async findAndParseCoverage(cwd: string, outputDir: string): Promise<any | null> {
        // Look for coverage files in common locations
        const possiblePaths = [
            path.join(cwd, outputDir, 'coverage-final.json'),
            path.join(cwd, outputDir, 'coverage-summary.json'),
            path.join(cwd, outputDir, 'lcov.info'),
            path.join(cwd, '.nyc_output', 'coverage.json'),
            path.join(cwd, 'coverage', 'coverage-final.json'),
            path.join(cwd, 'coverage.json')
        ];

        for (const coveragePath of possiblePaths) {
            if (fs.existsSync(coveragePath)) {
                const content = fs.readFileSync(coveragePath, 'utf8');

                if (coveragePath.endsWith('.json')) {
                    return JSON.parse(content);
                } else if (coveragePath.endsWith('lcov.info')) {
                    return this.parseLcov(content);
                }
            }
        }

        return null;
    }

    private parseLcov(content: string): any {
        const coverage: any = {};
        let currentFile: string | null = null;

        const lines = content.split('\n');
        for (const line of lines) {
            if (line.startsWith('SF:')) {
                currentFile = line.substring(3);
                coverage[currentFile] = {
                    path: currentFile,
                    s: {}, b: {}, f: {},
                    statementMap: {}, branchMap: {}, fnMap: {}
                };
            } else if (currentFile) {
                if (line.startsWith('DA:')) {
                    const [lineNum, hits] = line.substring(3).split(',');
                    coverage[currentFile].s[lineNum] = parseInt(hits, 10);
                } else if (line.startsWith('BRDA:')) {
                    const parts = line.substring(5).split(',');
                    const key = `${parts[0]}-${parts[1]}`;
                    coverage[currentFile].b[key] = coverage[currentFile].b[key] || [];
                    coverage[currentFile].b[key].push(parseInt(parts[3], 10));
                } else if (line.startsWith('FN:')) {
                    const [lineNum, name] = line.substring(3).split(',');
                    coverage[currentFile].fnMap[name] = { line: parseInt(lineNum, 10) };
                } else if (line.startsWith('FNDA:')) {
                    const [hits, name] = line.substring(5).split(',');
                    coverage[currentFile].f[name] = parseInt(hits, 10);
                }
            }
        }

        return coverage;
    }

    private calculateSummary(coverageData: any): CoverageSummary {
        let totalLines = 0, coveredLines = 0;
        let totalStatements = 0, coveredStatements = 0;
        let totalFunctions = 0, coveredFunctions = 0;
        let totalBranches = 0, coveredBranches = 0;

        for (const fileCoverage of Object.values(coverageData)) {
            const file = fileCoverage as any;

            // Statements
            if (file.s) {
                for (const [, hits] of Object.entries(file.s)) {
                    totalStatements++;
                    if ((hits as number) > 0) coveredStatements++;
                }
            }

            // Functions
            if (file.f) {
                for (const [, hits] of Object.entries(file.f)) {
                    totalFunctions++;
                    if ((hits as number) > 0) coveredFunctions++;
                }
            }

            // Branches
            if (file.b) {
                for (const [, hits] of Object.entries(file.b)) {
                    const branchHits = hits as number[];
                    for (const h of branchHits) {
                        totalBranches++;
                        if (h > 0) coveredBranches++;
                    }
                }
            }

            // Lines (approximate from statements if not available)
            if (file.statementMap) {
                const linesCovered = new Set<number>();
                const linesTotal = new Set<number>();

                for (const [stmtId, stmt] of Object.entries(file.statementMap)) {
                    const s = stmt as any;
                    const line = s.start?.line || s.line;
                    if (line) {
                        linesTotal.add(line);
                        if (file.s[stmtId] > 0) {
                            linesCovered.add(line);
                        }
                    }
                }

                totalLines += linesTotal.size;
                coveredLines += linesCovered.size;
            } else {
                totalLines = totalStatements;
                coveredLines = coveredStatements;
            }
        }

        return {
            lines: {
                total: totalLines,
                covered: coveredLines,
                percent: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0
            },
            statements: {
                total: totalStatements,
                covered: coveredStatements,
                percent: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0
            },
            functions: {
                total: totalFunctions,
                covered: coveredFunctions,
                percent: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0
            },
            branches: {
                total: totalBranches,
                covered: coveredBranches,
                percent: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0
            }
        };
    }

    private checkThresholds(summary: CoverageSummary, threshold: Record<string, number>): boolean {
        return summary.lines.percent >= threshold.lines &&
            summary.statements.percent >= threshold.statements &&
            summary.functions.percent >= threshold.functions &&
            summary.branches.percent >= threshold.branches;
    }

    private getFileCoverage(coverageData: any): FileCoverage[] {
        const files: FileCoverage[] = [];

        for (const [filePath, fileCoverage] of Object.entries(coverageData)) {
            const file = fileCoverage as any;

            let totalLines = 0, coveredLines = 0;
            let totalFunctions = 0, coveredFunctions = 0;
            let totalBranches = 0, coveredBranches = 0;
            const uncoveredLines: number[] = [];

            // Statements/Lines
            if (file.s) {
                for (const [stmtId, hits] of Object.entries(file.s)) {
                    totalLines++;
                    if ((hits as number) > 0) {
                        coveredLines++;
                    } else {
                        const stmt = file.statementMap?.[stmtId];
                        if (stmt?.start?.line) {
                            uncoveredLines.push(stmt.start.line);
                        }
                    }
                }
            }

            // Functions
            if (file.f) {
                for (const [, hits] of Object.entries(file.f)) {
                    totalFunctions++;
                    if ((hits as number) > 0) coveredFunctions++;
                }
            }

            // Branches
            if (file.b) {
                for (const [, hits] of Object.entries(file.b)) {
                    const branchHits = hits as number[];
                    for (const h of branchHits) {
                        totalBranches++;
                        if (h > 0) coveredBranches++;
                    }
                }
            }

            files.push({
                path: filePath,
                lines: {
                    total: totalLines,
                    covered: coveredLines,
                    percent: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
                    uncovered: [...new Set(uncoveredLines)].sort((a, b) => a - b).slice(0, 20)
                },
                functions: {
                    total: totalFunctions,
                    covered: coveredFunctions,
                    percent: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0
                },
                branches: {
                    total: totalBranches,
                    covered: coveredBranches,
                    percent: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0
                }
            });
        }

        // Sort by coverage percentage (lowest first)
        return files.sort((a, b) => a.lines.percent - b.lines.percent);
    }
}
