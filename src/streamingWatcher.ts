/**
 * =============================================================================
 * STREAMING WATCHER - Watches for streaming requests from MCP Bridge
 * =============================================================================
 * 
 * Monitors .vscode/.apex-streaming directory for streaming requests
 * and triggers live streaming in VS Code editor
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TokenStreamer } from './tools/tokenStreamer';

export class StreamingWatcher {
    private watcher: vscode.FileSystemWatcher | undefined;
    private workspaceRoot: vscode.Uri;

    constructor(workspaceRoot: vscode.Uri) {
        this.workspaceRoot = workspaceRoot;
    }

    /**
     * Start watching for streaming requests
     */
    public start() {
        const streamingDir = path.join(this.workspaceRoot.fsPath, '.vscode', '.apex-streaming');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(streamingDir)) {
            fs.mkdirSync(streamingDir, { recursive: true });
        }

        // Watch for new JSON files
        const pattern = new vscode.RelativePattern(streamingDir, '*.json');
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

        this.watcher.onDidCreate(async (uri) => {
            await this.handleStreamingRequest(uri);
        });

        console.log('Streaming watcher started');
    }

    /**
     * Handle a streaming request
     */
    private async handleStreamingRequest(uri: vscode.Uri) {
        try {
            // Read the request
            const content = await vscode.workspace.fs.readFile(uri);
            const request = JSON.parse(new TextDecoder().decode(content));

            // Delete the marker file
            await vscode.workspace.fs.delete(uri);

            // Handle based on action
            switch (request.action) {
                case 'create_file':
                    await this.handleCreateFile(request.data);
                    break;
                case 'apply_diff':
                    await this.handleApplyDiff(request.data);
                    break;
            }
        } catch (error) {
            console.error('Error handling streaming request:', error);
            vscode.window.showErrorMessage(`Streaming error: ${error}`);
        }
    }

    /**
     * Handle create_file with live streaming
     */
    private async handleCreateFile(data: { path: string; content: string }) {
        const { path: filePath, content } = data;
        const fileUri = vscode.Uri.joinPath(this.workspaceRoot, filePath);

        try {
            // File should already exist (created by bridge)
            // Open it in editor
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
            });

            // Stream content token by token
            const tokenStreamer = new TokenStreamer({
                wordsPerToken: 4,
                delayMs: 50,
                enableTokenStreaming: true,
            });

            let accumulatedContent = '';
            const encoder = new TextEncoder();

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Creating ${filePath}`,
                    cancellable: false,
                },
                async (progress) => {
                    progress.report({ message: 'Streaming content...' });

                    await tokenStreamer.streamWithProgress(
                        content,
                        async (chunk, metadata) => {
                            if (metadata?.type === 'token') {
                                accumulatedContent += chunk;

                                // Update editor
                                const edit = new vscode.WorkspaceEdit();
                                const fullRange = new vscode.Range(
                                    new vscode.Position(0, 0),
                                    new vscode.Position(document.lineCount, 0)
                                );
                                edit.replace(fileUri, fullRange, accumulatedContent);
                                await vscode.workspace.applyEdit(edit);

                                // Scroll to end
                                const lastLine = editor.document.lineCount - 1;
                                const lastChar = editor.document.lineAt(lastLine).text.length;
                                editor.selection = new vscode.Selection(
                                    lastLine,
                                    lastChar,
                                    lastLine,
                                    lastChar
                                );
                                editor.revealRange(
                                    new vscode.Range(lastLine, 0, lastLine, lastChar)
                                );
                            }
                        },
                        (percent) => {
                            progress.report({
                                message: `Writing content... ${percent}%`,
                                increment: 10,
                            });
                        }
                    );

                    progress.report({ message: 'Saving file...' });
                }
            );

            // Save
            await document.save();

            vscode.window.showInformationMessage(
                `✅ File created: ${filePath} (${encoder.encode(content).length} bytes)`
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error creating file: ${errorMessage}`);
        }
    }

    /**
     * Handle apply_diff with live streaming
     */
    private async handleApplyDiff(data: {
        path: string;
        edits: Array<{
            startLine: number;
            endLine: number;
            oldContent?: string;
            newContent: string;
        }>;
        description?: string;
    }) {
        const { path: filePath, edits, description } = data;
        const fileUri = vscode.Uri.joinPath(this.workspaceRoot, filePath);

        try {
            // Open file
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, {
                preview: false,
                preserveFocus: false,
            });

            const tokenStreamer = new TokenStreamer({
                wordsPerToken: 4,
                delayMs: 50,
                enableTokenStreaming: true,
            });

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Applying ${edits.length} edit(s) to ${filePath}`,
                    cancellable: false,
                },
                async (progress) => {
                    const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

                    for (let i = 0; i < sortedEdits.length; i++) {
                        const edit = sortedEdits[i];

                        progress.report({
                            message: `Edit ${i + 1}/${sortedEdits.length} (lines ${edit.startLine}-${edit.endLine})`,
                        });

                        // Highlight the range
                        const startPos = new vscode.Position(edit.startLine - 1, 0);
                        const endLine = Math.min(edit.endLine - 1, document.lineCount - 1);
                        const endChar = document.lineAt(endLine).text.length;
                        const endPos = new vscode.Position(endLine, endChar);
                        const range = new vscode.Range(startPos, endPos);

                        editor.selection = new vscode.Selection(startPos, endPos);
                        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);

                        // Wait to show selection
                        await new Promise((resolve) => setTimeout(resolve, 300));

                        // Apply edit
                        const workspaceEdit = new vscode.WorkspaceEdit();
                        workspaceEdit.replace(fileUri, range, edit.newContent);
                        await vscode.workspace.applyEdit(workspaceEdit);

                        // Wait to show change
                        await new Promise((resolve) => setTimeout(resolve, 200));
                    }

                    progress.report({ message: 'Saving changes...' });
                }
            );

            await document.save();

            vscode.window.showInformationMessage(
                `✅ Applied ${edits.length} edit(s) to ${filePath}`
            );
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Error applying diff: ${errorMessage}`);
        }
    }

    /**
     * Stop watching
     */
    public stop() {
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }
    }
}
