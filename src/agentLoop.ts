/**
 * =============================================================================
 * APEX MCP AGENT - AGENT LOOP CONTROLLER
 * =============================================================================
 * 
 * THE HEART OF THE AGENT SYSTEM
 * 
 * This controller OWNS the agent loop. The AI cannot:
 * - Loop itself
 * - Execute tools directly
 * - Assume success
 * 
 * MANDATORY LOOP BEHAVIOR:
 * while session.active:
 *   if waiting_for_user_input:
 *     pause
 *   else:
 *     send current state to AI
 *     receive proposed action
 *     validate action
 *     execute via VS Code APIs
 *     verify result
 *     respond to AI
 * 
 * FINAL PRINCIPLE:
 * The AI proposes → The extension decides → VS Code executes → 
 * Verification confirms → The user overrides
 */

import * as vscode from 'vscode';
import {
    AgentSession,
    SessionState,
    SessionIntent,
    ToolCall,
    ToolResult,
    VerificationResult,
    ConversationTurn,
    AgentEventType,
    ActionPolicy
} from './types';
import { SessionManager, AgentEventEmitter } from './session';
import { ToolRegistry } from './tools/registry';
import { SecurityManager } from './security';
import { MCPServer } from './mcpServer';

/**
 * Default action policy
 */
const DEFAULT_ACTION_POLICY: ActionPolicy = {
    allowedTools: [
        'read_file',
        'search_codebase',
        'apply_diff',
        'request_user_input',
        'run_tests'
    ],
    maxStepsPerSession: 100,
    maxToolCallsPerStep: 10,
    failureLoopThreshold: 3,
    requireConfirmation: ['apply_diff', 'run_tests'],
    readOnlyTools: ['read_file', 'search_codebase', 'request_user_input']
};

/**
 * AgentLoopController - owns and enforces the agent execution loop
 */
export class AgentLoopController {
    private readonly sessionManager: SessionManager;
    private readonly toolRegistry: ToolRegistry;
    private readonly securityManager: SecurityManager;
    private readonly mcpServer: MCPServer;
    private readonly outputChannel: vscode.OutputChannel;
    private readonly policy: ActionPolicy;

    private isLoopRunning: boolean = false;
    private loopCancellation: vscode.CancellationTokenSource | null = null;

    constructor(
        sessionManager: SessionManager,
        toolRegistry: ToolRegistry,
        securityManager: SecurityManager,
        mcpServer: MCPServer,
        policy: Partial<ActionPolicy> = {}
    ) {
        this.sessionManager = sessionManager;
        this.toolRegistry = toolRegistry;
        this.securityManager = securityManager;
        this.mcpServer = mcpServer;
        this.policy = { ...DEFAULT_ACTION_POLICY, ...policy };
        this.outputChannel = vscode.window.createOutputChannel('Apex Agent Loop');

        // Subscribe to session events
        this.subscribeToEvents();
    }

    /**
     * Subscribe to session events for automatic loop control
     */
    private subscribeToEvents(): void {
        const events = this.sessionManager.getEventEmitter();

        events.on(AgentEventType.SessionStopped, () => {
            this.stopLoop();
        });

        events.on(AgentEventType.SessionKilled, () => {
            this.killLoop();
        });

        events.on(AgentEventType.LimitReached, (event) => {
            const data = event.data as { type: string; current: number; max: number };
            this.log(`⚠️ Limit reached: ${data.type} (${data.current}/${data.max})`);
            this.pauseLoop();
            vscode.window.showWarningMessage(
                `Agent ${data.type} limit reached (${data.current}/${data.max}). Session paused.`
            );
        });

        events.on(AgentEventType.FailureLoopDetected, (event) => {
            const data = event.data as { consecutiveFailures: number };
            this.log(`🚨 Failure loop detected: ${data.consecutiveFailures} consecutive failures`);
            this.pauseLoop();
            vscode.window.showErrorMessage(
                `Agent halted: ${data.consecutiveFailures} consecutive failures detected.`
            );
        });

        events.on(AgentEventType.IntentViolation, (event) => {
            const data = event.data as { tool: string; reason: string };
            this.log(`🚫 Intent violation: ${data.tool} - ${data.reason}`);
        });
    }

    // =========================================================================
    // LOOP CONTROL
    // =========================================================================

    /**
     * Start the agent with a user request
     */
    public async startAgent(userRequest: string): Promise<void> {
        // Create new session
        const config = vscode.workspace.getConfiguration('apex-mcp');

        const session = this.sessionManager.createSession({
            maxSteps: config.get('maxStepsPerSession', 100),
            maxToolCallsPerStep: config.get('maxToolCallsPerStep', 10),
            failureThreshold: config.get('failureLoopThreshold', 3),
            readOnlyMode: config.get('readOnlyMode', false)
        });

        // Start session
        this.sessionManager.startSession();

        // Add initial user message
        this.sessionManager.addConversationTurn({
            role: 'user',
            content: userRequest,
            timestamp: Date.now()
        });

        // Start MCP server
        this.mcpServer.start();

        // Log
        this.log(`🚀 Agent started with request: ${userRequest.substring(0, 100)}...`);
        vscode.window.showInformationMessage('Agent started. Waiting for AI connection...');
    }

    /**
     * Lock the session intent (called after AI summarizes user's goal)
     */
    public lockIntent(intentSummary: string, allowedScopes: string[] = ['*']): void {
        const session = this.sessionManager.getSession();
        if (!session) {
            throw new Error('No active session');
        }

        const intent: SessionIntent = {
            summary: intentSummary,
            originalRequest: session.memory.sessionMemory[0]?.content || '',
            timestamp: Date.now(),
            allowedScopes,
            constraints: []
        };

        this.sessionManager.lockIntent(intent);
        this.log(`🔒 Intent locked: ${intentSummary}`);
    }

    /**
     * Pause the agent loop
     */
    public pauseLoop(): void {
        if (!this.isLoopRunning) return;

        this.sessionManager.pauseSession();
        this.log('⏸️ Agent loop paused');
    }

    /**
     * Resume the agent loop
     */
    public resumeLoop(): void {
        const session = this.sessionManager.getSession();
        if (!session || session.state !== SessionState.Paused) {
            return;
        }

        this.sessionManager.resumeSession();
        this.log('▶️ Agent loop resumed');
    }

    /**
     * Stop the agent loop gracefully
     */
    public stopLoop(): void {
        if (this.loopCancellation) {
            this.loopCancellation.cancel();
            this.loopCancellation = null;
        }

        this.isLoopRunning = false;
        this.sessionManager.stopSession();
        this.mcpServer.stop();

        this.log('⏹️ Agent loop stopped');
    }

    /**
     * EMERGENCY: Kill the agent immediately
     */
    public killLoop(): void {
        this.log('🚨 KILL SWITCH ACTIVATED - IMMEDIATE HALT');

        // Cancel everything
        if (this.loopCancellation) {
            this.loopCancellation.cancel();
            this.loopCancellation.dispose();
            this.loopCancellation = null;
        }

        this.isLoopRunning = false;

        // Kill session (clears all state)
        this.sessionManager.killSession();

        // Stop MCP server
        this.mcpServer.stop();

        this.log('🚨 Agent killed');
    }

    // =========================================================================
    // TOOL EXECUTION (Extension controls, not AI)
    // =========================================================================

    /**
     * Process a proposed tool call from the AI
     * This is where THE EXTENSION DECIDES, not the AI
     */
    public async processProposedAction(toolCall: ToolCall): Promise<ToolResult> {
        const session = this.sessionManager.getSession();

        if (!session) {
            return {
                success: false,
                content: [{ type: 'error', value: 'No active session' }],
                error: 'No active session'
            };
        }

        if (session.state !== SessionState.Active) {
            return {
                success: false,
                content: [{ type: 'error', value: `Session is ${session.state}, not active` }],
                error: `Session is ${session.state}`
            };
        }

        this.log(`📥 Received tool proposal: ${toolCall.name}`);

        // 1. Validate tool exists
        if (!this.toolRegistry.hasTool(toolCall.name)) {
            this.log(`❌ Unknown tool: ${toolCall.name}`);
            return {
                success: false,
                content: [{ type: 'error', value: `Unknown tool: ${toolCall.name}` }],
                error: `Unknown tool: ${toolCall.name}`
            };
        }

        // 2. Check against policy
        if (!this.policy.allowedTools.includes(toolCall.name)) {
            this.log(`❌ Tool not allowed by policy: ${toolCall.name}`);
            return {
                success: false,
                content: [{ type: 'error', value: `Tool not allowed: ${toolCall.name}` }],
                error: `Tool not allowed by policy`
            };
        }

        // 3. Check read-only mode
        if (session.readOnlyMode && !this.policy.readOnlyTools.includes(toolCall.name)) {
            this.log(`❌ Tool blocked in read-only mode: ${toolCall.name}`);
            return {
                success: false,
                content: [{ type: 'error', value: `Tool blocked in read-only mode: ${toolCall.name}` }],
                error: 'Read-only mode active'
            };
        }

        // 4. Request confirmation for destructive tools
        if (this.policy.requireConfirmation.includes(toolCall.name)) {
            const config = vscode.workspace.getConfiguration('apex-mcp');
            if (config.get('confirmDestructiveActions', true)) {
                const confirmed = await this.requestConfirmation(toolCall);
                if (!confirmed) {
                    this.log(`❌ User rejected action: ${toolCall.name}`);
                    return {
                        success: false,
                        content: [{ type: 'error', value: 'Action rejected by user' }],
                        error: 'User rejected action'
                    };
                }
            }
        }

        // 5. Get workspace root
        const workspaceRoot = this.securityManager.getWorkspaceRoot();
        if (!workspaceRoot) {
            return {
                success: false,
                content: [{ type: 'error', value: 'No workspace folder open' }],
                error: 'No workspace folder'
            };
        }

        // 6. Create execution context
        const context = {
            workspaceRoot,
            session,
            intent: session.intent!,
            token: this.loopCancellation?.token || new vscode.CancellationTokenSource().token,
            readOnlyMode: session.readOnlyMode
        };

        // 7. Execute via registry (which handles validation, execution, rollback)
        this.log(`✅ Executing: ${toolCall.name}`);
        const result = await this.toolRegistry.executeToolCall(toolCall, context);

        // 8. Verify result
        const verification = await this.verifyExecution(toolCall, result);
        if (!verification.success) {
            this.log(`⚠️ Verification failed: ${verification.reason}`);

            // Attempt rollback
            const rolledBack = await this.sessionManager.rollbackLastAction();
            if (rolledBack) {
                this.log('↩️ Action rolled back');
            }
        }

        // 9. Log completion
        this.log(`📤 Tool completed: ${toolCall.name} - ${result.success ? 'SUCCESS' : 'FAILED'}`);

        // 10. Increment step if tool call limit reached
        if (this.sessionManager.isToolCallLimitExceeded()) {
            this.sessionManager.incrementStep();
        }

        return result;
    }

    /**
     * Request user confirmation for destructive actions
     */
    private async requestConfirmation(toolCall: ToolCall): Promise<boolean> {
        const params = JSON.stringify(toolCall.parameters, null, 2);
        const message = `Allow agent to execute "${toolCall.name}"?\n\nParameters:\n${params.substring(0, 500)}`;

        const result = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            'Allow',
            'Deny'
        );

        return result === 'Allow';
    }

    /**
     * Verify tool execution succeeded
     */
    private async verifyExecution(toolCall: ToolCall, result: ToolResult): Promise<VerificationResult> {
        // For now, simple verification based on result
        // In a more sophisticated system, this would do actual file verification

        if (!result.success) {
            return {
                success: false,
                reason: result.error || 'Tool execution failed'
            };
        }

        // For file operations, verify the file state
        if (toolCall.name === 'apply_diff' && toolCall.parameters.path) {
            const uri = this.securityManager.resolvePath(toolCall.parameters.path as string);
            if (uri) {
                try {
                    await vscode.workspace.fs.stat(uri);
                    // File exists, basic verification passed
                } catch {
                    return {
                        success: false,
                        reason: 'File not found after supposed edit'
                    };
                }
            }
        }

        return { success: true };
    }

    // =========================================================================
    // USER INPUT HANDLING
    // =========================================================================

    /**
     * Request input from user (called by request_user_input tool)
     */
    public async handleUserInputRequest(prompt: string): Promise<string> {
        return this.sessionManager.requestUserInput(prompt);
    }

    /**
     * Provide user input (called from UI)
     */
    public provideUserInput(input: string): boolean {
        return this.sessionManager.provideUserInput(input);
    }

    // =========================================================================
    // STATE ACCESS
    // =========================================================================

    /**
     * Get current agent status for UI
     */
    public getStatus(): {
        state: SessionState;
        sessionId?: string;
        stepCount: number;
        toolCallCount: number;
        intent?: string;
        pendingInput?: string;
    } {
        const session = this.sessionManager.getSession();

        if (!session) {
            return {
                state: SessionState.Inactive,
                stepCount: 0,
                toolCallCount: 0
            };
        }

        return {
            state: session.state,
            sessionId: session.id,
            stepCount: session.stepCount,
            toolCallCount: session.toolCallCount,
            intent: session.intent?.summary,
            pendingInput: session.pendingUserInput?.prompt
        };
    }

    /**
     * Get action history for UI
     */
    public getActionHistory(): Array<{
        id: string;
        tool: string;
        status: string;
        timestamp: number;
        summary: string;
    }> {
        const session = this.sessionManager.getSession();
        if (!session) return [];

        return session.memory.actionHistory.map(action => ({
            id: action.id,
            tool: action.tool,
            status: action.status,
            timestamp: action.timestamp,
            summary: action.result?.success ? 'Success' : (action.result?.error || 'Pending')
        }));
    }

    /**
     * Rollback last action (called from UI)
     */
    public async rollbackLastAction(): Promise<boolean> {
        return this.sessionManager.rollbackLastAction();
    }

    /**
     * Toggle read-only mode
     */
    public toggleReadOnlyMode(): boolean {
        const session = this.sessionManager.getSession();
        if (!session) return false;

        session.readOnlyMode = !session.readOnlyMode;
        this.log(`👁️ Read-only mode: ${session.readOnlyMode ? 'ON' : 'OFF'}`);
        return session.readOnlyMode;
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopLoop();
        this.outputChannel.dispose();
    }
}
