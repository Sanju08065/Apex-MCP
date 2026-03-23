/**
 * =============================================================================
 * TOKEN STREAMING UTILITY
 * =============================================================================
 * 
 * Streams content token-by-token where 1 token ≈ 4 words
 * Provides real-time streaming for file operations
 */

import { StreamingCallback } from '../types';

/**
 * Token streaming configuration
 */
export interface TokenStreamConfig {
    wordsPerToken: number;      // Default: 4 words per token
    delayMs: number;             // Delay between tokens (for realistic streaming)
    enableTokenStreaming: boolean; // Enable/disable token streaming
}

const DEFAULT_CONFIG: TokenStreamConfig = {
    wordsPerToken: 4,
    delayMs: 10, // 10ms between tokens for smooth streaming
    enableTokenStreaming: true
};

/**
 * Token Streamer - streams content token by token
 */
export class TokenStreamer {
    private config: TokenStreamConfig;

    constructor(config?: Partial<TokenStreamConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Stream content token by token (1 token = ~4 words)
     */
    async streamContent(
        content: string,
        callback: StreamingCallback,
        metadata?: { type?: 'content' | 'progress' | 'status' }
    ): Promise<void> {
        if (!this.config.enableTokenStreaming) {
            // If streaming disabled, send all at once
            callback(content, { type: metadata?.type || 'content' });
            return;
        }

        const tokens = this.tokenize(content);
        const totalTokens = tokens.length;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            
            // Stream each token
            callback(token, {
                type: 'token',
                tokenIndex: i,
                totalTokens: totalTokens
            });

            // Small delay for realistic streaming
            if (i < tokens.length - 1 && this.config.delayMs > 0) {
                await this.delay(this.config.delayMs);
            }
        }
    }

    /**
     * Tokenize content into chunks of ~4 words each
     */
    private tokenize(content: string): string[] {
        const tokens: string[] = [];
        
        // Split by whitespace to get words
        const words = content.split(/(\s+)/); // Keep whitespace
        
        let currentToken = '';
        let wordCount = 0;

        for (const word of words) {
            currentToken += word;
            
            // Count non-whitespace as words
            if (word.trim().length > 0) {
                wordCount++;
            }

            // When we reach wordsPerToken, emit the token
            if (wordCount >= this.config.wordsPerToken) {
                tokens.push(currentToken);
                currentToken = '';
                wordCount = 0;
            }
        }

        // Add remaining content as final token
        if (currentToken.length > 0) {
            tokens.push(currentToken);
        }

        return tokens;
    }

    /**
     * Stream content line by line with token streaming per line
     */
    async streamLines(
        content: string,
        callback: StreamingCallback,
        options?: {
            showLineNumbers?: boolean;
            startLine?: number;
        }
    ): Promise<void> {
        const lines = content.split('\n');
        const startLine = options?.startLine || 1;

        for (let i = 0; i < lines.length; i++) {
            const lineNumber = startLine + i;
            const line = lines[i];
            
            // Show line number if requested
            if (options?.showLineNumbers) {
                callback(`${lineNumber}: `, { type: 'status' });
            }

            // Stream the line content token by token
            await this.streamContent(line, callback, { type: 'content' });
            
            // Add newline (except for last line)
            if (i < lines.length - 1) {
                callback('\n', { type: 'content' });
            }
        }
    }

    /**
     * Stream with progress updates
     */
    async streamWithProgress(
        content: string,
        callback: StreamingCallback,
        progressCallback?: (percent: number) => void
    ): Promise<void> {
        const tokens = this.tokenize(content);
        const totalTokens = tokens.length;

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            
            // Stream token
            callback(token, {
                type: 'token',
                tokenIndex: i,
                totalTokens: totalTokens
            });

            // Update progress
            const percent = Math.round(((i + 1) / totalTokens) * 100);
            if (progressCallback && (i === 0 || i === tokens.length - 1 || percent % 10 === 0)) {
                progressCallback(percent);
            }

            // Delay
            if (i < tokens.length - 1 && this.config.delayMs > 0) {
                await this.delay(this.config.delayMs);
            }
        }
    }

    /**
     * Delay helper
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Estimate token count for content
     */
    static estimateTokenCount(content: string, wordsPerToken: number = 4): number {
        const words = content.split(/\s+/).filter(w => w.trim().length > 0);
        return Math.ceil(words.length / wordsPerToken);
    }

    /**
     * Get streaming statistics
     */
    getStats(content: string): {
        totalWords: number;
        totalTokens: number;
        estimatedTimeMs: number;
    } {
        const words = content.split(/\s+/).filter(w => w.trim().length > 0);
        const tokens = this.tokenize(content);
        
        return {
            totalWords: words.length,
            totalTokens: tokens.length,
            estimatedTimeMs: tokens.length * this.config.delayMs
        };
    }
}

/**
 * Create a token streamer with default config
 */
export function createTokenStreamer(config?: Partial<TokenStreamConfig>): TokenStreamer {
    return new TokenStreamer(config);
}

/**
 * Quick helper to stream content with default settings
 */
export async function streamTokens(
    content: string,
    callback: StreamingCallback
): Promise<void> {
    const streamer = new TokenStreamer();
    await streamer.streamContent(content, callback);
}
