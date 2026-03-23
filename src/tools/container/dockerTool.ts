/**
 * APEX MCP AGENT - DOCKER TOOL
 * Priority: P2 - MEDIUM
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult } from '../../types';
import * as cp from 'child_process';

export class DockerTool extends BaseTool {
    public readonly id = 'docker';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'docker',
        description: 'Manage Docker containers, images, networks, and volumes',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', description: 'Action: ps, images, run, stop, rm, logs, exec, build, pull, push' },
                target: { type: 'string', description: 'Container/image name or ID' },
                image: { type: 'string', description: 'Image name for run/build' },
                name: { type: 'string', description: 'Container name' },
                ports: { type: 'array', description: 'Port mappings: ["8080:80"]' },
                volumes: { type: 'array', description: 'Volume mappings' },
                env: { type: 'object', description: 'Environment variables' },
                command: { type: 'string', description: 'Command for exec' },
                detach: { type: 'boolean', description: 'Run in background' },
                dockerfile: { type: 'string', description: 'Dockerfile path for build' },
                tail: { type: 'number', description: 'Number of log lines' }
            },
            required: ['action']
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        try {
            const action = params.action as string;
            const target = params.target as string;
            const image = params.image as string;
            const name = params.name as string;
            const ports = params.ports as string[] || [];
            const volumes = params.volumes as string[] || [];
            const env = params.env as Record<string, string> || {};
            const command = params.command as string;
            const detach = params.detach as boolean;
            const dockerfile = params.dockerfile as string;
            const tail = params.tail as number || 100;

            let result: any;

            switch (action) {
                case 'ps':
                    result = await this.listContainers();
                    break;
                case 'images':
                    result = await this.listImages();
                    break;
                case 'run':
                    result = await this.runContainer(image, name, ports, volumes, env, detach);
                    break;
                case 'stop':
                    result = await this.stopContainer(target);
                    break;
                case 'rm':
                    result = await this.removeContainer(target);
                    break;
                case 'logs':
                    result = await this.getLogs(target, tail);
                    break;
                case 'exec':
                    result = await this.execCommand(target, command);
                    break;
                case 'build':
                    result = await this.buildImage(image, dockerfile);
                    break;
                case 'pull':
                    result = await this.pullImage(image);
                    break;
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

            return this.createSuccessResult({ success: true, data: result });
        } catch (error) {
            return this.createErrorResult(`Docker failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    private async listContainers(): Promise<any> {
        const output = await this.exec('docker ps --format "{{json .}}"');
        const containers = output.split('\n').filter(l => l).map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        return { action: 'ps', containers, count: containers.length };
    }

    private async listImages(): Promise<any> {
        const output = await this.exec('docker images --format "{{json .}}"');
        const images = output.split('\n').filter(l => l).map(l => {
            try { return JSON.parse(l); } catch { return null; }
        }).filter(Boolean);
        return { action: 'images', images, count: images.length };
    }

    private async runContainer(image: string, name?: string, ports?: string[], volumes?: string[], env?: Record<string, string>, detach?: boolean): Promise<any> {
        const args = ['docker', 'run'];
        if (detach) args.push('-d');
        if (name) args.push('--name', name);
        for (const port of ports || []) args.push('-p', port);
        for (const vol of volumes || []) args.push('-v', vol);
        for (const [k, v] of Object.entries(env || {})) args.push('-e', `${k}=${v}`);
        args.push(image);

        const output = await this.exec(args.join(' '));
        return { action: 'run', containerId: output.trim(), image, name };
    }

    private async stopContainer(target: string): Promise<any> {
        await this.exec(`docker stop ${target}`);
        return { action: 'stop', container: target, stopped: true };
    }

    private async removeContainer(target: string): Promise<any> {
        await this.exec(`docker rm ${target}`);
        return { action: 'rm', container: target, removed: true };
    }

    private async getLogs(target: string, tail: number): Promise<any> {
        const output = await this.exec(`docker logs --tail ${tail} ${target}`);
        return { action: 'logs', container: target, logs: output.split('\n') };
    }

    private async execCommand(target: string, command: string): Promise<any> {
        const output = await this.exec(`docker exec ${target} ${command}`);
        return { action: 'exec', container: target, command, output };
    }

    private async buildImage(image: string, dockerfile?: string): Promise<any> {
        const df = dockerfile ? `-f ${dockerfile}` : '';
        const output = await this.exec(`docker build -t ${image} ${df} .`);
        return { action: 'build', image, output: output.substring(0, 2000) };
    }

    private async pullImage(image: string): Promise<any> {
        await this.exec(`docker pull ${image}`);
        return { action: 'pull', image, pulled: true };
    }

    private exec(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
                if (error && !stdout) reject(new Error(stderr || error.message));
                else resolve(stdout || stderr);
            });
        });
    }
}
