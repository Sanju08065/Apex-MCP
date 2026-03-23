/**
 * =============================================================================
 * MCP BRIDGE - Standalone MCP Server for Claude Desktop
 * =============================================================================
 * 
 * This runs as a separate process that Claude Desktop can call via MCP.
 * It communicates with the VS Code extension to show live streaming.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * MCP Bridge Server
 * Receives calls from Claude Desktop and forwards to VS Code extension
 */
class MCPBridgeServer {
  private server: Server;
  private workspaceRoot: string;

  constructor() {
    this.server = new Server(
      {
        name: 'apex-vscode-bridge',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Get workspace root from environment or current directory
    this.workspaceRoot = process.env.WORKSPACE_ROOT || process.cwd();

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'create_file',
          description: 'Create a new file with live streaming in VS Code editor. File appears in explorer, opens in editor, and content streams in token by token.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path relative to workspace root',
              },
              content: {
                type: 'string',
                description: 'Content to write to the file',
              },
              overwrite: {
                type: 'boolean',
                description: 'Whether to overwrite if file exists (default: false)',
              },
            },
            required: ['path', 'content'],
          },
        },
        {
          name: 'apply_diff',
          description: 'Apply diff-based edits to a file with live streaming in VS Code editor. Shows old vs new content and applies changes live.',
          inputSchema: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path relative to workspace root',
              },
              edits: {
                type: 'array',
                description: 'Array of edit operations to apply',
                items: {
                  type: 'object',
                  properties: {
                    startLine: {
                      type: 'number',
                      description: 'Starting line number (1-indexed)',
                    },
                    endLine: {
                      type: 'number',
                      description: 'Ending line number (1-indexed, inclusive)',
                    },
                    oldContent: {
                      type: 'string',
                      description: 'Content being replaced (for verification)',
                    },
                    newContent: {
                      type: 'string',
                      description: 'New content to insert',
                    },
                  },
                },
              },
              description: {
                type: 'string',
                description: 'Human-readable description of the changes',
              },
            },
            required: ['path', 'edits'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'create_file':
            return await this.handleCreateFile(args as any);
          case 'apply_diff':
            return await this.handleApplyDiff(args as any);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Handle create_file tool call
   * Creates file and triggers VS Code extension to show live streaming
   */
  private async handleCreateFile(args: {
    path: string;
    content: string;
    overwrite?: boolean;
  }) {
    const { path: filePath, content, overwrite = false } = args;
    const fullPath = path.join(this.workspaceRoot, filePath);

    // Check if file exists
    if (fs.existsSync(fullPath) && !overwrite) {
      throw new Error(`File already exists: ${filePath}. Set overwrite=true to replace it.`);
    }

    // Create parent directories
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Create empty file first
    fs.writeFileSync(fullPath, '');

    // Trigger VS Code extension to show live streaming
    // This will be done via VS Code command
    await this.triggerVSCodeStreaming('create_file', {
      path: filePath,
      content,
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ File created: ${filePath}\n\n🎬 Live streaming in VS Code editor!\n\nWatch your VS Code editor to see the content being typed token by token.`,
        },
      ],
    };
  }

  /**
   * Handle apply_diff tool call
   */
  private async handleApplyDiff(args: {
    path: string;
    edits: Array<{
      startLine: number;
      endLine: number;
      oldContent?: string;
      newContent: string;
    }>;
    description?: string;
  }) {
    const { path: filePath, edits, description } = args;
    const fullPath = path.join(this.workspaceRoot, filePath);

    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Trigger VS Code extension to show live diff application
    await this.triggerVSCodeStreaming('apply_diff', {
      path: filePath,
      edits,
      description,
    });

    return {
      content: [
        {
          type: 'text',
          text: `✅ Applied ${edits.length} edit(s) to ${filePath}\n\n🎬 Live streaming in VS Code editor!\n\nWatch your VS Code editor to see the changes being applied.`,
        },
      ],
    };
  }

  /**
   * Trigger VS Code extension to show live streaming
   * This creates a marker file that the extension watches
   */
  private async triggerVSCodeStreaming(
    action: string,
    data: any
  ): Promise<void> {
    // Create a marker file in .vscode directory
    const markerDir = path.join(this.workspaceRoot, '.vscode', '.apex-streaming');
    if (!fs.existsSync(markerDir)) {
      fs.mkdirSync(markerDir, { recursive: true });
    }

    const markerFile = path.join(markerDir, `${Date.now()}.json`);
    fs.writeFileSync(
      markerFile,
      JSON.stringify({
        action,
        data,
        timestamp: Date.now(),
      })
    );

    // Wait a bit for VS Code extension to pick it up
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /**
   * Start the MCP server
   */
  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Bridge Server started');
  }
}

// Start the server
const server = new MCPBridgeServer();
server.start().catch(console.error);
