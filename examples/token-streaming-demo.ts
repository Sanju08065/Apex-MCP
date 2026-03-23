/**
 * =============================================================================
 * TOKEN STREAMING DEMO
 * =============================================================================
 * 
 * Demonstrates real token-by-token streaming where:
 * - 1 token = approximately 4 words
 * - Content streams live as it's generated
 * - Progress updates in real-time
 */

import { TokenStreamer } from '../src/tools/tokenStreamer';
import { StreamingCallback } from '../src/types';

// =============================================================================
// DEMO 1: Basic Token Streaming
// =============================================================================

async function demo1_BasicTokenStreaming() {
    console.log('\n=== DEMO 1: Basic Token Streaming ===\n');

    const content = `
        This is a demonstration of token streaming where each token contains
        approximately four words that are streamed in real time to provide
        live feedback to the user as content is being generated or processed.
    `.trim();

    const streamer = new TokenStreamer({
        wordsPerToken: 4,
        delayMs: 50, // 50ms delay for visible streaming
        enableTokenStreaming: true
    });

    const callback: StreamingCallback = (chunk, metadata) => {
        if (metadata?.type === 'token') {
            process.stdout.write(chunk); // Write without newline
            console.log(` [Token ${metadata.tokenIndex! + 1}/${metadata.totalTokens}]`);
        }
    };

    await streamer.streamContent(content, callback);
    console.log('\n✓ Streaming complete!\n');
}

// =============================================================================
// DEMO 2: File Creation with Token Streaming
// =============================================================================

async function demo2_FileCreationStreaming() {
    console.log('\n=== DEMO 2: File Creation with Token Streaming ===\n');

    const fileContent = `
function calculateSum(a, b) {
    return a + b;
}

function calculateProduct(a, b) {
    return a * b;
}

const result = calculateSum(5, 10);
console.log('Result:', result);
    `.trim();

    const streamer = new TokenStreamer({
        wordsPerToken: 4,
        delayMs: 30,
        enableTokenStreaming: true
    });

    console.log('📝 Creating file: example.js\n');
    console.log('─'.repeat(60));

    let tokenCount = 0;
    const callback: StreamingCallback = (chunk, metadata) => {
        if (metadata?.type === 'token') {
            tokenCount++;
            process.stdout.write(chunk);
            
            // Show progress every 5 tokens
            if (tokenCount % 5 === 0) {
                const percent = Math.round((metadata.tokenIndex! / metadata.totalTokens!) * 100);
                console.log(`\n[Progress: ${percent}%]`);
            }
        }
    };

    await streamer.streamContent(fileContent, callback);
    console.log('\n' + '─'.repeat(60));
    console.log(`✓ File created! (${tokenCount} tokens streamed)\n`);
}

// =============================================================================
// DEMO 3: Diff Application with Token Streaming
// =============================================================================

async function demo3_DiffApplicationStreaming() {
    console.log('\n=== DEMO 3: Diff Application with Token Streaming ===\n');

    const oldCode = 'function oldName() { return true; }';
    const newCode = 'function newName() { return false; }';

    const streamer = new TokenStreamer({
        wordsPerToken: 4,
        delayMs: 40,
        enableTokenStreaming: true
    });

    console.log('🔄 Applying diff to file...\n');
    
    console.log('OLD CODE:');
    console.log('─'.repeat(60));
    await streamer.streamContent(oldCode, (chunk, metadata) => {
        if (metadata?.type === 'token') {
            process.stdout.write(chunk);
        }
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log('\nNEW CODE:');
    console.log('─'.repeat(60));
    
    await streamer.streamContent(newCode, (chunk, metadata) => {
        if (metadata?.type === 'token') {
            process.stdout.write(chunk);
        }
    });
    
    console.log('\n' + '─'.repeat(60));
    console.log('✓ Diff applied successfully!\n');
}

// =============================================================================
// DEMO 4: Large File with Progress Tracking
// =============================================================================

async function demo4_LargeFileStreaming() {
    console.log('\n=== DEMO 4: Large File with Progress Tracking ===\n');

    // Generate large content
    const paragraphs = [
        'The quick brown fox jumps over the lazy dog.',
        'Lorem ipsum dolor sit amet consectetur adipiscing elit.',
        'TypeScript is a strongly typed programming language that builds on JavaScript.',
        'Real-time streaming provides immediate feedback to users during operations.',
        'Token-based streaming allows for smooth progressive content delivery.'
    ];

    const largeContent = Array(20).fill(paragraphs.join(' ')).join('\n\n');

    const streamer = new TokenStreamer({
        wordsPerToken: 4,
        delayMs: 5, // Fast streaming for large content
        enableTokenStreaming: true
    });

    const stats = streamer.getStats(largeContent);
    console.log(`📊 Content Statistics:`);
    console.log(`   - Total words: ${stats.totalWords}`);
    console.log(`   - Total tokens: ${stats.totalTokens}`);
    console.log(`   - Estimated time: ${stats.estimatedTimeMs}ms\n`);

    console.log('🚀 Streaming content...\n');
    console.log('─'.repeat(60));

    let lastPercent = 0;
    const startTime = Date.now();

    await streamer.streamWithProgress(
        largeContent,
        (chunk, metadata) => {
            if (metadata?.type === 'token') {
                // Only show first 200 chars to avoid flooding console
                if (metadata.tokenIndex! < 50) {
                    process.stdout.write(chunk);
                } else if (metadata.tokenIndex === 50) {
                    console.log('\n... (streaming continues) ...');
                }
            }
        },
        (percent) => {
            if (percent !== lastPercent && percent % 20 === 0) {
                const elapsed = Date.now() - startTime;
                console.log(`\n[Progress: ${percent}%] (${elapsed}ms elapsed)`);
                lastPercent = percent;
            }
        }
    );

    const totalTime = Date.now() - startTime;
    console.log('\n' + '─'.repeat(60));
    console.log(`✓ Streaming complete in ${totalTime}ms!\n`);
}

// =============================================================================
// DEMO 5: Line-by-Line Streaming
// =============================================================================

async function demo5_LineByLineStreaming() {
    console.log('\n=== DEMO 5: Line-by-Line Token Streaming ===\n');

    const code = `import React from 'react';
import { useState } from 'react';

function Counter() {
    const [count, setCount] = useState(0);
    
    return (
        <div>
            <p>Count: {count}</p>
            <button onClick={() => setCount(count + 1)}>
                Increment
            </button>
        </div>
    );
}

export default Counter;`;

    const streamer = new TokenStreamer({
        wordsPerToken: 4,
        delayMs: 30,
        enableTokenStreaming: true
    });

    console.log('📄 Streaming file with line numbers:\n');
    console.log('─'.repeat(60));

    await streamer.streamLines(code, (chunk, metadata) => {
        process.stdout.write(chunk);
    }, {
        showLineNumbers: true,
        startLine: 1
    });

    console.log('\n' + '─'.repeat(60));
    console.log('✓ File streamed successfully!\n');
}

// =============================================================================
// DEMO 6: Real-time MCP Client Simulation
// =============================================================================

class SimulatedMCPClient {
    private activeStreams = new Map<string, StreamState>();

    async createFile(path: string, content: string) {
        const callId = `call_${Date.now()}`;
        const state = new StreamState(callId, 'create_file');
        this.activeStreams.set(callId, state);

        console.log(`\n📡 MCP Request: create_file`);
        console.log(`   Path: ${path}`);
        console.log(`   Content: ${content.length} bytes\n`);

        // Simulate streaming notifications
        const streamer = new TokenStreamer({
            wordsPerToken: 4,
            delayMs: 20,
            enableTokenStreaming: true
        });

        // Status notification
        this.handleNotification(callId, 'Creating file...\n', { type: 'status' });

        // Token streaming
        await streamer.streamWithProgress(
            content,
            (chunk, metadata) => {
                this.handleNotification(callId, chunk, metadata);
            },
            (percent) => {
                if (percent % 25 === 0) {
                    this.handleNotification(callId, `[Progress: ${percent}%]\n`, { type: 'progress' });
                }
            }
        );

        // Success notification
        this.handleNotification(callId, '\n✓ File created successfully!\n', { type: 'status' });

        // Final response
        this.handleResponse(callId, {
            success: true,
            path,
            size: content.length
        });
    }

    private handleNotification(callId: string, chunk: string, metadata?: any) {
        const state = this.activeStreams.get(callId);
        if (!state) return;

        state.addChunk(chunk, metadata);

        // Display based on type
        if (metadata?.type === 'status') {
            console.log(`[STATUS] ${chunk.trim()}`);
        } else if (metadata?.type === 'progress') {
            console.log(`[PROGRESS] ${chunk.trim()}`);
        } else if (metadata?.type === 'token') {
            process.stdout.write(chunk);
        }
    }

    private handleResponse(callId: string, result: any) {
        const state = this.activeStreams.get(callId);
        if (!state) return;

        state.complete(result);
        console.log(`\n📥 MCP Response: ${JSON.stringify(result, null, 2)}\n`);
        
        this.activeStreams.delete(callId);
    }
}

class StreamState {
    private chunks: string[] = [];
    private startTime: number;

    constructor(
        public callId: string,
        public toolName: string
    ) {
        this.startTime = Date.now();
    }

    addChunk(chunk: string, metadata?: any) {
        this.chunks.push(chunk);
    }

    complete(result: any) {
        const elapsed = Date.now() - this.startTime;
        const totalBytes = this.chunks.reduce((sum, c) => sum + c.length, 0);
        console.log(`\n📊 Stream Statistics:`);
        console.log(`   - Duration: ${elapsed}ms`);
        console.log(`   - Chunks: ${this.chunks.length}`);
        console.log(`   - Total bytes: ${totalBytes}`);
    }
}

async function demo6_MCPClientSimulation() {
    console.log('\n=== DEMO 6: MCP Client Simulation ===\n');

    const client = new SimulatedMCPClient();

    const content = `
function greet(name) {
    console.log('Hello, ' + name + '!');
}

greet('World');
    `.trim();

    await client.createFile('greeting.js', content);
}

// =============================================================================
// RUN ALL DEMOS
// =============================================================================

async function runAllDemos() {
    console.log('\n');
    console.log('═'.repeat(70));
    console.log('  TOKEN STREAMING DEMONSTRATION');
    console.log('  1 Token = ~4 Words | Live Streaming');
    console.log('═'.repeat(70));

    await demo1_BasicTokenStreaming();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo2_FileCreationStreaming();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo3_DiffApplicationStreaming();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo4_LargeFileStreaming();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo5_LineByLineStreaming();
    await new Promise(resolve => setTimeout(resolve, 1000));

    await demo6_MCPClientSimulation();

    console.log('\n');
    console.log('═'.repeat(70));
    console.log('  ALL DEMOS COMPLETE!');
    console.log('═'.repeat(70));
    console.log('\n');
}

// Run demos if executed directly
if (require.main === module) {
    runAllDemos().catch(console.error);
}

export {
    demo1_BasicTokenStreaming,
    demo2_FileCreationStreaming,
    demo3_DiffApplicationStreaming,
    demo4_LargeFileStreaming,
    demo5_LineByLineStreaming,
    demo6_MCPClientSimulation,
    runAllDemos
};
