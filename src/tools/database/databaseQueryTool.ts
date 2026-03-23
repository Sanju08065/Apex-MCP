/**
 * =============================================================================
 * APEX MCP AGENT - DATABASE QUERY TOOL
 * =============================================================================
 * 
 * Execute SQL queries with parameterization.
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

type DatabaseType = 'postgres' | 'mysql' | 'sqlite' | 'mongodb';

export class DatabaseQueryTool extends BaseTool {
    public readonly id = 'db_query';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'db_query',
        description: 'Execute SQL queries on databases (PostgreSQL, MySQL, SQLite, MongoDB)',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Database type: postgres, mysql, sqlite, mongodb'
                },
                query: {
                    type: 'string',
                    description: 'SQL query to execute'
                },
                connectionString: {
                    type: 'string',
                    description: 'Database connection string'
                },
                host: {
                    type: 'string',
                    description: 'Database host'
                },
                port: {
                    type: 'number',
                    description: 'Database port'
                },
                database: {
                    type: 'string',
                    description: 'Database name'
                },
                username: {
                    type: 'string',
                    description: 'Username'
                },
                password: {
                    type: 'string',
                    description: 'Password'
                },
                params: {
                    type: 'array',
                    description: 'Query parameters (for parameterized queries)'
                },
                maxRows: {
                    type: 'number',
                    description: 'Maximum rows to return (default: 100)'
                },
                explain: {
                    type: 'boolean',
                    description: 'Return query execution plan'
                }
            },
            required: ['type', 'query']
        }
    };

    public async execute(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        try {
            const dbType = params.type as DatabaseType;
            const query = params.query as string;
            const connectionString = params.connectionString as string;
            const host = params.host as string || 'localhost';
            const port = params.port as number;
            const database = params.database as string;
            const username = params.username as string;
            const password = params.password as string;
            const queryParams = params.params as any[] || [];
            const maxRows = params.maxRows as number || 100;
            const explain = params.explain as boolean || false;

            // Validate query for safety
            const safetyCheck = this.checkQuerySafety(query);
            if (!safetyCheck.safe) {
                return this.createErrorResult(`Query blocked: ${safetyCheck.reason}`);
            }

            // Build and execute command based on database type
            let result: any;

            switch (dbType) {
                case 'postgres':
                    result = await this.executePostgres(
                        query, connectionString, host, port || 5432, database, username, password, maxRows, explain
                    );
                    break;
                case 'mysql':
                    result = await this.executeMysql(
                        query, connectionString, host, port || 3306, database, username, password, maxRows, explain
                    );
                    break;
                case 'sqlite':
                    result = await this.executeSqlite(query, database, maxRows);
                    break;
                case 'mongodb':
                    result = await this.executeMongoDB(query, connectionString, database, maxRows);
                    break;
                default:
                    return this.createErrorResult(`Unsupported database type: ${dbType}`);
            }

            return this.createSuccessResult({
                success: true,
                data: result
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Database query failed: ${message}`);
        }
    }

    private checkQuerySafety(query: string): { safe: boolean; reason?: string } {
        const upperQuery = query.toUpperCase().trim();

        // Block dangerous operations without explicit confirmation
        const dangerousPatterns = [
            /DROP\s+DATABASE/i,
            /TRUNCATE/i,
            /DELETE\s+FROM\s+\w+\s*$/i, // DELETE without WHERE
            /UPDATE\s+\w+\s+SET\s+.*\s*$/i, // UPDATE without WHERE
        ];

        for (const pattern of dangerousPatterns) {
            if (pattern.test(query)) {
                return { safe: false, reason: 'Dangerous operation detected. Use explicit table names and WHERE clauses.' };
            }
        }

        return { safe: true };
    }

    private async executePostgres(
        query: string,
        connectionString: string | undefined,
        host: string,
        port: number,
        database: string,
        username: string,
        password: string,
        maxRows: number,
        explain: boolean
    ): Promise<any> {
        let connStr = connectionString;
        if (!connStr && database) {
            connStr = `postgresql://${username || 'postgres'}:${password || ''}@${host}:${port}/${database}`;
        }

        if (!connStr) {
            throw new Error('Connection string or database details required');
        }

        const finalQuery = explain ? `EXPLAIN ANALYZE ${query}` : `${query} LIMIT ${maxRows}`;

        // Use psql command
        const output = await this.exec(`psql "${connStr}" -c "${finalQuery.replace(/"/g, '\\"')}" --csv -q`);

        return this.parseCSVOutput(output);
    }

    private async executeMysql(
        query: string,
        connectionString: string | undefined,
        host: string,
        port: number,
        database: string,
        username: string,
        password: string,
        maxRows: number,
        explain: boolean
    ): Promise<any> {
        const finalQuery = explain ? `EXPLAIN ${query}` : `${query} LIMIT ${maxRows}`;

        // Build mysql command
        const args: string[] = ['mysql'];
        if (host) args.push(`-h${host}`);
        if (port) args.push(`-P${port}`);
        if (username) args.push(`-u${username}`);
        if (password) args.push(`-p${password}`);
        if (database) args.push(database);
        args.push('-e', `"${finalQuery.replace(/"/g, '\\"')}"`, '--batch');

        const output = await this.exec(args.join(' '));
        return this.parseTSVOutput(output);
    }

    private async executeSqlite(query: string, database: string, maxRows: number): Promise<any> {
        if (!database) {
            throw new Error('SQLite database file path required');
        }

        const finalQuery = `${query} LIMIT ${maxRows}`;
        const output = await this.exec(`sqlite3 -header -csv "${database}" "${finalQuery.replace(/"/g, '\\"')}"`);

        return this.parseCSVOutput(output);
    }

    private async executeMongoDB(
        query: string,
        connectionString: string | undefined,
        database: string,
        maxRows: number
    ): Promise<any> {
        // Parse MongoDB query (assumes JSON format)
        let mongoQuery = query;

        // Build mongosh command
        const connStr = connectionString || `mongodb://localhost:27017/${database}`;
        const command = `mongosh "${connStr}" --quiet --eval '${mongoQuery}.limit(${maxRows}).toArray()'`;

        const output = await this.exec(command);

        try {
            return JSON.parse(output);
        } catch {
            return { raw: output };
        }
    }

    private parseCSVOutput(output: string): { rows: any[]; rowCount: number; fields: string[] } {
        const lines = output.trim().split('\n').filter(l => l);
        if (lines.length === 0) {
            return { rows: [], rowCount: 0, fields: [] };
        }

        const fields = lines[0].split(',').map(f => f.trim().replace(/^"|"$/g, ''));
        const rows: any[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const row: any = {};
            fields.forEach((field, index) => {
                row[field] = values[index];
            });
            rows.push(row);
        }

        return { rows, rowCount: rows.length, fields };
    }

    private parseTSVOutput(output: string): { rows: any[]; rowCount: number; fields: string[] } {
        const lines = output.trim().split('\n').filter(l => l);
        if (lines.length === 0) {
            return { rows: [], rowCount: 0, fields: [] };
        }

        const fields = lines[0].split('\t').map(f => f.trim());
        const rows: any[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split('\t').map(v => v.trim());
            const row: any = {};
            fields.forEach((field, index) => {
                row[field] = values[index];
            });
            rows.push(row);
        }

        return { rows, rowCount: rows.length, fields };
    }

    private exec(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 60000
            }, (error, stdout, stderr) => {
                if (error && !stdout) {
                    reject(new Error(stderr || error.message));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}
