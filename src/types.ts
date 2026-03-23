/**
 * =============================================================================
 * APEX MCP AGENT - TYPE DEFINITIONS
 * =============================================================================
 * 
 * Core type definitions for the MCP server, agent system, and tools.
 * All types enforce the security-first, user-controllable design.
 * 
 * DESIGN PRINCIPLE:
 * The AI proposes → The extension decides → VS Code executes → Verification confirms → User overrides
 */

import * as vscode from 'vscode';

// =============================================================================
// SESSION & STATE TYPES
// =============================================================================

/**
 * Session state enumeration - the agent can only be in one state at a time
 */
export enum SessionState {
    Inactive = 'inactive',
    Active = 'active',
    Paused = 'paused',
    WaitingForUserInput = 'waiting_for_user_input',
    Terminated = 'terminated'
}

/**
 * Intent represents the user's goal for this session.
 * All actions are validated against this intent to prevent scope creep.
 */
export interface SessionIntent {
    summary: string;           // AI-generated summary of user's goal
    originalRequest: string;   // The original user request
    timestamp: number;
    allowedScopes: string[];   // Paths/patterns the intent allows modifying
    constraints: string[];     // Explicit constraints from user
}

/**
 * Memory architecture - extension-owned state
 */
export interface SessionMemory {
    taskMemory: TaskMemory;           // Current request state
    sessionMemory: ConversationTurn[]; // Multi-step continuity
    actionHistory: ActionRecord[];     // All executed actions
    failureTracking: FailureRecord[];  // Failure history for loop detection
    rollbackStack: RollbackEntry[];    // For atomic rollback
}

export interface TaskMemory {
    currentGoal: string;
    subGoals: SubGoal[];
    completedSteps: number;
    pendingSteps: string[];
    context: Map<string, unknown>;
}

export interface SubGoal {
    id: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    dependencies: string[];
}

export interface ConversationTurn {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    timestamp: number;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
}

export interface ActionRecord {
    id: string;
    tool: string;
    parameters: Record<string, unknown>;
    timestamp: number;
    status: 'pending' | 'executing' | 'success' | 'failed' | 'rolled_back';
    result?: ToolResult;
    verificationResult?: VerificationResult;
    durationMs?: number;
}

export interface FailureRecord {
    timestamp: number;
    tool: string;
    error: string;
    parameters?: Record<string, unknown>;
}

export interface RollbackEntry {
    actionId: string;
    rollbackFn: () => Promise<void>;
    description: string;
    timestamp: number;
}

// =============================================================================
// TOOL TYPES
// =============================================================================

/**
 * MCP Tool Schema - JSON Schema compliant
 */
export interface MCPToolSchema {
    name: string;
    description: string;
    inputSchema: {
        type: 'object';
        properties: Record<string, MCPPropertySchema>;
        required?: string[];
        additionalProperties?: boolean;
    };
}

export interface MCPPropertySchema {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    enum?: string[];
    items?: MCPPropertySchema | Record<string, unknown>;
    properties?: Record<string, MCPPropertySchema | Record<string, unknown>>;
    default?: unknown;
    required?: string[];
}

/**
 * Tool invocation request from AI
 */
export interface ToolCall {
    id: string;
    name: string;
    parameters: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
    success: boolean;
    content: ToolResultContent[];
    error?: string;
    metadata?: Record<string, unknown>;
    streaming?: boolean; // Indicates if this result supports streaming
}

export interface ToolResultContent {
    type: 'text' | 'json' | 'diff' | 'error';
    value: string | Record<string, unknown>;
}

/**
 * Streaming callback for progressive content delivery
 * Token streaming: ~4 words per token for real-time streaming
 */
export type StreamingCallback = (chunk: string, metadata?: { 
    type: 'content' | 'progress' | 'status' | 'token';
    tokenIndex?: number;
    totalTokens?: number;
}) => void;

/**
 * Tool execution context - passed to every tool
 */
export interface ToolExecutionContext {
    workspaceRoot: vscode.Uri;
    session: AgentSession;
    intent: SessionIntent;
    token: vscode.CancellationToken;
    readOnlyMode: boolean;
    streamingCallback?: StreamingCallback; // Optional callback for streaming content
}

/**
 * Tool interface - all tools must implement this
 */
export interface ITool {
    readonly id: string;
    readonly schema: MCPToolSchema;
    readonly requiresConfirmation: boolean;
    readonly isDestructive: boolean;

    /**
     * Validate parameters before execution
     */
    validate(params: Record<string, unknown>, context: ToolExecutionContext): ValidationResult;

    /**
     * Execute the tool
     */
    execute(params: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;

    /**
     * Prepare rollback data before execution (if applicable)
     */
    prepareRollback?(params: Record<string, unknown>, context: ToolExecutionContext): Promise<RollbackEntry | null>;
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    sanitizedParams?: Record<string, unknown>;
}

// =============================================================================
// VERIFICATION TYPES
// =============================================================================

export interface VerificationResult {
    success: boolean;
    reason?: string;
    affectedFiles?: string[];
    changes?: FileChange[];
}

export interface FileChange {
    path: string;
    type: 'created' | 'modified' | 'deleted';
    before?: string;
    after?: string;
}

// =============================================================================
// AGENT SESSION TYPES
// =============================================================================

export interface AgentSession {
    id: string;
    state: SessionState;
    intent: SessionIntent | null;
    memory: SessionMemory;

    // Counters and limits
    stepCount: number;
    toolCallCount: number;
    consecutiveFailures: number;

    // Configuration
    maxSteps: number;
    maxToolCallsPerStep: number;
    failureThreshold: number;
    readOnlyMode: boolean;

    // Timestamps
    createdAt: number;
    lastActivityAt: number;

    // User interaction
    pendingUserInput: PendingUserInput | null;
}

export interface PendingUserInput {
    prompt: string;
    resolve: (value: string) => void;
    reject: (reason: Error) => void;
    timeout?: NodeJS.Timeout;
}

// =============================================================================
// MCP PROTOCOL TYPES
// =============================================================================

/**
 * MCP Message types following the Model Context Protocol specification
 */
export interface MCPRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

export interface MCPResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: MCPError;
}

export interface MCPError {
    code: number;
    message: string;
    data?: unknown;
}

export interface MCPNotification {
    jsonrpc: '2.0';
    method: string;
    params?: Record<string, unknown>;
}

/**
 * MCP Server capabilities
 */
export interface MCPServerCapabilities {
    tools?: {
        listChanged?: boolean;
    };
    resources?: {
        subscribe?: boolean;
        listChanged?: boolean;
    };
    prompts?: {
        listChanged?: boolean;
    };
    logging?: Record<string, never>;
}

/**
 * MCP Initialize result
 */
export interface MCPInitializeResult {
    protocolVersion: string;
    capabilities: MCPServerCapabilities;
    serverInfo: {
        name: string;
        version: string;
    };
}

// =============================================================================
// POLICY & SECURITY TYPES
// =============================================================================

/**
 * Security policy for workspace access
 */
export interface SecurityPolicy {
    blockedPaths: string[];
    blockedPatterns: RegExp[];
    maxFileSize: number;
    allowedExtensions?: string[];
    blockedExtensions: string[];
    preventSymlinkEscape: boolean;
    requireWorkspaceScope: boolean;
}

/**
 * Action policy for intent validation
 */
export interface ActionPolicy {
    allowedTools: string[];
    maxStepsPerSession: number;
    maxToolCallsPerStep: number;
    failureLoopThreshold: number;
    requireConfirmation: string[];
    readOnlyTools: string[];
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export interface AgentEvent {
    type: AgentEventType;
    timestamp: number;
    data: unknown;
}

export enum AgentEventType {
    SessionStarted = 'session_started',
    SessionPaused = 'session_paused',
    SessionResumed = 'session_resumed',
    SessionStopped = 'session_stopped',
    SessionKilled = 'session_killed',

    ToolCallRequested = 'tool_call_requested',
    ToolCallValidated = 'tool_call_validated',
    ToolCallRejected = 'tool_call_rejected',
    ToolCallExecuted = 'tool_call_executed',
    ToolCallFailed = 'tool_call_failed',

    VerificationPassed = 'verification_passed',
    VerificationFailed = 'verification_failed',
    RollbackExecuted = 'rollback_executed',

    UserInputRequested = 'user_input_requested',
    UserInputReceived = 'user_input_received',

    IntentLocked = 'intent_locked',
    IntentViolation = 'intent_violation',

    LimitReached = 'limit_reached',
    FailureLoopDetected = 'failure_loop_detected',

    Error = 'error'
}

// =============================================================================
// UI TYPES
// =============================================================================

export interface AgentStatusUpdate {
    state: SessionState;
    sessionId?: string;
    stepCount: number;
    toolCallCount: number;
    lastAction?: string;
    intent?: string;
    pendingInput?: string;
}

export interface ActionHistoryEntry {
    id: string;
    tool: string;
    status: string;
    timestamp: number;
    summary: string;
}
