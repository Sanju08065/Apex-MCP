/**
 * APEX MCP AGENT - HTTP REQUEST TOOL
 * Priority: P2 - MEDIUM
 */

import * as vscode from 'vscode';
import { BaseTool } from '../baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult } from '../../types';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

export class HttpRequestTool extends BaseTool {
    public readonly id = 'http_request';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'http_request',
        description: 'Make HTTP requests with full control for API testing',
        inputSchema: {
            type: 'object',
            properties: {
                method: { type: 'string', description: 'HTTP method: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS' },
                url: { type: 'string', description: 'Request URL' },
                headers: { type: 'object', description: 'Request headers' },
                body: { type: 'string', description: 'Request body (JSON string or raw)' },
                params: { type: 'object', description: 'Query parameters' },
                auth: { type: 'object', description: 'Auth config: { type, token, username, password }' },
                timeout: { type: 'number', description: 'Timeout in ms (default: 30000)' },
                followRedirects: { type: 'boolean', description: 'Follow redirects (default: true)' }
            },
            required: ['url']
        }
    };

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        try {
            const method = (params.method as string || 'GET').toUpperCase();
            let url = params.url as string;
            const headers = params.headers as Record<string, string> || {};
            const body = params.body as string;
            const queryParams = params.params as Record<string, string>;
            const auth = params.auth as { type: string; token?: string; username?: string; password?: string };
            const timeout = params.timeout as number || 30000;

            // Add query params
            if (queryParams) {
                const urlObj = new URL(url);
                for (const [key, value] of Object.entries(queryParams)) {
                    urlObj.searchParams.append(key, value);
                }
                url = urlObj.toString();
            }

            // Add auth
            if (auth) {
                if (auth.type === 'bearer' && auth.token) {
                    headers['Authorization'] = `Bearer ${auth.token}`;
                } else if (auth.type === 'basic' && auth.username) {
                    const creds = Buffer.from(`${auth.username}:${auth.password || ''}`).toString('base64');
                    headers['Authorization'] = `Basic ${creds}`;
                }
            }

            // Set content-type if body provided
            if (body && !headers['Content-Type']) {
                headers['Content-Type'] = 'application/json';
            }

            const startTime = Date.now();
            const response = await this.makeRequest(method, url, headers, body, timeout);
            const timing = { total: Date.now() - startTime };

            return this.createSuccessResult({
                success: true,
                data: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    body: response.body,
                    timing,
                    size: { body: response.body?.length || 0 }
                }
            });
        } catch (error) {
            return this.createErrorResult(`HTTP request failed: ${error instanceof Error ? error.message : error}`);
        }
    }

    private makeRequest(method: string, url: string, headers: Record<string, string>, body?: string, timeout?: number): Promise<{
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: any;
    }> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const client = isHttps ? https : http;

            const options = {
                method,
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                headers,
                timeout
            };

            const req = client.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    let parsedBody: any = data;
                    try {
                        parsedBody = JSON.parse(data);
                    } catch { }

                    const responseHeaders: Record<string, string> = {};
                    for (const [key, value] of Object.entries(res.headers)) {
                        if (value) responseHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
                    }

                    resolve({
                        status: res.statusCode || 0,
                        statusText: res.statusMessage || '',
                        headers: responseHeaders,
                        body: parsedBody
                    });
                });
            });

            req.on('error', reject);
            req.on('timeout', () => reject(new Error('Request timeout')));

            if (body) req.write(body);
            req.end();
        });
    }
}
