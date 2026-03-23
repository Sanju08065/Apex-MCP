/**
 * =============================================================================
 * APEX MCP AGENT - REQUEST USER INPUT TOOL
 * =============================================================================
 * 
 * CRITICAL TOOL: Allows the agent to request input from the user.
 * 
 * Behavior:
 * - Extension opens a VS Code input box
 * - Agent execution pauses
 * - User input is returned to AI
 * - Same session continues (no reset)
 * - If user input == "stop": session terminates immediately
 */

import * as vscode from 'vscode';
import { BaseTool } from './baseTool';
import { MCPToolSchema, ToolExecutionContext, ToolResult, ValidationResult } from '../types';
import { SessionManager } from '../session';

interface RequestUserInputParams {
    prompt: string;
    placeholder?: string;
    defaultValue?: string;
    validation?: 'none' | 'required' | 'email' | 'number';
}

export class RequestUserInputTool extends BaseTool {
    public readonly id = 'request_user_input';
    public readonly requiresConfirmation = false;
    public readonly isDestructive = false;

    private sessionManager: SessionManager | null = null;

    public readonly schema: MCPToolSchema = {
        name: 'request_user_input',
        description: 'Request input from the user. Agent execution pauses until the user provides input. If the user types "stop", the session terminates immediately. Use this when you need clarification, confirmation, or additional information from the user.',
        inputSchema: {
            type: 'object',
            properties: {
                prompt: {
                    type: 'string',
                    description: 'The question or prompt to show the user'
                },
                placeholder: {
                    type: 'string',
                    description: 'Placeholder text in the input box'
                },
                defaultValue: {
                    type: 'string',
                    description: 'Default value pre-filled in the input box'
                },
                validation: {
                    type: 'string',
                    description: 'Validation type: "none", "required", "email", "number"',
                    enum: ['none', 'required', 'email', 'number']
                }
            },
            required: ['prompt']
        }
    };

    /**
     * Set session manager (injected at registration time)
     */
    public setSessionManager(sessionManager: SessionManager): void {
        this.sessionManager = sessionManager;
    }

    public validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult {
        const baseValidation = super.validate(params, context);
        if (!baseValidation.valid) {
            return baseValidation;
        }

        const prompt = params.prompt as string;
        if (prompt.length === 0) {
            return {
                valid: false,
                errors: ['Prompt cannot be empty'],
                warnings: []
            };
        }

        if (prompt.length > 1000) {
            return {
                valid: false,
                errors: ['Prompt is too long (max 1000 characters)'],
                warnings: []
            };
        }

        return {
            valid: true,
            errors: [],
            warnings: [],
            sanitizedParams: params
        };
    }

    public async execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
        const prompt = params.prompt as string;
        const placeholder = params.placeholder as string | undefined;
        const defaultValue = params.defaultValue as string | undefined;
        const validation = (params.validation as string | undefined) ?? 'none';

        try {
            // Show input box to user
            const userInput = await vscode.window.showInputBox({
                prompt,
                placeHolder: placeholder,
                value: defaultValue,
                ignoreFocusOut: true, // Keep dialog open when focus lost
                validateInput: (value: string) => {
                    switch (validation) {
                        case 'required':
                            return value.trim().length === 0 ? 'Input is required' : null;
                        case 'email':
                            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                            return emailRegex.test(value) ? null : 'Please enter a valid email';
                        case 'number':
                            return isNaN(Number(value)) ? 'Please enter a valid number' : null;
                        default:
                            return null;
                    }
                }
            });

            // Handle cancellation (Escape pressed)
            if (userInput === undefined) {
                return this.createErrorResult('User cancelled input');
            }

            // Handle empty input with required validation
            if (validation === 'required' && userInput.trim().length === 0) {
                return this.createErrorResult('User provided empty input (required)');
            }

            // Check for stop command - this is handled at session level
            // but we also detect it here for clarity
            if (userInput.toLowerCase().trim() === 'stop') {
                return this.createSuccessResult({
                    input: userInput,
                    action: 'stop_requested',
                    message: 'User requested to stop the session'
                });
            }

            return this.createSuccessResult({
                input: userInput,
                action: 'input_received',
                prompt
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return this.createErrorResult(`Error requesting input: ${errorMessage}`);
        }
    }
}
