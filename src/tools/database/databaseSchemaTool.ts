/**
 * =============================================================================
 * APEX MCP AGENT - DATABASE SCHEMA TOOL
 * =============================================================================
 * 
 * Inspect database schema - tables, columns, indexes, etc.
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

type DatabaseType = 'postgres' | 'mysql' | 'sqlite';

export class DatabaseSchemaTool extends BaseTool {
    public readonly id = 'db_schema';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    public readonly schema: MCPToolSchema = {
        name: 'db_schema',
        description: 'Inspect database schema: list tables, describe table structure, indexes, and constraints',
        inputSchema: {
            type: 'object',
            properties: {
                type: {
                    type: 'string',
                    description: 'Database type: postgres, mysql, sqlite'
                },
                action: {
                    type: 'string',
                    description: 'Action: list_tables, describe_table, list_indexes, list_constraints'
                },
                table: {
                    type: 'string',
                    description: 'Table name (required for describe/indexes/constraints)'
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
                schemaName: {
                    type: 'string',
                    description: 'Schema name (for PostgreSQL, default: public)'
                }
            },
            required: ['type', 'action']
        }
    };

    public async execute(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<ToolResult> {
        try {
            const dbType = params.type as DatabaseType;
            const action = params.action as string;
            const table = params.table as string;
            const connectionString = params.connectionString as string;
            const host = params.host as string || 'localhost';
            const port = params.port as number;
            const database = params.database as string;
            const username = params.username as string;
            const password = params.password as string;
            const schemaName = params.schemaName as string || 'public';

            const connInfo = {
                connectionString, host, port, database, username, password, schemaName
            };

            let result: any;

            switch (action) {
                case 'list_tables':
                    result = await this.listTables(dbType, connInfo);
                    break;
                case 'describe_table':
                    if (!table) {
                        return this.createErrorResult('Table name required for describe_table');
                    }
                    result = await this.describeTable(dbType, connInfo, table);
                    break;
                case 'list_indexes':
                    if (!table) {
                        return this.createErrorResult('Table name required for list_indexes');
                    }
                    result = await this.listIndexes(dbType, connInfo, table);
                    break;
                case 'list_constraints':
                    if (!table) {
                        return this.createErrorResult('Table name required for list_constraints');
                    }
                    result = await this.listConstraints(dbType, connInfo, table);
                    break;
                default:
                    return this.createErrorResult(`Unknown action: ${action}`);
            }

            return this.createSuccessResult({
                success: true,
                data: {
                    action,
                    ...result
                }
            });

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Database schema operation failed: ${message}`);
        }
    }

    private async listTables(dbType: DatabaseType, conn: any): Promise<any> {
        let query: string;

        switch (dbType) {
            case 'postgres':
                query = `
                    SELECT table_name, 
                           pg_total_relation_size(quote_ident(table_name)) as size_bytes
                    FROM information_schema.tables 
                    WHERE table_schema = '${conn.schemaName}' 
                    AND table_type = 'BASE TABLE'
                    ORDER BY table_name
                `;
                break;
            case 'mysql':
                query = `
                    SELECT TABLE_NAME as table_name,
                           DATA_LENGTH + INDEX_LENGTH as size_bytes,
                           TABLE_ROWS as row_count
                    FROM information_schema.TABLES
                    WHERE TABLE_SCHEMA = '${conn.database}'
                    ORDER BY TABLE_NAME
                `;
                break;
            case 'sqlite':
                query = `SELECT name as table_name FROM sqlite_master WHERE type='table' ORDER BY name`;
                break;
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }

        const output = await this.executeQuery(dbType, conn, query);
        const tables = this.parseOutput(output);

        return {
            tables: tables.map((t: any) => ({
                name: t.table_name || t.name,
                schema: conn.schemaName,
                type: 'table',
                rowCount: t.row_count ? parseInt(t.row_count, 10) : undefined,
                sizeBytes: t.size_bytes ? parseInt(t.size_bytes, 10) : undefined,
                sizeHuman: t.size_bytes ? this.formatBytes(parseInt(t.size_bytes, 10)) : undefined
            })),
            totalTables: tables.length
        };
    }

    private async describeTable(dbType: DatabaseType, conn: any, table: string): Promise<any> {
        let query: string;

        switch (dbType) {
            case 'postgres':
                query = `
                    SELECT 
                        c.column_name as name,
                        c.data_type as type,
                        c.is_nullable = 'YES' as nullable,
                        c.column_default as default_value,
                        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as primary_key,
                        CASE WHEN un.column_name IS NOT NULL THEN true ELSE false END as unique_col
                    FROM information_schema.columns c
                    LEFT JOIN (
                        SELECT ku.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku
                            ON tc.constraint_name = ku.constraint_name
                        WHERE tc.table_name = '${table}' AND tc.constraint_type = 'PRIMARY KEY'
                    ) pk ON c.column_name = pk.column_name
                    LEFT JOIN (
                        SELECT ku.column_name
                        FROM information_schema.table_constraints tc
                        JOIN information_schema.key_column_usage ku
                            ON tc.constraint_name = ku.constraint_name
                        WHERE tc.table_name = '${table}' AND tc.constraint_type = 'UNIQUE'
                    ) un ON c.column_name = un.column_name
                    WHERE c.table_name = '${table}' AND c.table_schema = '${conn.schemaName}'
                    ORDER BY c.ordinal_position
                `;
                break;
            case 'mysql':
                query = `DESCRIBE ${table}`;
                break;
            case 'sqlite':
                query = `PRAGMA table_info(${table})`;
                break;
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }

        const output = await this.executeQuery(dbType, conn, query);
        const columns = this.parseOutput(output);

        return {
            table,
            columns: columns.map((col: any) => ({
                name: col.name || col.Field || col.name,
                type: col.type || col.Type,
                nullable: col.nullable === 'true' || col.nullable === true || col.Null === 'YES' || col.notnull === '0',
                default: col.default_value || col.Default || col.dflt_value,
                primaryKey: col.primary_key === 'true' || col.primary_key === true || col.Key === 'PRI' || col.pk === '1',
                unique: col.unique_col === 'true' || col.unique_col === true || col.Key === 'UNI'
            }))
        };
    }

    private async listIndexes(dbType: DatabaseType, conn: any, table: string): Promise<any> {
        let query: string;

        switch (dbType) {
            case 'postgres':
                query = `
                    SELECT indexname as name, indexdef as definition
                    FROM pg_indexes
                    WHERE tablename = '${table}' AND schemaname = '${conn.schemaName}'
                `;
                break;
            case 'mysql':
                query = `SHOW INDEX FROM ${table}`;
                break;
            case 'sqlite':
                query = `PRAGMA index_list(${table})`;
                break;
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }

        const output = await this.executeQuery(dbType, conn, query);
        const indexes = this.parseOutput(output);

        return {
            table,
            indexes: indexes.map((idx: any) => ({
                name: idx.name || idx.Key_name,
                columns: idx.Column_name ? [idx.Column_name] : undefined,
                unique: idx.unique === '1' || idx.Non_unique === '0',
                type: idx.Index_type || 'btree',
                definition: idx.definition
            }))
        };
    }

    private async listConstraints(dbType: DatabaseType, conn: any, table: string): Promise<any> {
        let query: string;

        switch (dbType) {
            case 'postgres':
                query = `
                    SELECT 
                        tc.constraint_name as name,
                        tc.constraint_type as type,
                        kcu.column_name,
                        ccu.table_name as foreign_table,
                        ccu.column_name as foreign_column
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name
                    LEFT JOIN information_schema.constraint_column_usage ccu
                        ON tc.constraint_name = ccu.constraint_name
                    WHERE tc.table_name = '${table}' AND tc.table_schema = '${conn.schemaName}'
                `;
                break;
            case 'mysql':
                query = `
                    SELECT CONSTRAINT_NAME as name, CONSTRAINT_TYPE as type
                    FROM information_schema.TABLE_CONSTRAINTS
                    WHERE TABLE_NAME = '${table}' AND TABLE_SCHEMA = '${conn.database}'
                `;
                break;
            case 'sqlite':
                query = `PRAGMA foreign_key_list(${table})`;
                break;
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }

        const output = await this.executeQuery(dbType, conn, query);
        const constraints = this.parseOutput(output);

        return {
            table,
            constraints: constraints.map((c: any) => ({
                name: c.name || `fk_${c.id}`,
                type: c.type || 'FOREIGN KEY',
                column: c.column_name || c.from,
                foreignTable: c.foreign_table || c.table,
                foreignColumn: c.foreign_column || c.to
            }))
        };
    }

    private async executeQuery(dbType: DatabaseType, conn: any, query: string): Promise<string> {
        let command: string;
        const cleanQuery = query.replace(/\s+/g, ' ').trim();

        switch (dbType) {
            case 'postgres': {
                let connStr = conn.connectionString;
                if (!connStr && conn.database) {
                    connStr = `postgresql://${conn.username || 'postgres'}:${conn.password || ''}@${conn.host}:${conn.port || 5432}/${conn.database}`;
                }
                command = `psql "${connStr}" -c "${cleanQuery.replace(/"/g, '\\"')}" --csv -q`;
                break;
            }
            case 'mysql': {
                const args: string[] = ['mysql'];
                if (conn.host) args.push(`-h${conn.host}`);
                if (conn.port) args.push(`-P${conn.port}`);
                if (conn.username) args.push(`-u${conn.username}`);
                if (conn.password) args.push(`-p${conn.password}`);
                if (conn.database) args.push(conn.database);
                args.push('-e', `"${cleanQuery.replace(/"/g, '\\"')}"`, '--batch');
                command = args.join(' ');
                break;
            }
            case 'sqlite':
                command = `sqlite3 -header -csv "${conn.database}" "${cleanQuery.replace(/"/g, '\\"')}"`;
                break;
            default:
                throw new Error(`Unsupported database type: ${dbType}`);
        }

        return this.exec(command);
    }

    private parseOutput(output: string): any[] {
        const lines = output.trim().split('\n').filter(l => l);
        if (lines.length === 0) return [];

        const separator = output.includes('\t') ? '\t' : ',';
        const headers = lines[0].split(separator).map(h => h.trim().replace(/^"|"$/g, ''));

        const rows: any[] = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(separator).map(v => v.trim().replace(/^"|"$/g, ''));
            const row: any = {};
            headers.forEach((header, index) => {
                row[header] = values[index];
            });
            rows.push(row);
        }

        return rows;
    }

    private formatBytes(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    private exec(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            cp.exec(command, {
                encoding: 'utf8',
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30000
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
