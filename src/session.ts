/**
 * =============================================================================
 * APEX MCP AGENT - AGENT SESSION MANAGER
 * =============================================================================
 * 
 * Manages agent sessions with full state control, memory architecture,
 * and lifecycle management.
 * 
 * KEY RESPONSIBILITIES:
 * 1. Session lifecycle (create, start, pause, resume, stop, kill)
 * 2. Memory management (task, session, action history, failures)
 * 3. Intent locking and validation
 * 4. User input handling with session continuity
 * 5. Rollback stack management
 */

import * as vscode from 'vscode';
import {
    AgentSession,
    SessionState,
    SessionIntent,
    SessionMemory,
    ActionRecord,
    FailureRecord,
    RollbackEntry,
    ConversationTurn,
    TaskMemory,
    PendingUserInput,
    AgentEvent,
    AgentEventType
} from './types';

/**
 * Event emitter for agent events
 */
export class AgentEventEmitter {
    private listeners: Map<AgentEventType, Set<(event: AgentEvent) => void>> = new Map();

    public on(type: AgentEventType, listener: (event: AgentEvent) => void): vscode.Disposable {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);

        return new vscode.Disposable(() => {
            this.listeners.get(type)?.delete(listener);
        });
    }

    public emit(type: AgentEventType, data: unknown): void {
        const event: AgentEvent = {
            type,
            timestamp: Date.now(),
            data
        };

        this.listeners.get(type)?.forEach(listener => {
            try {
                listener(event);
            } catch (e) {
                console.error(`Error in event listener for ${type}:`, e);
            }
        });
    }
}

/**
 * SessionManager - owns all agent session state
 */
export class SessionManager {
    private currentSession: AgentSession | null = null;
    private readonly events: AgentEventEmitter;
    private readonly outputChannel: vscode.OutputChannel;

    constructor() {
        this.events = new AgentEventEmitter();
        this.outputChannel = vscode.window.createOutputChannel('Apex MCP Agent');
    }

    /**
     * Get event emitter for subscribing to session events
     */
    public getEventEmitter(): AgentEventEmitter {
        return this.events;
    }

    /**
     * Create a new agent session
     */
    public createSession(config: {
        maxSteps: number;
        maxToolCallsPerStep: number;
        failureThreshold: number;
        readOnlyMode: boolean;
    }): AgentSession {
        // Ensure no active session
        if (this.currentSession && this.currentSession.state !== SessionState.Terminated) {
            throw new Error('Cannot create new session while another is active');
        }

        const session: AgentSession = {
            id: uuidv4(),
            state: SessionState.Inactive,
            intent: null,
            memory: this.createEmptyMemory(),

            stepCount: 0,
            toolCallCount: 0,
            consecutiveFailures: 0,

            maxSteps: config.maxSteps,
            maxToolCallsPerStep: config.maxToolCallsPerStep,
            failureThreshold: config.failureThreshold,
            readOnlyMode: config.readOnlyMode,

            createdAt: Date.now(),
            lastActivityAt: Date.now(),

            pendingUserInput: null
        };

        this.currentSession = session;
        this.log(`Session created: ${session.id}`);

        return session;
    }

    /**
     * Start the agent session
     */
    public startSession(): void {
        this.ensureSession();

        if (this.currentSession!.state !== SessionState.Inactive) {
            throw new Error('Session must be inactive to start');
        }

        this.currentSession!.state = SessionState.Active;
        this.currentSession!.lastActivityAt = Date.now();

        this.events.emit(AgentEventType.SessionStarted, { sessionId: this.currentSession!.id });
        this.log(`Session started: ${this.currentSession!.id}`);
    }

    /**
     * Pause the agent session
     */
    public pauseSession(): void {
        this.ensureSession();

        if (this.currentSession!.state !== SessionState.Active) {
            throw new Error('Session must be active to pause');
        }

        this.currentSession!.state = SessionState.Paused;
        this.currentSession!.lastActivityAt = Date.now();

        this.events.emit(AgentEventType.SessionPaused, { sessionId: this.currentSession!.id });
        this.log(`Session paused: ${this.currentSession!.id}`);
    }

    /**
     * Resume a paused session
     */
    public resumeSession(): void {
        this.ensureSession();

        if (this.currentSession!.state !== SessionState.Paused) {
            throw new Error('Session must be paused to resume');
        }

        this.currentSession!.state = SessionState.Active;
        this.currentSession!.lastActivityAt = Date.now();

        this.events.emit(AgentEventType.SessionResumed, { sessionId: this.currentSession!.id });
        this.log(`Session resumed: ${this.currentSession!.id}`);
    }

    /**
     * Stop the session gracefully
     */
    public stopSession(): void {
        if (!this.currentSession) {
            return;
        }

        // Cancel any pending user input
        if (this.currentSession.pendingUserInput) {
            this.currentSession.pendingUserInput.reject(new Error('Session stopped'));
            if (this.currentSession.pendingUserInput.timeout) {
                clearTimeout(this.currentSession.pendingUserInput.timeout);
            }
            this.currentSession.pendingUserInput = null;
        }

        this.currentSession.state = SessionState.Terminated;
        this.currentSession.lastActivityAt = Date.now();

        this.events.emit(AgentEventType.SessionStopped, {
            sessionId: this.currentSession.id,
            stepCount: this.currentSession.stepCount,
            toolCallCount: this.currentSession.toolCallCount
        });

        this.log(`Session stopped: ${this.currentSession.id}`);
    }

    /**
     * EMERGENCY: Kill switch - immediate halt with no cleanup
     */
    public killSession(): void {
        this.log('🚨 KILL SWITCH ACTIVATED');

        if (!this.currentSession) {
            return;
        }

        // Immediate state change
        this.currentSession.state = SessionState.Terminated;

        // Cancel pending input
        if (this.currentSession.pendingUserInput) {
            this.currentSession.pendingUserInput.reject(new Error('Emergency kill switch activated'));
            if (this.currentSession.pendingUserInput.timeout) {
                clearTimeout(this.currentSession.pendingUserInput.timeout);
            }
        }

        // Clear memory to prevent any further access
        this.currentSession.memory = this.createEmptyMemory();

        this.events.emit(AgentEventType.SessionKilled, {
            sessionId: this.currentSession.id
        });

        vscode.window.showWarningMessage('🚨 Agent session killed immediately');
        this.log('🚨 Session killed: ' + this.currentSession.id);
    }

    /**
     * Get the current session (if any)
     */
    public getSession(): AgentSession | null {
        return this.currentSession;
    }

    /**
     * Check if session is active
     */
    public isActive(): boolean {
        return this.currentSession?.state === SessionState.Active;
    }

    /**
     * Lock session intent - this defines the scope of all actions
     */
    public lockIntent(intent: SessionIntent): void {
        this.ensureSession();

        if (this.currentSession!.intent !== null) {
            throw new Error('Intent already locked for this session. Cannot change mid-session.');
        }

        this.currentSession!.intent = intent;
        this.events.emit(AgentEventType.IntentLocked, { intent });
        this.log(`Intent locked: ${intent.summary}`);
    }

    /**
     * Validate an action against the session intent
     */
    public validateAgainstIntent(toolName: string, params: Record<string, unknown>): boolean {
        this.ensureSession();

        const intent = this.currentSession!.intent;
        if (!intent) {
            // No intent locked = allow (first action should lock intent)
            return true;
        }

        // Check if action is in allowed scope
        if (params.path && typeof params.path === 'string') {
            const pathInScope = intent.allowedScopes.some(scope => {
                const normalizedPath = params.path as string;
                return normalizedPath.startsWith(scope) || scope === '*';
            });

            if (!pathInScope && intent.allowedScopes.length > 0) {
                this.events.emit(AgentEventType.IntentViolation, {
                    tool: toolName,
                    params,
                    intent,
                    reason: 'Path outside allowed scope'
                });
                return false;
            }
        }

        return true;
    }

    // =========================================================================
    // MEMORY MANAGEMENT
    // =========================================================================

    /**
     * Add a conversation turn to memory
     */
    public addConversationTurn(turn: ConversationTurn): void {
        this.ensureSession();
        this.currentSession!.memory.sessionMemory.push(turn);
        this.currentSession!.lastActivityAt = Date.now();
    }

    /**
     * Record an action
     */
    public recordAction(action: ActionRecord): void {
        this.ensureSession();
        this.currentSession!.memory.actionHistory.push(action);
        this.currentSession!.toolCallCount++;
        this.currentSession!.lastActivityAt = Date.now();
    }

    /**
     * Update an action record
     */
    public updateAction(actionId: string, updates: Partial<ActionRecord>): void {
        this.ensureSession();
        const action = this.currentSession!.memory.actionHistory.find(a => a.id === actionId);
        if (action) {
            Object.assign(action, updates);
        }
    }

    /**
     * Record a failure
     */
    public recordFailure(failure: FailureRecord): void {
        this.ensureSession();
        this.currentSession!.memory.failureTracking.push(failure);
        this.currentSession!.consecutiveFailures++;

        // Check for failure loop
        if (this.currentSession!.consecutiveFailures >= this.currentSession!.failureThreshold) {
            this.events.emit(AgentEventType.FailureLoopDetected, {
                consecutiveFailures: this.currentSession!.consecutiveFailures,
                threshold: this.currentSession!.failureThreshold,
                recentFailures: this.currentSession!.memory.failureTracking.slice(-5)
            });
        }
    }

    /**
     * Reset consecutive failure count (on successful action)
     */
    public resetFailureCount(): void {
        if (this.currentSession) {
            this.currentSession.consecutiveFailures = 0;
        }
    }

    /**
     * Add rollback entry
     */
    public addRollback(entry: RollbackEntry): void {
        this.ensureSession();
        this.currentSession!.memory.rollbackStack.push(entry);
    }

    /**
     * Execute rollback for most recent action
     */
    public async rollbackLastAction(): Promise<boolean> {
        this.ensureSession();

        const rollbackEntry = this.currentSession!.memory.rollbackStack.pop();
        if (!rollbackEntry) {
            this.log('No rollback available');
            return false;
        }

        try {
            await rollbackEntry.rollbackFn();

            // Update action record
            this.updateAction(rollbackEntry.actionId, { status: 'rolled_back' });

            this.events.emit(AgentEventType.RollbackExecuted, {
                actionId: rollbackEntry.actionId,
                description: rollbackEntry.description
            });

            this.log(`Rolled back: ${rollbackEntry.description}`);
            return true;
        } catch (e) {
            this.log(`Rollback failed: ${e instanceof Error ? e.message : String(e)}`);
            return false;
        }
    }

    /**
     * Increment step counter
     */
    public incrementStep(): void {
        this.ensureSession();
        this.currentSession!.stepCount++;
        this.currentSession!.toolCallCount = 0; // Reset per-step counter

        // Check step limit
        if (this.currentSession!.stepCount >= this.currentSession!.maxSteps) {
            this.events.emit(AgentEventType.LimitReached, {
                type: 'steps',
                current: this.currentSession!.stepCount,
                max: this.currentSession!.maxSteps
            });
        }
    }

    /**
     * Check if tool call limit exceeded for current step
     */
    public isToolCallLimitExceeded(): boolean {
        if (!this.currentSession) return true;
        return this.currentSession.toolCallCount >= this.currentSession.maxToolCallsPerStep;
    }

    /**
     * Check if step limit exceeded
     */
    public isStepLimitExceeded(): boolean {
        if (!this.currentSession) return true;
        return this.currentSession.stepCount >= this.currentSession.maxSteps;
    }

    /**
     * Check if failure loop detected
     */
    public isFailureLoopDetected(): boolean {
        if (!this.currentSession) return false;
        return this.currentSession.consecutiveFailures >= this.currentSession.failureThreshold;
    }

    // =========================================================================
    // USER INPUT HANDLING
    // =========================================================================

    /**
     * Request user input (pauses session until input received)
     */
    public async requestUserInput(prompt: string, timeoutMs: number = 300000): Promise<string> {
        this.ensureSession();

        // Set state to waiting
        const previousState = this.currentSession!.state;
        this.currentSession!.state = SessionState.WaitingForUserInput;

        this.events.emit(AgentEventType.UserInputRequested, { prompt });

        return new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.currentSession!.pendingUserInput = null;
                this.currentSession!.state = previousState;
                reject(new Error('User input timed out'));
            }, timeoutMs);

            this.currentSession!.pendingUserInput = {
                prompt,
                resolve: (value: string) => {
                    clearTimeout(timeout);
                    this.currentSession!.pendingUserInput = null;
                    this.currentSession!.state = SessionState.Active;

                    // Check for stop command
                    if (value.toLowerCase().trim() === 'stop') {
                        this.stopSession();
                        reject(new Error('User requested stop'));
                        return;
                    }

                    this.events.emit(AgentEventType.UserInputReceived, { input: value });
                    resolve(value);
                },
                reject: (reason: Error) => {
                    clearTimeout(timeout);
                    this.currentSession!.pendingUserInput = null;
                    this.currentSession!.state = previousState;
                    reject(reason);
                },
                timeout
            };
        });
    }

    /**
     * Provide user input (called from UI)
     */
    public provideUserInput(input: string): boolean {
        if (!this.currentSession?.pendingUserInput) {
            return false;
        }

        this.currentSession.pendingUserInput.resolve(input);
        return true;
    }

    /**
     * Cancel pending user input
     */
    public cancelUserInput(reason: string = 'Cancelled by user'): boolean {
        if (!this.currentSession?.pendingUserInput) {
            return false;
        }

        this.currentSession.pendingUserInput.reject(new Error(reason));
        return true;
    }

    // =========================================================================
    // MEMORY SUMMARIES (for AI consumption)
    // =========================================================================

    /**
     * Get summarized memory for AI (never raw state)
     */
    public getMemorySummary(): Record<string, unknown> {
        if (!this.currentSession) {
            return { error: 'No active session' };
        }

        const memory = this.currentSession.memory;

        return {
            intent: this.currentSession.intent?.summary ?? null,
            currentGoal: memory.taskMemory.currentGoal,
            completedSteps: memory.taskMemory.completedSteps,
            pendingSteps: memory.taskMemory.pendingSteps.slice(0, 5),
            recentActions: memory.actionHistory.slice(-10).map(a => ({
                tool: a.tool,
                status: a.status,
                timestamp: a.timestamp
            })),
            recentFailures: memory.failureTracking.slice(-3).map(f => ({
                tool: f.tool,
                error: f.error,
                timestamp: f.timestamp
            })),
            stepCount: this.currentSession.stepCount,
            toolCallCount: this.currentSession.toolCallCount
        };
    }

    /**
     * Get conversation history for context (truncated)
     */
    public getConversationContext(maxTurns: number = 10): ConversationTurn[] {
        if (!this.currentSession) {
            return [];
        }
        return this.currentSession.memory.sessionMemory.slice(-maxTurns);
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private ensureSession(): void {
        if (!this.currentSession) {
            throw new Error('No active session');
        }
    }

    private createEmptyMemory(): SessionMemory {
        return {
            taskMemory: {
                currentGoal: '',
                subGoals: [],
                completedSteps: 0,
                pendingSteps: [],
                context: new Map()
            },
            sessionMemory: [],
            actionHistory: [],
            failureTracking: [],
            rollbackStack: []
        };
    }

    private log(message: string): void {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopSession();
        this.outputChannel.dispose();
    }
}

// Simple UUID generator if uuid package not available
function uuidv4(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
