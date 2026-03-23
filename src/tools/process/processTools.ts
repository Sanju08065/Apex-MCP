/**
 * APEX MCP AGENT - PROCESS START/STOP TOOL
 * Priority: P1 - HIGH
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult } from '../../types';
import * as cp from 'child_process';

interface ManagedProcess {
    id: string;
    pid: number;
    command: string;
    args: string[];
    cwd: string;
    status: 'running' | 'stopped' | 'failed';
    startedAt: Date;
    process?: cp.ChildProcess;
    stdout: string[];
    stderr: string[];
}

const managedProcesses = new Map<string, ManagedProcess>();

export class ProcessStartTool extends BaseTool {
    public readonly id = 'process_start';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'process_start',
        description: 'Start and monitor a long-running process',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: 'Command to execute' },
                args: { type: 'array', description: 'Command arguments' },
                cwd: { type: 'string', description: 'Working directory' },
                env: { type: 'object', description: 'Environment variables' },
                detach: { type: 'boolean', description: 'Run in background' },
                timeout: { type: 'number', description: 'Auto-kill timeout in ms' }
            },
            required: ['command']
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        try {
            const command = params.command as string;
            const args = params.args as string[] || [];
            const cwd = params.cwd as string || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            const env = params.env as Record<string, string> || {};
            const detach = params.detach as boolean || false;
            const timeout = params.timeout as number || 0;

            const processId = `proc_${Date.now().toString(36)}`;

            const childProcess = cp.spawn(command, args, {
                cwd,
                env: { ...process.env, ...env },
                detached: detach,
                shell: true
            });

            const managedProc: ManagedProcess = {
                id: processId,
                pid: childProcess.pid || 0,
                command,
                args,
                cwd,
                status: 'running',
                startedAt: new Date(),
                process: childProcess,
                stdout: [],
                stderr: []
            };

            childProcess.stdout?.on('data', (data) => {
                managedProc.stdout.push(data.toString());
                if (managedProc.stdout.length > 1000) managedProc.stdout.shift();
            });

            childProcess.stderr?.on('data', (data) => {
                managedProc.stderr.push(data.toString());
                if (managedProc.stderr.length > 1000) managedProc.stderr.shift();
            });

            childProcess.on('close', (code) => {
                managedProc.status = code === 0 ? 'stopped' : 'failed';
            });

            if (timeout > 0) {
                setTimeout(() => {
                    if (managedProc.status === 'running') {
                        childProcess.kill('SIGTERM');
                    }
                }, timeout);
            }

            managedProcesses.set(processId, managedProc);

            return this.createSuccessResult({
                success: true,
                data: {
                    processId,
                    pid: childProcess.pid,
                    command: `${command} ${args.join(' ')}`,
                    status: 'running',
                    startedAt: managedProc.startedAt.toISOString(),
                    detached: detach
                }
            });
        } catch (error) {
            return this.createErrorResult(`Process start failed: ${error instanceof Error ? error.message : error}`);
        }
    }
}

export class ProcessStatusTool extends BaseTool {
    public readonly id = 'process_status';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'process_status',
        description: 'Get status of managed processes',
        inputSchema: {
            type: 'object',
            properties: {
                processId: { type: 'string', description: 'Process ID (all if empty)' },
                includeOutput: { type: 'boolean', description: 'Include recent output' },
                outputLines: { type: 'number', description: 'Number of output lines' }
            },
            required: []
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const processId = params.processId as string;
        const includeOutput = params.includeOutput !== false;
        const outputLines = params.outputLines as number || 50;

        const processes: any[] = [];

        for (const [id, proc] of managedProcesses) {
            if (processId && id !== processId) continue;

            const info: any = {
                processId: proc.id,
                pid: proc.pid,
                command: proc.command,
                status: proc.status,
                startedAt: proc.startedAt.toISOString(),
                uptime: Math.floor((Date.now() - proc.startedAt.getTime()) / 1000)
            };

            if (includeOutput) {
                info.output = {
                    stdout: proc.stdout.slice(-outputLines),
                    stderr: proc.stderr.slice(-outputLines)
                };
            }

            processes.push(info);
        }

        return this.createSuccessResult({ success: true, data: { processes } });
    }
}

export class ProcessStopTool extends BaseTool {
    public readonly id = 'process_stop';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'process_stop',
        description: 'Stop a running process',
        inputSchema: {
            type: 'object',
            properties: {
                processId: { type: 'string', description: 'Process ID to stop' },
                signal: { type: 'string', description: 'Signal: SIGTERM, SIGKILL, SIGINT' },
                timeout: { type: 'number', description: 'Wait timeout before SIGKILL' }
            },
            required: ['processId']
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const processId = params.processId as string;
        const signal = (params.signal as string || 'SIGTERM') as NodeJS.Signals;
        const timeout = params.timeout as number || 5000;

        const proc = managedProcesses.get(processId);
        if (!proc) {
            return this.createErrorResult(`Process not found: ${processId}`);
        }

        if (proc.process) {
            proc.process.kill(signal);

            if (signal !== 'SIGKILL') {
                setTimeout(() => {
                    if (proc.status === 'running' && proc.process) {
                        proc.process.kill('SIGKILL');
                    }
                }, timeout);
            }
        }

        proc.status = 'stopped';

        return this.createSuccessResult({
            success: true,
            data: {
                processId,
                pid: proc.pid,
                status: 'stopped',
                signal,
                stoppedAt: new Date().toISOString()
            }
        });
    }
}
