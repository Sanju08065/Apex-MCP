/**
 * =============================================================================
 * STREAMING EXAMPLE - How to use token streaming with file operations
 * =============================================================================
 * 
 * This example demonstrates how to implement a client that receives
 * streaming updates from file creation and editing operations.
 */

import { MCPRequest, MCPResponse, MCPNotification } from '../src/types';

/**
 * Example MCP client that handles streaming notifications
 */
class StreamingMCPClient {
    private activeStreams: Map<string, StreamHandler> = new Map();

    /**
     * Call a tool with streaming support
     */
    async callTool(toolName: string, args: Record<string, unknown>): Promise<void> {
        const callId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Create stream handler
        const handler = new StreamHandler(callId, toolName);
        this.activeStreams.set(callId, handler);

        // Send tool call request
        const request: MCPRequest = {
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: args
            }
        };

        console.log(`Calling tool: ${toolName}`);
        this.sendRequest(request);
    }

    /**
     * Handle incoming notification (streaming updates)
     */
    handleNotification(notification: MCPNotification): void {
        if (notification.method === 'notifications/tools/progress') {
            const params = notification.params as {
                toolCallId: string;
                chunk: string;
                metadata?: { type: 'content' | 'progress' | 'status' };
            };

            const handler = this.activeStreams.get(params.toolCallId);
            if (handler) {
                handler.handleChunk(params.chunk, params.metadata);
            }
        }
    }

    /**
     * Handle final response
     */
    handleResponse(response: MCPResponse): void {
        const callId = String(response.id);
        const handler = this.activeStreams.get(callId);
        
        if (handler) {
            handler.complete(response);
            this.activeStreams.delete(callId);
        }
    }

    private sendRequest(request: MCPRequest): void {
        // In real implementation, send via stdio or other transport
        console.log('→', JSON.stringify(request));
    }
}

/**
 * Handles streaming updates for a single tool call
 */
class StreamHandler {
    private chunks: string[] = [];
    private startTime: number;

    constructor(
        private callId: string,
        private toolName: string
    ) {
        this.startTime = Date.now();
        console.log(`\n[${this.toolName}] Started (ID: ${this.callId})`);
    }

    handleChunk(chunk: string, metadata?: { type: 'content' | 'progress' | 'status' }): void {
        this.chunks.push(chunk);
        
        const elapsed = Date.now() - this.startTime;
        const prefix = `[${this.toolName}] [${elapsed}ms]`;

        switch (metadata?.type) {
            case 'status':
                console.log(`${prefix} 📋 ${chunk.trim()}`);
                break;
            case 'progress':
                console.log(`${prefix} ⏳ ${chunk.trim()}`);
                break;
            case 'content':
                // For content, show first 50 chars
                const preview = chunk.length > 50 
                    ? chunk.substring(0, 50) + '...' 
                    : chunk;
                console.log(`${prefix} 📄 ${preview.trim()}`);
                break;
            default:
                console.log(`${prefix} ${chunk.trim()}`);
        }
    }

    complete(response: MCPResponse): void {
        const elapsed = Date.now() - this.startTime;
        const totalChunks = this.chunks.length;
        const totalBytes = this.chunks.reduce((sum, c) => sum + c.length, 0);

        console.log(`\n[${this.toolName}] Completed in ${elapsed}ms`);
        console.log(`  - Received ${totalChunks} chunks (${totalBytes} bytes)`);
        
        if (response.error) {
            console.log(`  - ❌ Error: ${response.error.message}`);
        } else {
            console.log(`  - ✅ Success`);
        }
    }
}

// =============================================================================
// USAGE EXAMPLES
// =============================================================================

async function exampleCreateFile() {
    const client = new StreamingMCPClient();

    // Create a large file - will stream content in chunks
    await client.callTool('create_file', {
        path: 'output/large-file.txt',
        content: 'x'.repeat(10000) // 10KB of content
    });

    // Expected streaming output:
    // [create_file] [0ms] 📋 Creating file: output/large-file.txt
    // [create_file] [5ms] 📋 Creating parent directories...
    // [create_file] [10ms] ⏳ Writing content (10000 bytes)...
    // [create_file] [15ms] 📄 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...
    // [create_file] [20ms] ⏳ [Progress: 10%]
    // [create_file] [25ms] 📄 xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...
    // ... continues ...
    // [create_file] [100ms] 📋 ✓ File created successfully (10000 bytes)
    // [create_file] Completed in 100ms
}

async function exampleApplyDiff() {
    const client = new StreamingMCPClient();

    // Apply multiple edits - will stream validation and application
    await client.callTool('apply_diff', {
        path: 'src/example.ts',
        description: 'Refactor function names',
        edits: [
            {
                startLine: 10,
                endLine: 12,
                oldContent: 'function oldName() {\n  return true;\n}',
                newContent: 'function newName() {\n  return true;\n}'
            },
            {
                startLine: 20,
                endLine: 22,
                oldContent: 'const x = 1;',
                newContent: 'const x = 2;'
            }
        ]
    });

    // Expected streaming output:
    // [apply_diff] [0ms] 📋 Applying 2 edit(s) to: src/example.ts
    // [apply_diff] [5ms] 📋 Description: Refactor function names
    // [apply_diff] [10ms] 📋 File has 50 lines
    // [apply_diff] [15ms] ⏳ Validating edit 1/2 (lines 10-12)...
    // [apply_diff] [20ms] 📋 ✓ Content verified
    // [apply_diff] [25ms] ⏳ Validating edit 2/2 (lines 20-22)...
    // [apply_diff] [30ms] 📋 ✓ Content verified
    // [apply_diff] [35ms] 📋 Applying edits...
    // [apply_diff] [40ms] ⏳ Edit 1/2: Lines 20-22
    // [apply_diff] [45ms] 📋 Old content:
    // [apply_diff] [50ms] 📄 const x = 1;
    // [apply_diff] [55ms] 📋 New content:
    // [apply_diff] [60ms] 📄 const x = 2;
    // ... continues for edit 2 ...
    // [apply_diff] [100ms] 📋 Committing changes...
    // [apply_diff] [110ms] 📋 ✓ Successfully applied 2 edit(s)
    // [apply_diff] Completed in 110ms
}

async function exampleWithoutStreaming() {
    const client = new StreamingMCPClient();

    // Small file - may not trigger chunked streaming
    await client.callTool('create_file', {
        path: 'output/small-file.txt',
        content: 'Hello, World!'
    });

    // Expected output (minimal streaming):
    // [create_file] [0ms] 📋 Creating file: output/small-file.txt
    // [create_file] [5ms] 📋 ✓ File created successfully (13 bytes)
    // [create_file] Completed in 5ms
}

// =============================================================================
// CLIENT INTEGRATION GUIDE
// =============================================================================

/**
 * To integrate streaming in your MCP client:
 * 
 * 1. Listen for notifications with method "notifications/tools/progress"
 * 2. Extract toolCallId, chunk, and metadata from params
 * 3. Display chunks based on metadata.type:
 *    - status: Show as status messages (e.g., in status bar)
 *    - progress: Update progress indicators (e.g., progress bar)
 *    - content: Display as content preview (e.g., in output panel)
 * 4. Continue listening until final response is received
 * 5. Clean up stream handler after completion
 * 
 * Benefits:
 * - Real-time feedback during long operations
 * - Better user experience with progress visibility
 * - Early error detection and reporting
 * - Content preview before completion
 */

export { StreamingMCPClient, StreamHandler };
