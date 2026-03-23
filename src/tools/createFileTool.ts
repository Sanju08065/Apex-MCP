/**
 * =============================================================================
 * APEX MCP AGENT - CREATE FILE TOOL
 * =============================================================================
 * 
 * Create new files in the workspace.
 * DESTRUCTIVE: Requires confirmation for overwriting.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult, RollbackEntry } from '../types';
import { TokenStreamer } from './tokenStreamer';

interface CreateFileParams {
    path: string;
    content: string;
    overwrite?: boolean;
}

export class CreateFileTool extends BaseTool {
    public readonly id = 'create_file';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'create_file',
        description: 'Create a new file with the specified content. Can optionally overwrite existing files. Parent directories are created automatically if they don\'t exist.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root'
                },
                content: {
                    type: 'string',
                    description: 'Content to write to the file'
                },
                overwrite: {
                    type: 'boolean',
                    description: 'Whether to overwrite if file exists (default: false)'
                }
            },
            required: ['path', 'content']
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        // Path security validation
        const pathValidation = this.validatePath(params.path as string, 'write');
        if (!pathValidation.valid) {
            return pathValidation;
        }

        // Check content is provided
        if (typeof params.content !== 'string') {
            return {
                valid: false,
                errors: ['content parameter must be a string'],
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: [],
            sanitizedParams: {
                ...params,
                ...pathValidation.sanitizedParams
            }
        };
    }

    public async prepareRollback(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<RollbackEntry | null> {
        const filePath = params.path as string;
        const fileUri = this.resolvePath(filePath);

        if (!fileUri) return null;

        // Check if file already exists (for overwrite scenario)
        try {
            const existingContent = await vscode.workspace.fs.readFile(fileUri);
            const originalContent = new TextDecoder().decode(existingContent);

            return {
                actionId: '',
                description: `Restore original content of ${filePath}`,
                timestamp: Date.now(),
                rollbackFn: async () => {
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(fileUri, encoder.encode(originalContent));
                }
            };
        } catch {
            // File doesn't exist, rollback would delete it
            return {
                actionId: '',
                description: `Delete created file ${filePath}`,
                timestamp: Date.now(),
                rollbackFn: async () => {
                    try {
                        await vscode.workspace.fs.delete(fileUri);
                    } catch {
                        // File might already be deleted
                    }
                }
            };
        }
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const filePath = params.path as string;
        const content = params.content as string;
        const overwrite = (params.overwrite as boolean | undefined) ?? false;
        const streamingCallback = context.streamingCallback;

        try {
            const fileUri = this.resolvePath(filePath);
            if (!fileUri) {
                return this.createErrorResult(`Cannot resolve path: ${filePath}`);
            }

            // Check if file exists
            let fileExists = false;
            try {
                await vscode.workspace.fs.stat(fileUri);
                fileExists = true;
            } catch {
                fileExists = false;
            }

            if (fileExists && !overwrite) {
                return this.createErrorResult(
                    `File already exists at ${filePath}. Set overwrite=true to replace it.`
                );
            }

            // Create parent directories if needed
            const parentUri = vscode.Uri.joinPath(fileUri, '..');
            try {
                await vscode.workspace.fs.stat(parentUri);
            } catch {
                await vscode.workspace.fs.createDirectory(parentUri);
            }

            // ============================================================
            // LIVE STREAMING IN VS CODE EDITOR
            // ============================================================
            
            // Step 1: Create empty file first
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(fileUri, encoder.encode(''));
            
            // Step 2: Open file in VS Code editor
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false
            });

            // Step 3: Stream content token by token INTO THE EDITOR
            const tokenStreamer = new TokenStreamer({
                wordsPerToken: 4,
                delayMs: 50, // Slower for visible streaming in editor
                enableTokenStreaming: true
            });

            let accumulatedContent = '';
            const stats = tokenStreamer.getStats(content);

            // Show progress in status bar
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Creating ${filePath}`,
                cancellable: false
            }, async (progress) => {
                
                progress.report({ message: 'Streaming content...' });

                await tokenStreamer.streamWithProgress(
                    content,
                    async (chunk, metadata) => {
                        if (metadata?.type === 'token') {
                            accumulatedContent += chunk;
                            
                            // LIVE UPDATE: Write to editor in real-time
                            const edit = new vscode.WorkspaceEdit();
                            const fullRange = new vscode.Range(
                                new vscode.Position(0, 0),
                                new vscode.Position(document.lineCount, 0)
                            );
                            edit.replace(fileUri, fullRange, accumulatedContent);
                            await vscode.workspace.applyEdit(edit);
                            
                            // Scroll to end so user sees new content
                            const lastLine = editor.document.lineCount - 1;
                            const lastChar = editor.document.lineAt(lastLine).text.length;
                            editor.selection = new vscode.Selection(lastLine, lastChar, lastLine, lastChar);
                            editor.revealRange(new vscode.Range(lastLine, 0, lastLine, lastChar));
                            
                            // Stream to client (for notifications)
                            if (streamingCallback) {
                                streamingCallback(chunk, metadata);
                            }
                        }
                    },
                    (percent) => {
                        progress.report({ 
                            message: `Writing content... ${percent}%`,
                            increment: 10
                        });
                    }
                );

                progress.report({ message: 'Saving file...' });
            });

            // Step 4: Final save
            await document.save();

            // Show success message
            vscode.window.showInformationMessage(
                `✅ File created: ${filePath} (${encoder.encode(content).length} bytes)`
            );

            return this.createSuccessResult({
                path: filePath,
                created: true,
                size: encoder.encode(content).length,
                message: `File created successfully with live streaming in VS Code editor`,
                streaming: true
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error creating file: ${errorMessage}`);
            return this.createErrorResult(`Error creating file: ${errorMessage}`);
        }
    }
}
