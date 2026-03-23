/**
 * =============================================================================
 * APEX MCP AGENT - APPLY DIFF TOOL
 * =============================================================================
 * 
 * Apply diff-based edits to files using VS Code's WorkspaceEdit API.
 * DESTRUCTIVE: Requires confirmation and supports rollback.
 * 
 * This is the ONLY way AI can modify files.
 * No full file overwrites allowed - all changes must be diff-based.
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult, RollbackEntry } from '../types';
import { TokenStreamer } from './tokenStreamer';

interface DiffEdit {
    startLine: number;    // 1-indexed
    endLine: number;      // 1-indexed (inclusive)
    oldContent: string;   // Content being replaced (for verification)
    newContent: string;   // New content
}

interface ApplyDiffParams {
    path: string;
    edits: DiffEdit[];
    dryRun?: boolean;     // If true, only validate without applying
    description?: string; // Human-readable description of changes
}

export class ApplyDiffTool extends BaseTool {
    public readonly id = 'apply_diff';
    public readonly requiresConfirmation = true;
    public readonly isDestructive = true;

    public readonly schema: MCPToolSchema = {
        name: 'apply_diff',
        description: 'Apply diff-based edits to a file. All file modifications MUST use this tool - no full file overwrites allowed. Changes are atomic and can be rolled back.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path relative to workspace root'
                },
                edits: {
                    type: 'array',
                    description: 'Array of edit operations to apply',
                    items: {
                        type: 'object',
                        properties: {
                            startLine: {
                                type: 'number',
                                description: 'Starting line number (1-indexed)'
                            },
                            endLine: {
                                type: 'number',
                                description: 'Ending line number (1-indexed, inclusive)'
                            },
                            oldContent: {
                                type: 'string',
                                description: 'Content being replaced (for verification)'
                            },
                            newContent: {
                                type: 'string',
                                description: 'New content to insert'
                            }
                        }
                    }
                },
                dryRun: {
                    type: 'boolean',
                    description: 'If true, validate changes without applying (default: false)'
                },
                description: {
                    type: 'string',
                    description: 'Human-readable description of the changes'
                }
            },
            required: ['path', 'edits']
        }
    };

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Base validation
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        // Path security validation
        const pathValidation = this.validatePath(params.path as string, 'write');
        if (!pathValidation.valid) {
            return pathValidation;
        }

        // Validate edits array
        const edits = params.edits as DiffEdit[];
        if (!Array.isArray(edits) || edits.length === 0) {
            errors.push('edits must be a non-empty array');
            return { valid: false, errors, warnings };
        }

        // Validate each edit
        for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];

            if (typeof edit.startLine !== 'number' || edit.startLine < 1) {
                errors.push(`Edit ${i}: startLine must be a number >= 1`);
            }
            if (typeof edit.endLine !== 'number' || edit.endLine < 1) {
                errors.push(`Edit ${i}: endLine must be a number >= 1`);
            }
            if (edit.startLine && edit.endLine && edit.startLine > edit.endLine) {
                errors.push(`Edit ${i}: startLine cannot be greater than endLine`);
            }
            if (typeof edit.newContent !== 'string') {
                errors.push(`Edit ${i}: newContent must be a string`);
            }
            if (edit.oldContent !== undefined && typeof edit.oldContent !== 'string') {
                errors.push(`Edit ${i}: oldContent must be a string if provided`);
            }
        }

        // Check for overlapping edits
        const sortedEdits = [...edits].sort((a, b) => a.startLine - b.startLine);
        for (let i = 0; i < sortedEdits.length - 1; i++) {
            if (sortedEdits[i].endLine >= sortedEdits[i + 1].startLine) {
                warnings.push('Overlapping edits detected - they will be applied in order');
                break;
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            sanitizedParams: errors.length === 0 ? {
                ...params,
                ...pathValidation.sanitizedParams
            } : undefined
        };
    }

    public async prepareRollback(
        params: Record<string, unknown>,
        context: ToolExecutionContext
    ): Promise<RollbackEntry | null> {
        const filePath = params.path as string;

        try {
            const fileUri = this.resolvePath(filePath);
            if (!fileUri) {
                return null;
            }

            // Read current file content for rollback
            const contentBytes = await vscode.workspace.fs.readFile(fileUri);
            const originalContent = new TextDecoder().decode(contentBytes);

            return {
                actionId: '', // Will be set by registry
                description: `Rollback changes to ${filePath}`,
                timestamp: Date.now(),
                rollbackFn: async () => {
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(fileUri, encoder.encode(originalContent));
                }
            };
        } catch {
            return null;
        }
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const filePath = params.path as string;
        const edits = params.edits as Array<{ startLine: number; endLine: number; oldContent?: string; newContent: string }>;
        const dryRun = (params.dryRun as boolean | undefined) ?? false;
        const description = params.description as string | undefined;
        const streamingCallback = context.streamingCallback;

        try {
            const fileUri = this.resolvePath(filePath);
            if (!fileUri) {
                return this.createErrorResult(`Cannot resolve path: ${filePath}`);
            }

            // Stream: Starting diff application
            if (streamingCallback) {
                streamingCallback(`Applying ${edits.length} edit(s) to: ${filePath}\n`, { type: 'status' });
                if (description) {
                    streamingCallback(`Description: ${description}\n`, { type: 'status' });
                }
            }

            // Read current file content
            let contentBytes: Uint8Array;
            try {
                contentBytes = await vscode.workspace.fs.readFile(fileUri);
            } catch {
                return this.createErrorResult(`File not found: ${filePath}`);
            }

            const originalContent = new TextDecoder().decode(contentBytes);
            const lines = originalContent.split('\n');
            const totalLines = lines.length;

            if (streamingCallback) {
                streamingCallback(`File has ${totalLines} lines\n`, { type: 'status' });
            }

            // Validate edits against actual content
            const validationErrors: string[] = [];
            for (let i = 0; i < edits.length; i++) {
                const edit = edits[i];

                if (streamingCallback) {
                    streamingCallback(`\nValidating edit ${i + 1}/${edits.length} (lines ${edit.startLine}-${edit.endLine})...\n`, { type: 'progress' });
                }

                // Check line range
                if (edit.startLine > totalLines || edit.endLine > totalLines) {
                    const error = `Edit ${i}: Line range ${edit.startLine}-${edit.endLine} exceeds file length ${totalLines}`;
                    validationErrors.push(error);
                    if (streamingCallback) {
                        streamingCallback(`✗ ${error}\n`, { type: 'status' });
                    }
                    continue;
                }

                // Verify old content matches (if provided)
                if (edit.oldContent !== undefined) {
                    const actualContent = lines.slice(edit.startLine - 1, edit.endLine).join('\n');
                    const normalizedActual = actualContent.trim();
                    const normalizedExpected = edit.oldContent.trim();

                    if (normalizedActual !== normalizedExpected) {
                        const error = `Edit ${i}: Content mismatch at lines ${edit.startLine}-${edit.endLine}`;
                        validationErrors.push(error);
                        if (streamingCallback) {
                            streamingCallback(`✗ ${error}\n`, { type: 'status' });
                            streamingCallback(`Expected:\n${edit.oldContent.substring(0, 100)}...\n`, { type: 'content' });
                            streamingCallback(`Actual:\n${actualContent.substring(0, 100)}...\n`, { type: 'content' });
                        }
                    } else if (streamingCallback) {
                        streamingCallback(`✓ Content verified\n`, { type: 'status' });
                    }
                }
            }

            if (validationErrors.length > 0) {
                return this.createErrorResult(
                    `Edit validation failed:\n${validationErrors.join('\n')}`
                );
            }

            // If dry run, return success without applying
            if (dryRun) {
                if (streamingCallback) {
                    streamingCallback(`\n✓ Dry run successful - all edits are valid\n`, { type: 'status' });
                }
                return this.createSuccessResult({
                    dryRun: true,
                    valid: true,
                    editCount: edits.length,
                    affectedLines: edits.reduce((acc, e) => acc + (e.endLine - e.startLine + 1), 0),
                    message: 'Dry run successful - changes are valid but not applied',
                    streaming: true
                });
            }

            // Sort edits by line number (descending) to avoid offset issues
            const sortedEdits = [...edits].sort((a, b) => b.startLine - a.startLine);

            if (streamingCallback) {
                streamingCallback(`\nApplying edits...\n`, { type: 'status' });
            }

            // Open the file in editor so user can see changes (like Kiro IDE)
            const document = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(document, { 
                preview: false,
                preserveFocus: false 
            });

            // Create token streamer for content streaming
            const tokenStreamer = new TokenStreamer({
                wordsPerToken: 4,
                delayMs: 50, // Slower for visible streaming
                enableTokenStreaming: true
            });

            // Show progress in status bar
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Applying ${edits.length} edit(s) to ${filePath}`,
                cancellable: false
            }, async (progress) => {

                for (let i = 0; i < sortedEdits.length; i++) {
                    const edit = sortedEdits[i];
                    
                    progress.report({ 
                        message: `Edit ${i + 1}/${sortedEdits.length} (lines ${edit.startLine}-${edit.endLine})` 
                    });

                    if (streamingCallback) {
                        streamingCallback(`\nEdit ${i + 1}/${sortedEdits.length}: Lines ${edit.startLine}-${edit.endLine}\n`, { type: 'progress' });
                        
                        // Stream old content token by token
                        streamingCallback(`Old content:\n`, { type: 'status' });
                        const oldContent = lines.slice(edit.startLine - 1, edit.endLine).join('\n');
                        await tokenStreamer.streamContent(oldContent, streamingCallback, { type: 'content' });
                        
                        // Stream new content token by token
                        streamingCallback(`\nNew content:\n`, { type: 'status' });
                        await tokenStreamer.streamContent(edit.newContent, streamingCallback, { type: 'content' });
                        streamingCallback(`\n`, { type: 'content' });
                    }

                    // Highlight the lines being changed
                    const startPos = new vscode.Position(edit.startLine - 1, 0);
                    const endPos = new vscode.Position(edit.endLine - 1, lines[edit.endLine - 1]?.length || 0);
                    const range = new vscode.Range(startPos, endPos);
                    
                    // Show the range being edited
                    editor.selection = new vscode.Selection(startPos, endPos);
                    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                    
                    // Wait a moment so user sees what's being changed
                    await new Promise(resolve => setTimeout(resolve, 300));

                    // Apply the edit with live streaming
                    const workspaceEdit = new vscode.WorkspaceEdit();
                    workspaceEdit.replace(fileUri, range, edit.newContent);
                    await vscode.workspace.applyEdit(workspaceEdit);
                    
                    // Small delay to see the change
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                progress.report({ message: 'Saving changes...' });
            });

            // Save the document
            await document.save();

            if (streamingCallback) {
                streamingCallback(`\n✓ Successfully applied ${edits.length} edit(s) to ${filePath}\n`, { type: 'status' });
            }

            // Show success message
            vscode.window.showInformationMessage(
                `✅ Applied ${edits.length} edit(s) to ${filePath}`
            );

            return this.createSuccessResult({
                path: filePath,
                editCount: edits.length,
                description: description || 'Changes applied successfully with live streaming in VS Code editor',
                appliedAt: new Date().toISOString(),
                streaming: true
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (streamingCallback) {
                streamingCallback(`\n✗ Error: ${errorMessage}\n`, { type: 'status' });
            }
            return this.createErrorResult(`Error applying diff: ${errorMessage}`);
        }
    }
}
