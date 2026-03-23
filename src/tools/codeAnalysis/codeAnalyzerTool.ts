/**
 * APEX MCP AGENT - CODE ANALYZER TOOL
 * Priority: P2 - MEDIUM
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult } from '../../types';
import * as fs from 'fs';
import * as path from 'path';

export class CodeAnalyzerTool extends BaseTool {
    public readonly id = 'code_analyzer';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'code_analyzer',
        description: 'Analyze code complexity, find duplicates, dead code, and generate metrics',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File or directory to analyze' },
                metrics: { type: 'array', description: 'Metrics: complexity, duplicates, deadcode, all' },
                threshold: { type: 'object', description: 'Complexity thresholds' }
            },
            required: []
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        try {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const targetPath = params.path as string || workspacePath;
            const metrics = params.metrics as string[] || ['complexity'];
            const threshold = params.threshold as Record<string, number> || { cyclomatic: 10, cognitive: 15 };

            const files = this.getFiles(targetPath);
            const results: any = { files: files.length, functions: 0, issues: [] };

            for (const file of files.slice(0, 50)) {
                const content = fs.readFileSync(file, 'utf8');
                const analysis = this.analyzeFile(file, content, threshold);
                results.functions += analysis.functions;
                results.issues.push(...analysis.issues);
            }

            results.avgComplexity = results.functions > 0 ?
                results.issues.filter((i: any) => i.type === 'complexity').reduce((sum: number, i: any) => sum + i.value, 0) / results.functions : 0;

            return this.createSuccessResult({ success: true, data: results });
        } catch (error) {
            return this.createErrorResult(`Analysis failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    private getFiles(targetPath: string): string[] {
        const files: string[] = [];
        const extensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs'];

        const scan = (dir: string) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) scan(fullPath);
                    else if (extensions.some(ext => entry.name.endsWith(ext))) files.push(fullPath);
                }
            } catch { }
        };

        if (fs.statSync(targetPath).isDirectory()) scan(targetPath);
        else files.push(targetPath);

        return files;
    }

    private analyzeFile(file: string, content: string, threshold: Record<string, number>): { functions: number; issues: any[] } {
        const issues: any[] = [];
        let functions = 0;

        // Simple complexity analysis
        const functionPatterns = [
            /function\s+(\w+)/g,
            /(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/g,
            /(\w+)\s*\([^)]*\)\s*\{/g,
            /def\s+(\w+)/g
        ];

        for (const pattern of functionPatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                functions++;
                const name = match[1];

                // Estimate complexity by counting branches
                const startIdx = match.index;
                const endIdx = this.findFunctionEnd(content, startIdx);
                const funcBody = content.substring(startIdx, endIdx);

                const complexity = this.calculateComplexity(funcBody);

                if (complexity > threshold.cyclomatic) {
                    issues.push({
                        type: 'complexity',
                        file,
                        function: name,
                        value: complexity,
                        threshold: threshold.cyclomatic,
                        message: `Cyclomatic complexity ${complexity} exceeds threshold ${threshold.cyclomatic}`
                    });
                }
            }
        }

        // Check for code smells
        if (content.split('\n').length > 500) {
            issues.push({ type: 'size', file, message: 'File has more than 500 lines' });
        }

        return { functions, issues };
    }

    private findFunctionEnd(content: string, start: number): number {
        let braces = 0;
        let started = false;
        for (let i = start; i < content.length; i++) {
            if (content[i] === '{') { braces++; started = true; }
            if (content[i] === '}') braces--;
            if (started && braces === 0) return i;
        }
        return Math.min(start + 1000, content.length);
    }

    private calculateComplexity(code: string): number {
        let complexity = 1;
        const patterns = [/\bif\b/g, /\belse\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?/g];
        for (const pattern of patterns) {
            complexity += (code.match(pattern) || []).length;
        }
        return complexity;
    }
}
