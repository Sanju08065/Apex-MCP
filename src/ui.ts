/**
 * =============================================================================
 * APEX MCP AGENT - ENHANCED UI COMPONENTS
 * =============================================================================
 * 
 * Professional, modern UI for autonomous AI agent control.
 * 
 * Features:
 * - Real-time agent status monitoring with visual indicators
 * - Interactive control panel with session management
 * - Comprehensive action history with timeline visualization
 * - Detailed session memory tree with metrics and insights
 * - Live event-driven updates
 * - Professional design following VS Code UX guidelines
 * 
 * Design Philosophy:
 * - Native VS Code look and feel
 * - Information density balanced with clarity
 * - Visual hierarchy for quick scanning
 * - Actionable insights, not just data dumps
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentLoopController } from './agentLoop';
import { ActionHistoryEntry, AgentEventType, SessionState } from './types';
import { SessionManager } from './session';

// IPC directory for MCP server communication
const IPC_DIR = path.join(os.tmpdir(), 'apex-mcp-ipc');

interface UserInputRequest {
    id: string;
    prompt: string;
    placeholder?: string;
    timestamp: number;
}

interface UserInputResponse {
    id: string;
    input: string | null;
    cancelled: boolean;
    timestamp: number;
}

/**
 * =============================================================================
 * AGENT CONTROL WEBVIEW PROVIDER
 * =============================================================================
 * 
 * Main control panel for the MCP agent with real-time status updates.
 */
export class AgentControlViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'apex-mcp.agentControl';

    private _view?: vscode.WebviewView;
    private mcpServerTerminal: vscode.Terminal | undefined;
    private isServerRunning: boolean = false;
    private inputWatcher: fs.FSWatcher | undefined;
    private watcherInterval: NodeJS.Timeout | undefined;
    private handledRequests: Set<string> = new Set();
    private isHandlingRequest: boolean = false;
    private statusUpdateInterval: NodeJS.Timeout | undefined;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly agentController: AgentLoopController,
        private readonly sessionManager: SessionManager
    ) {
        // Listen for terminal close events
        vscode.window.onDidCloseTerminal(terminal => {
            if (terminal === this.mcpServerTerminal) {
                this.isServerRunning = false;
                this.mcpServerTerminal = undefined;
                this.stopInputWatcher();
                this.updateView();
            }
        });

        // Listen for agent events
        const events = this.sessionManager.getEventEmitter();
        events.on(AgentEventType.SessionStarted, () => this.updateView());
        events.on(AgentEventType.SessionStopped, () => this.updateView());
        events.on(AgentEventType.SessionPaused, () => this.updateView());
        events.on(AgentEventType.SessionResumed, () => this.updateView());
        events.on(AgentEventType.ToolCallExecuted, () => this.updateView());
        events.on(AgentEventType.IntentLocked, () => this.updateView());

        this.ensureIpcDir();
    }

    private ensureIpcDir(): void {
        if (!fs.existsSync(IPC_DIR)) {
            fs.mkdirSync(IPC_DIR, { recursive: true });
        }
    }

    private startInputWatcher(): void {
        this.ensureIpcDir();
        this.watcherInterval = setInterval(() => {
            this.checkForInputRequests();
        }, 500);
    }

    private stopInputWatcher(): void {
        if (this.watcherInterval) {
            clearInterval(this.watcherInterval);
            this.watcherInterval = undefined;
        }
        if (this.inputWatcher) {
            this.inputWatcher.close();
            this.inputWatcher = undefined;
        }
    }

    private async checkForInputRequests(): Promise<void> {
        if (this.isHandlingRequest) return;
        
        try {
            if (!fs.existsSync(IPC_DIR)) return;
            
            const files = fs.readdirSync(IPC_DIR);
            const requestFiles = files.filter(f => f.startsWith('input_request_') && f.endsWith('.json'));
            
            for (const requestFile of requestFiles) {
                const requestPath = path.join(IPC_DIR, requestFile);
                const requestId = requestFile.replace('input_request_', '').replace('.json', '');
                
                if (this.handledRequests.has(requestId)) continue;
                
                try {
                    const content = fs.readFileSync(requestPath, 'utf-8');
                    const request: UserInputRequest = JSON.parse(content);
                    
                    this.handledRequests.add(requestId);
                    this.isHandlingRequest = true;
                    
                    await this.handleInputRequest(request);
                    
                    this.isHandlingRequest = false;
                    
                    if (this.handledRequests.size > 100) {
                        const arr = Array.from(this.handledRequests);
                        this.handledRequests = new Set(arr.slice(-50));
                    }
                } catch (e) {
                    this.isHandlingRequest = false;
                }
            }
        } catch (e) {
            this.isHandlingRequest = false;
        }
    }

    private async handleInputRequest(request: UserInputRequest): Promise<void> {
        const requestFile = path.join(IPC_DIR, `input_request_${request.id}.json`);
        try { fs.unlinkSync(requestFile); } catch {}
        
        const input = await vscode.window.showInputBox({
            prompt: `🤖 Agent: ${request.prompt}`,
            placeHolder: request.placeholder || 'Type your response...',
            ignoreFocusOut: true
        });

        const response: UserInputResponse = {
            id: request.id,
            input: input || null,
            cancelled: input === undefined,
            timestamp: Date.now()
        };

        const responseFile = path.join(IPC_DIR, `input_response_${request.id}.json`);
        fs.writeFileSync(responseFile, JSON.stringify(response, null, 2));
        
        if (input) {
            vscode.window.showInformationMessage(`📨 Sent: "${input.substring(0, 50)}${input.length > 50 ? '...' : ''}"`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'startServer':
                    await this.startMcpServer();
                    break;
                case 'stopServer':
                    this.stopMcpServer();
                    break;
                case 'pauseAgent':
                    this.agentController.pauseLoop();
                    this.updateView();
                    break;
                case 'resumeAgent':
                    this.agentController.resumeLoop();
                    this.updateView();
                    break;
                case 'stopAgent':
                    this.agentController.stopLoop();
                    this.updateView();
                    break;
                case 'killAgent':
                    const confirmed = await vscode.window.showWarningMessage(
                        '🚨 Emergency kill switch - terminate agent immediately?',
                        { modal: true },
                        'Kill Now'
                    );
                    if (confirmed === 'Kill Now') {
                        this.agentController.killLoop();
                        this.updateView();
                    }
                    break;
                case 'toggleReadOnly':
                    this.agentController.toggleReadOnlyMode();
                    this.updateView();
                    break;
                case 'rollback':
                    await this.agentController.rollbackLastAction();
                    this.updateView();
                    break;
                case 'getStatus':
                    this.updateView();
                    break;
            }
        });

        // Start periodic status updates
        this.statusUpdateInterval = setInterval(() => {
            this.updateView();
        }, 1000);
    }

    private async updateClaudeDesktopConfig(workspacePath: string): Promise<void> {
        try {
            const platform = process.platform;
            let configPath: string;

            if (platform === 'win32') {
                configPath = path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json');
            } else if (platform === 'darwin') {
                configPath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
            } else {
                configPath = path.join(process.env.HOME || '', '.config', 'claude', 'claude_desktop_config.json');
            }

            const serverScript = path.join(this._extensionUri.fsPath, 'out', 'mcpServerStandalone.js');

            let config: any = { mcpServers: {} };
            
            if (fs.existsSync(configPath)) {
                try {
                    const content = fs.readFileSync(configPath, 'utf-8');
                    config = JSON.parse(content);
                    if (!config.mcpServers) {
                        config.mcpServers = {};
                    }
                } catch {
                    config = { mcpServers: {} };
                }
            }

            config.mcpServers['apex-mcp-agent'] = {
                command: 'node',
                args: [serverScript, workspacePath]
            };

            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf-8');

            vscode.window.showInformationMessage(`✅ Claude Desktop configured for: ${path.basename(workspacePath)}`);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            vscode.window.showWarningMessage(`Could not update Claude Desktop config: ${msg}`);
        }
    }

    private async startMcpServer(): Promise<void> {
        if (this.isServerRunning && this.mcpServerTerminal) {
            this.mcpServerTerminal.show();
            vscode.window.showInformationMessage('MCP Server is already running');
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open. Please open a folder first.');
            return;
        }

        await this.updateClaudeDesktopConfig(workspaceFolder);

        this.mcpServerTerminal = vscode.window.createTerminal({
            name: '🤖 Apex MCP Server',
            cwd: workspaceFolder,
            iconPath: new vscode.ThemeIcon('server'),
            env: {
                NODE_ENV: 'production',
                WORKSPACE_FOLDER: workspaceFolder,
                APEX_WORKSPACE: workspaceFolder
            }
        });

        this.mcpServerTerminal.show(true);

        const serverScript = path.join(this._extensionUri.fsPath, 'out', 'mcpServerStandalone.js');
        this.mcpServerTerminal.sendText(`node "${serverScript}" "${workspaceFolder}"`);

        this.isServerRunning = true;
        this.startInputWatcher();
        this.updateView();

        vscode.window.showInformationMessage(`🚀 MCP Server started for: ${path.basename(workspaceFolder)}`);
    }

    private stopMcpServer(): void {
        if (this.mcpServerTerminal) {
            this.mcpServerTerminal.dispose();
            this.mcpServerTerminal = undefined;
        }
        this.isServerRunning = false;
        this.stopInputWatcher();
        this.handledRequests.clear();
        this.isHandlingRequest = false;
        this.updateView();
        vscode.window.showInformationMessage('⏹️ MCP Server stopped');
    }

    private updateView(): void {
        if (!this._view) return;

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'No workspace open';
        const workspaceName = vscode.workspace.workspaceFolders?.[0]?.name || '';
        const status = this.agentController.getStatus();
        const session = this.sessionManager.getSession();

        this._view.webview.postMessage({
            command: 'updateStatus',
            isServerRunning: this.isServerRunning,
            workspacePath: workspaceFolder,
            workspaceName: workspaceName,
            agentState: status.state,
            sessionId: status.sessionId,
            stepCount: status.stepCount,
            toolCallCount: status.toolCallCount,
            intent: status.intent,
            pendingInput: status.pendingInput,
            readOnlyMode: session?.readOnlyMode || false,
            consecutiveFailures: session?.consecutiveFailures || 0,
            maxSteps: session?.maxSteps || 0,
            maxToolCallsPerStep: session?.maxToolCallsPerStep || 0
        });
    }

    public dispose(): void {
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        this.stopInputWatcher();
    }

    private getHtmlContent(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>Apex MCP Agent</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 13px;
            padding: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-sideBar-background);
            line-height: 1.6;
            overflow-x: hidden;
        }
        
        /* Hero Header with Gradient */
        .hero-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 20px 16px;
            position: relative;
            overflow: hidden;
            margin: 0;
        }
        
        .hero-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: url('data:image/svg+xml,<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="1"/></pattern></defs><rect width="100" height="100" fill="url(%23grid)"/></svg>');
            opacity: 0.3;
        }
        
        .hero-content {
            position: relative;
            z-index: 1;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .hero-icon {
            width: 48px;
            height: 48px;
            background: rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 28px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
            flex-shrink: 0;
        }
        
        .hero-text h1 {
            font-size: 18px;
            font-weight: 700;
            color: white;
            margin-bottom: 2px;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }
        
        .hero-text p {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.9);
            font-weight: 500;
        }
        
        /* Main Content */
        .content {
            padding: 16px;
        }
        
        /* Status Cards with Glass Effect */
        .glass-card {
            background: rgba(255, 255, 255, 0.03);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            transition: all 0.3s ease;
        }
        
        .glass-card:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border-color: rgba(255, 255, 255, 0.12);
        }
        
        /* Status Badge with Glow */
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }
        
        .status-badge.online {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
        }
        
        .status-badge.offline {
            background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
            color: white;
        }
        
        .status-badge.active {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
            animation: pulse-glow 2s ease-in-out infinite;
        }
        
        .status-badge.paused {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
            color: white;
            box-shadow: 0 4px 16px rgba(245, 158, 11, 0.4);
        }
        
        @keyframes pulse-glow {
            0%, 100% {
                box-shadow: 0 4px 16px rgba(59, 130, 246, 0.4);
            }
            50% {
                box-shadow: 0 4px 24px rgba(59, 130, 246, 0.6);
            }
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: currentColor;
        }
        
        .status-dot.pulse {
            animation: pulse-dot 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        
        @keyframes pulse-dot {
            0%, 100% {
                opacity: 1;
                transform: scale(1);
            }
            50% {
                opacity: 0.6;
                transform: scale(1.2);
            }
        }
        
        /* Activity Feed */
        .activity-feed {
            margin-top: 16px;
        }
        
        .activity-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.02);
            border-radius: 10px;
            margin-bottom: 8px;
            border-left: 3px solid transparent;
            transition: all 0.2s ease;
        }
        
        .activity-item:hover {
            background: rgba(255, 255, 255, 0.04);
            border-left-color: #667eea;
        }
        
        .activity-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            flex-shrink: 0;
        }
        
        .activity-icon.success {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        }
        
        .activity-icon.running {
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            animation: spin 2s linear infinite;
        }
        
        .activity-icon.warning {
            background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .activity-content {
            flex: 1;
        }
        
        .activity-title {
            font-weight: 600;
            margin-bottom: 2px;
            color: var(--vscode-foreground);
        }
        
        .activity-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
        }
        
        .activity-time {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }
        
        /* Metrics Grid with Animated Numbers */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-top: 12px;
        }
        
        .metric-card {
            background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
            border: 1px solid rgba(102, 126, 234, 0.2);
            border-radius: 10px;
            padding: 12px;
            text-align: center;
            transition: all 0.3s ease;
        }
        
        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(102, 126, 234, 0.2);
        }
        
        .metric-value {
            font-size: 28px;
            font-weight: 700;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            margin-bottom: 4px;
            line-height: 1;
        }
        
        .metric-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
        }
        
        .metric-progress {
            width: 100%;
            height: 3px;
            background: rgba(102, 126, 234, 0.2);
            border-radius: 2px;
            margin-top: 6px;
            overflow: hidden;
        }
        
        .metric-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
            border-radius: 2px;
            transition: width 0.5s ease;
        }
        
        /* Intent Box with Gradient Border */
        .intent-box {
            background: rgba(59, 130, 246, 0.05);
            border: 2px solid transparent;
            background-clip: padding-box;
            border-radius: 10px;
            padding: 12px;
            margin-top: 12px;
            position: relative;
        }
        
        .intent-box::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            border-radius: 10px;
            padding: 2px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
            -webkit-mask-composite: xor;
            mask-composite: exclude;
        }
        
        .intent-title {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
        }
        
        .intent-text {
            font-size: 12px;
            line-height: 1.5;
            color: var(--vscode-foreground);
        }
        
        /* Modern Buttons */
        .btn {
            width: 100%;
            padding: 12px 20px;
            border: none;
            border-radius: 10px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            transition: all 0.3s ease;
            margin-bottom: 10px;
            font-family: inherit;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
        }
        
        .btn:active {
            transform: translateY(0);
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .btn-secondary {
            background: rgba(255, 255, 255, 0.05);
            color: var(--vscode-foreground);
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        
        .btn-danger {
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            color: white;
        }
        
        .btn-group {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            margin-bottom: 16px;
        }
        
        /* Workspace Info */
        .workspace-info {
            background: rgba(255, 255, 255, 0.02);
            border-radius: 10px;
            padding: 12px;
            margin-top: 12px;
        }
        
        .workspace-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 6px;
            font-weight: 600;
        }
        
        .workspace-path {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            color: var(--vscode-foreground);
            word-break: break-all;
            line-height: 1.4;
        }
        
        /* Alert Messages */
        .alert {
            padding: 12px 16px;
            border-radius: 10px;
            margin-bottom: 16px;
            display: flex;
            align-items: flex-start;
            gap: 10px;
            font-size: 12px;
            animation: slideIn 0.3s ease;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(-10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .alert-warning {
            background: rgba(245, 158, 11, 0.15);
            border: 1px solid rgba(245, 158, 11, 0.3);
            color: #fbbf24;
        }
        
        .alert-error {
            background: rgba(239, 68, 68, 0.15);
            border: 1px solid rgba(239, 68, 68, 0.3);
            color: #f87171;
        }
        
        .alert-icon {
            font-size: 18px;
        }
        
        .hidden {
            display: none !important;
        }
        
        /* Section Headers */
        .section-header {
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-descriptionForeground);
            margin: 24px 0 12px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .section-header::before {
            content: '';
            width: 3px;
            height: 14px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 2px;
        }
        
        /* Empty State */
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.5;
        }
        
        .empty-state-text {
            font-size: 13px;
            line-height: 1.6;
        }
    </style>
</head>
<body>
    <!-- Hero Header -->
    <div class="hero-header">
        <div class="hero-content">
            <div class="hero-icon">🤖</div>
            <div class="hero-text">
                <h1>Apex MCP Agent</h1>
                <p>Autonomous AI Coding Assistant</p>
            </div>
        </div>
    </div>
    
    <div class="content">
        <!-- Server Status -->
        <div class="glass-card">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="font-size: 14px; font-weight: 700;">MCP Server</h3>
                <div id="serverStatus" class="status-badge offline">
                    <span class="status-dot"></span>
                    <span>Offline</span>
                </div>
            </div>
            <div class="workspace-info">
                <div class="workspace-label">Workspace</div>
                <div id="workspacePath" class="workspace-path">No workspace open</div>
            </div>
        </div>
        
        <!-- Agent Status -->
        <div id="agentStatusCard" class="glass-card hidden">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <h3 style="font-size: 14px; font-weight: 700;">Agent Status</h3>
                <div id="agentStatus" class="status-badge offline">
                    <span class="status-dot"></span>
                    <span>Inactive</span>
                </div>
            </div>
            
            <!-- Intent -->
            <div id="intentBox" class="intent-box hidden">
                <div class="intent-title">🎯 Current Intent</div>
                <div class="intent-text" id="intentText"></div>
            </div>
            
            <!-- Metrics -->
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-value" id="stepCount">0</div>
                    <div class="metric-label">Steps</div>
                    <div class="metric-progress">
                        <div class="metric-progress-fill" id="stepProgress" style="width: 0%"></div>
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="toolCallCount">0</div>
                    <div class="metric-label">Tool Calls</div>
                    <div class="metric-progress">
                        <div class="metric-progress-fill" id="toolProgress" style="width: 0%"></div>
                    </div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="failureCount">0</div>
                    <div class="metric-label">Failures</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="modeText" style="font-size: 18px;">✏️</div>
                    <div class="metric-label">Mode</div>
                </div>
            </div>
            
            <!-- Activity Feed -->
            <div class="section-header">Recent Activity</div>
            <div class="activity-feed" id="activityFeed">
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <div class="empty-state-text">No activity yet<br>Agent actions will appear here</div>
                </div>
            </div>
        </div>
        
        <!-- Alerts -->
        <div id="pendingInputAlert" class="alert alert-warning hidden">
            <span class="alert-icon">⏳</span>
            <div>
                <strong>Waiting for input</strong><br>
                <span id="pendingInputText"></span>
            </div>
        </div>
        
        <div id="failureAlert" class="alert alert-error hidden">
            <span class="alert-icon">⚠️</span>
            <div>
                <strong>Failure loop detected</strong><br>
                Multiple consecutive failures. Agent paused.
            </div>
        </div>
        
        <!-- Server Controls -->
        <div id="serverControls">
            <button id="startServerBtn" class="btn btn-primary">
                <span>▶</span> Start MCP Server
            </button>
            <button id="stopServerBtn" class="btn btn-danger hidden">
                <span>⏹</span> Stop Server
            </button>
        </div>
        
        <!-- Agent Controls -->
        <div id="agentControls" class="hidden">
            <div class="btn-group">
                <button id="pauseBtn" class="btn btn-secondary">
                    <span>⏸</span> Pause
                </button>
                <button id="resumeBtn" class="btn btn-secondary hidden">
                    <span>▶</span> Resume
                </button>
                <button id="stopBtn" class="btn btn-secondary">
                    <span>⏹</span> Stop
                </button>
                <button id="killBtn" class="btn btn-danger">
                    <span>🚨</span> Kill
                </button>
            </div>
            <button id="toggleReadOnlyBtn" class="btn btn-secondary">
                <span>👁️</span> Toggle Read-Only Mode
            </button>
            <button id="rollbackBtn" class="btn btn-secondary">
                <span>↩️</span> Rollback Last Action
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // Get all UI elements
        const startServerBtn = document.getElementById('startServerBtn');
        const stopServerBtn = document.getElementById('stopServerBtn');
        const pauseBtn = document.getElementById('pauseBtn');
        const resumeBtn = document.getElementById('resumeBtn');
        const stopBtn = document.getElementById('stopBtn');
        const killBtn = document.getElementById('killBtn');
        const toggleReadOnlyBtn = document.getElementById('toggleReadOnlyBtn');
        const rollbackBtn = document.getElementById('rollbackBtn');
        
        const serverStatus = document.getElementById('serverStatus');
        const agentStatus = document.getElementById('agentStatus');
        const workspacePath = document.getElementById('workspacePath');
        const agentStatusCard = document.getElementById('agentStatusCard');
        const agentControls = document.getElementById('agentControls');
        const intentBox = document.getElementById('intentBox');
        const intentText = document.getElementById('intentText');
        const stepCount = document.getElementById('stepCount');
        const toolCallCount = document.getElementById('toolCallCount');
        const failureCount = document.getElementById('failureCount');
        const modeText = document.getElementById('modeText');
        const stepProgress = document.getElementById('stepProgress');
        const toolProgress = document.getElementById('toolProgress');
        const pendingInputAlert = document.getElementById('pendingInputAlert');
        const pendingInputText = document.getElementById('pendingInputText');
        const failureAlert = document.getElementById('failureAlert');
        const activityFeed = document.getElementById('activityFeed');
        
        // Activity tracking
        let activities = [];
        const MAX_ACTIVITIES = 5;
        
        // Button handlers
        startServerBtn.onclick = () => vscode.postMessage({ command: 'startServer' });
        stopServerBtn.onclick = () => vscode.postMessage({ command: 'stopServer' });
        pauseBtn.onclick = () => vscode.postMessage({ command: 'pauseAgent' });
        resumeBtn.onclick = () => vscode.postMessage({ command: 'resumeAgent' });
        stopBtn.onclick = () => vscode.postMessage({ command: 'stopAgent' });
        killBtn.onclick = () => vscode.postMessage({ command: 'killAgent' });
        toggleReadOnlyBtn.onclick = () => vscode.postMessage({ command: 'toggleReadOnly' });
        rollbackBtn.onclick = () => vscode.postMessage({ command: 'rollback' });
        
        // Handle status updates
        window.addEventListener('message', (event) => {
            const data = event.data;
            
            if (data.command === 'updateStatus') {
                updateServerStatus(data.isServerRunning);
                updateWorkspace(data.workspacePath, data.workspaceName);
                updateAgentStatus(data);
            }
        });
        
        function updateServerStatus(isRunning) {
            if (isRunning) {
                serverStatus.className = 'status-badge online';
                serverStatus.innerHTML = '<span class="status-dot pulse"></span><span>Online</span>';
                startServerBtn.classList.add('hidden');
                stopServerBtn.classList.remove('hidden');
            } else {
                serverStatus.className = 'status-badge offline';
                serverStatus.innerHTML = '<span class="status-dot"></span><span>Offline</span>';
                startServerBtn.classList.remove('hidden');
                stopServerBtn.classList.add('hidden');
            }
        }
        
        function updateWorkspace(path, name) {
            workspacePath.textContent = path;
            workspacePath.title = path;
        }
        
        function updateAgentStatus(data) {
            const state = data.agentState || 'inactive';
            const prevStepCount = parseInt(stepCount.textContent) || 0;
            const prevToolCount = parseInt(toolCallCount.textContent) || 0;
            
            // Show/hide agent card
            if (state !== 'inactive' && state !== 'terminated') {
                agentStatusCard.classList.remove('hidden');
                agentControls.classList.remove('hidden');
            } else {
                agentStatusCard.classList.add('hidden');
                agentControls.classList.add('hidden');
            }
            
            // Update status badge
            let statusClass = 'offline';
            let statusText = 'Inactive';
            let statusIcon = '';
            
            switch (state) {
                case 'active':
                    statusClass = 'active';
                    statusText = 'Active';
                    statusIcon = 'pulse';
                    break;
                case 'paused':
                    statusClass = 'paused';
                    statusText = 'Paused';
                    break;
                case 'waiting_for_user_input':
                    statusClass = 'paused';
                    statusText = 'Waiting';
                    break;
            }
            
            agentStatus.className = 'status-badge ' + statusClass;
            agentStatus.innerHTML = '<span class="status-dot ' + statusIcon + '"></span><span>' + statusText + '</span>';
            
            // Update intent
            if (data.intent) {
                intentBox.classList.remove('hidden');
                intentText.textContent = data.intent;
            } else {
                intentBox.classList.add('hidden');
            }
            
            // Update metrics with animation
            animateNumber(stepCount, data.stepCount || 0);
            animateNumber(toolCallCount, data.toolCallCount || 0);
            animateNumber(failureCount, data.consecutiveFailures || 0);
            
            if (data.consecutiveFailures > 0) {
                failureCount.style.color = '#f59e0b';
            } else {
                failureCount.style.color = '';
            }
            
            // Update progress bars
            const stepPercent = data.maxSteps ? (data.stepCount / data.maxSteps) * 100 : 0;
            const toolPercent = data.maxToolCallsPerStep ? (data.toolCallCount / data.maxToolCallsPerStep) * 100 : 0;
            stepProgress.style.width = Math.min(stepPercent, 100) + '%';
            toolProgress.style.width = Math.min(toolPercent, 100) + '%';
            
            // Update mode
            modeText.textContent = data.readOnlyMode ? '👁️' : '✏️';
            
            // Update alerts
            if (data.pendingInput) {
                pendingInputAlert.classList.remove('hidden');
                pendingInputText.textContent = data.pendingInput;
            } else {
                pendingInputAlert.classList.add('hidden');
            }
            
            if (data.consecutiveFailures >= 3) {
                failureAlert.classList.remove('hidden');
            } else {
                failureAlert.classList.add('hidden');
            }
            
            // Update button states
            if (state === 'paused') {
                pauseBtn.classList.add('hidden');
                resumeBtn.classList.remove('hidden');
            } else {
                pauseBtn.classList.remove('hidden');
                resumeBtn.classList.add('hidden');
            }
            
            // Track activity changes
            if (data.stepCount > prevStepCount) {
                addActivity('Step completed', 'Completed step ' + data.stepCount, 'success');
            }
            if (data.toolCallCount > prevToolCount) {
                addActivity('Tool executed', 'Tool call ' + data.toolCallCount, 'running');
            }
            if (data.consecutiveFailures > 0 && data.consecutiveFailures !== parseInt(failureCount.textContent)) {
                addActivity('Failure detected', 'Consecutive failures: ' + data.consecutiveFailures, 'warning');
            }
        }
        
        function animateNumber(element, targetValue) {
            const currentValue = parseInt(element.textContent) || 0;
            if (currentValue === targetValue) return;
            
            const duration = 500;
            const steps = 20;
            const increment = (targetValue - currentValue) / steps;
            let current = currentValue;
            let step = 0;
            
            const timer = setInterval(() => {
                step++;
                current += increment;
                element.textContent = Math.round(current);
                
                if (step >= steps) {
                    element.textContent = targetValue;
                    clearInterval(timer);
                }
            }, duration / steps);
        }
        
        function addActivity(title, description, type) {
            const activity = {
                title,
                description,
                type,
                time: new Date().toLocaleTimeString()
            };
            
            activities.unshift(activity);
            if (activities.length > MAX_ACTIVITIES) {
                activities = activities.slice(0, MAX_ACTIVITIES);
            }
            
            renderActivities();
        }
        
        function renderActivities() {
            if (activities.length === 0) {
                activityFeed.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No activity yet<br>Agent actions will appear here</div></div>';
                return;
            }
            
            activityFeed.innerHTML = activities.map(function(activity) {
                const iconClass = activity.type === 'success' ? 'success' : 
                                 activity.type === 'running' ? 'running' : 'warning';
                const icon = activity.type === 'success' ? '✓' : 
                            activity.type === 'running' ? '⟳' : '⚠';
                
                return '<div class="activity-item">' +
                    '<div class="activity-icon ' + iconClass + '">' + icon + '</div>' +
                    '<div class="activity-content">' +
                    '<div class="activity-title">' + activity.title + '</div>' +
                    '<div class="activity-desc">' + activity.description + '</div>' +
                    '<div class="activity-time">' + activity.time + '</div>' +
                    '</div></div>';
            }).join('');
        }
        
        // Request initial status
        vscode.postMessage({ command: 'getStatus' });
    </script>
</body>
</html>`;
    }
}


/**
 * =============================================================================
 * ACTION HISTORY TREE VIEW PROVIDER
 * =============================================================================
 * 
 * Comprehensive action history with detailed information and visual indicators.
 */
export class ActionHistoryTreeProvider implements vscode.TreeDataProvider<ActionTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ActionTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly agentController: AgentLoopController) {
        // Listen for action events
        const sessionManager = (agentController as any).sessionManager as SessionManager;
        const events = sessionManager.getEventEmitter();
        events.on(AgentEventType.ToolCallExecuted, () => this.refresh());
        events.on(AgentEventType.ToolCallFailed, () => this.refresh());
        events.on(AgentEventType.RollbackExecuted, () => this.refresh());
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: ActionTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: ActionTreeItem): ActionTreeItem[] {
        if (!element) {
            // Root level - show action entries
            const history = this.agentController.getActionHistory();
            
            if (history.length === 0) {
                const emptyItem = new ActionTreeItem('No actions yet', vscode.TreeItemCollapsibleState.None);
                emptyItem.iconPath = new vscode.ThemeIcon('info');
                emptyItem.contextValue = 'empty';
                return [emptyItem];
            }
            
            return history.reverse().map((action, index) => {
                const item = new ActionTreeItem(
                    `${history.length - index}. ${action.tool}`,
                    vscode.TreeItemCollapsibleState.Collapsed
                );
                
                item.description = this.getStatusDescription(action.status);
                item.tooltip = this.getTooltip(action);
                item.iconPath = this.getIcon(action.status);
                item.contextValue = 'action';
                item.actionData = action;
                
                return item;
            });
        } else if (element.actionData) {
            // Show action details
            const action = element.actionData;
            const details: ActionTreeItem[] = [];
            
            // Status
            const statusItem = new ActionTreeItem('Status', vscode.TreeItemCollapsibleState.None);
            statusItem.description = action.status.toUpperCase();
            statusItem.iconPath = this.getIcon(action.status);
            details.push(statusItem);
            
            // Timestamp
            const timeItem = new ActionTreeItem('Time', vscode.TreeItemCollapsibleState.None);
            timeItem.description = new Date(action.timestamp).toLocaleTimeString();
            timeItem.iconPath = new vscode.ThemeIcon('clock');
            details.push(timeItem);
            
            // Summary
            if (action.summary) {
                const summaryItem = new ActionTreeItem('Summary', vscode.TreeItemCollapsibleState.None);
                summaryItem.description = action.summary;
                summaryItem.iconPath = new vscode.ThemeIcon('note');
                details.push(summaryItem);
            }
            
            return details;
        }
        
        return [];
    }

    private getStatusDescription(status: string): string {
        const statusMap: Record<string, string> = {
            'success': '✓ Success',
            'failed': '✗ Failed',
            'executing': '⟳ Running',
            'pending': '○ Pending',
            'rolled_back': '↩ Rolled Back'
        };
        return statusMap[status] || status;
    }

    private getIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'success':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'executing':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
            case 'rolled_back':
                return new vscode.ThemeIcon('discard', new vscode.ThemeColor('charts.orange'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getTooltip(action: ActionHistoryEntry): string {
        const lines = [
            `Tool: ${action.tool}`,
            `Status: ${action.status}`,
            `Time: ${new Date(action.timestamp).toLocaleString()}`
        ];
        
        if (action.summary) {
            lines.push(`Summary: ${action.summary}`);
        }
        
        return lines.join('\n');
    }
}

class ActionTreeItem extends vscode.TreeItem {
    actionData?: ActionHistoryEntry;
}


/**
 * =============================================================================
 * SESSION MEMORY TREE VIEW PROVIDER
 * =============================================================================
 * 
 * Detailed session memory visualization with metrics, intent, and state.
 */
export class SessionMemoryTreeProvider implements vscode.TreeDataProvider<MemoryTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<MemoryTreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private readonly sessionManager: SessionManager) {
        // Listen for session events
        const events = this.sessionManager.getEventEmitter();
        events.on(AgentEventType.SessionStarted, () => this.refresh());
        events.on(AgentEventType.SessionStopped, () => this.refresh());
        events.on(AgentEventType.IntentLocked, () => this.refresh());
        events.on(AgentEventType.ToolCallExecuted, () => this.refresh());
    }

    public refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    public getTreeItem(element: MemoryTreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(element?: MemoryTreeItem): MemoryTreeItem[] {
        const session = this.sessionManager.getSession();
        
        if (!session) {
            const item = new MemoryTreeItem('No active session', vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('circle-slash');
            item.description = 'Start agent to begin';
            return [item];
        }

        if (!element) {
            // Root level - show main categories
            const items: MemoryTreeItem[] = [];
            
            // Session Info
            const sessionItem = new MemoryTreeItem('Session Info', vscode.TreeItemCollapsibleState.Expanded);
            sessionItem.iconPath = new vscode.ThemeIcon('info');
            sessionItem.contextValue = 'sessionInfo';
            items.push(sessionItem);
            
            // Intent
            if (session.intent) {
                const intentItem = new MemoryTreeItem('Intent', vscode.TreeItemCollapsibleState.Expanded);
                intentItem.iconPath = new vscode.ThemeIcon('target');
                intentItem.contextValue = 'intent';
                items.push(intentItem);
            }
            
            // Metrics
            const metricsItem = new MemoryTreeItem('Metrics', vscode.TreeItemCollapsibleState.Expanded);
            metricsItem.iconPath = new vscode.ThemeIcon('graph');
            metricsItem.contextValue = 'metrics';
            items.push(metricsItem);
            
            // Task Memory
            if (session.memory.taskMemory.currentGoal) {
                const taskItem = new MemoryTreeItem('Task Memory', vscode.TreeItemCollapsibleState.Expanded);
                taskItem.iconPath = new vscode.ThemeIcon('checklist');
                taskItem.contextValue = 'taskMemory';
                items.push(taskItem);
            }
            
            // Failures
            if (session.memory.failureTracking.length > 0) {
                const failuresItem = new MemoryTreeItem('Failures', vscode.TreeItemCollapsibleState.Collapsed);
                failuresItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
                failuresItem.description = `${session.memory.failureTracking.length} total`;
                failuresItem.contextValue = 'failures';
                items.push(failuresItem);
            }
            
            return items;
        }

        // Child items based on context
        switch (element.contextValue) {
            case 'sessionInfo':
                return this.getSessionInfoChildren(session);
            case 'intent':
                return this.getIntentChildren(session);
            case 'metrics':
                return this.getMetricsChildren(session);
            case 'taskMemory':
                return this.getTaskMemoryChildren(session);
            case 'failures':
                return this.getFailuresChildren(session);
            default:
                return [];
        }
    }

    private getSessionInfoChildren(session: any): MemoryTreeItem[] {
        const items: MemoryTreeItem[] = [];
        
        // Session ID
        const idItem = new MemoryTreeItem('ID', vscode.TreeItemCollapsibleState.None);
        idItem.description = session.id.substring(0, 8);
        idItem.iconPath = new vscode.ThemeIcon('key');
        items.push(idItem);
        
        // State
        const stateItem = new MemoryTreeItem('State', vscode.TreeItemCollapsibleState.None);
        stateItem.description = session.state.toUpperCase();
        stateItem.iconPath = this.getStateIcon(session.state);
        items.push(stateItem);
        
        // Created
        const createdItem = new MemoryTreeItem('Created', vscode.TreeItemCollapsibleState.None);
        createdItem.description = new Date(session.createdAt).toLocaleString();
        createdItem.iconPath = new vscode.ThemeIcon('calendar');
        items.push(createdItem);
        
        // Last Activity
        const activityItem = new MemoryTreeItem('Last Activity', vscode.TreeItemCollapsibleState.None);
        activityItem.description = new Date(session.lastActivityAt).toLocaleString();
        activityItem.iconPath = new vscode.ThemeIcon('pulse');
        items.push(activityItem);
        
        // Mode
        const modeItem = new MemoryTreeItem('Mode', vscode.TreeItemCollapsibleState.None);
        modeItem.description = session.readOnlyMode ? 'Read-Only' : 'Read-Write';
        modeItem.iconPath = new vscode.ThemeIcon(session.readOnlyMode ? 'eye' : 'edit');
        items.push(modeItem);
        
        return items;
    }

    private getIntentChildren(session: any): MemoryTreeItem[] {
        const items: MemoryTreeItem[] = [];
        const intent = session.intent;
        
        if (!intent) return items;
        
        // Summary
        const summaryItem = new MemoryTreeItem('Summary', vscode.TreeItemCollapsibleState.None);
        summaryItem.description = intent.summary;
        summaryItem.iconPath = new vscode.ThemeIcon('note');
        summaryItem.tooltip = intent.summary;
        items.push(summaryItem);
        
        // Allowed Scopes
        const scopesItem = new MemoryTreeItem('Allowed Scopes', vscode.TreeItemCollapsibleState.Collapsed);
        scopesItem.description = `${intent.allowedScopes.length} scope(s)`;
        scopesItem.iconPath = new vscode.ThemeIcon('folder');
        scopesItem.contextValue = 'scopes';
        scopesItem.scopes = intent.allowedScopes;
        items.push(scopesItem);
        
        return items;
    }

    private getMetricsChildren(session: any): MemoryTreeItem[] {
        const items: MemoryTreeItem[] = [];
        
        // Steps
        const stepsItem = new MemoryTreeItem('Steps', vscode.TreeItemCollapsibleState.None);
        stepsItem.description = `${session.stepCount} / ${session.maxSteps}`;
        stepsItem.iconPath = new vscode.ThemeIcon('layers');
        const stepPercent = (session.stepCount / session.maxSteps) * 100;
        stepsItem.tooltip = `${stepPercent.toFixed(1)}% of max steps used`;
        items.push(stepsItem);
        
        // Tool Calls
        const toolsItem = new MemoryTreeItem('Tool Calls (Current Step)', vscode.TreeItemCollapsibleState.None);
        toolsItem.description = `${session.toolCallCount} / ${session.maxToolCallsPerStep}`;
        toolsItem.iconPath = new vscode.ThemeIcon('tools');
        items.push(toolsItem);
        
        // Total Actions
        const actionsItem = new MemoryTreeItem('Total Actions', vscode.TreeItemCollapsibleState.None);
        actionsItem.description = `${session.memory.actionHistory.length}`;
        actionsItem.iconPath = new vscode.ThemeIcon('list-ordered');
        items.push(actionsItem);
        
        // Consecutive Failures
        const failuresItem = new MemoryTreeItem('Consecutive Failures', vscode.TreeItemCollapsibleState.None);
        failuresItem.description = `${session.consecutiveFailures} / ${session.failureThreshold}`;
        failuresItem.iconPath = new vscode.ThemeIcon('error');
        if (session.consecutiveFailures > 0) {
            failuresItem.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'));
        }
        items.push(failuresItem);
        
        // Rollback Stack
        const rollbackItem = new MemoryTreeItem('Rollback Stack', vscode.TreeItemCollapsibleState.None);
        rollbackItem.description = `${session.memory.rollbackStack.length} available`;
        rollbackItem.iconPath = new vscode.ThemeIcon('history');
        items.push(rollbackItem);
        
        return items;
    }

    private getTaskMemoryChildren(session: any): MemoryTreeItem[] {
        const items: MemoryTreeItem[] = [];
        const taskMemory = session.memory.taskMemory;
        
        // Current Goal
        if (taskMemory.currentGoal) {
            const goalItem = new MemoryTreeItem('Current Goal', vscode.TreeItemCollapsibleState.None);
            goalItem.description = taskMemory.currentGoal;
            goalItem.iconPath = new vscode.ThemeIcon('target');
            goalItem.tooltip = taskMemory.currentGoal;
            items.push(goalItem);
        }
        
        // Completed Steps
        const completedItem = new MemoryTreeItem('Completed Steps', vscode.TreeItemCollapsibleState.None);
        completedItem.description = `${taskMemory.completedSteps}`;
        completedItem.iconPath = new vscode.ThemeIcon('check');
        items.push(completedItem);
        
        // Pending Steps
        if (taskMemory.pendingSteps.length > 0) {
            const pendingItem = new MemoryTreeItem('Pending Steps', vscode.TreeItemCollapsibleState.Collapsed);
            pendingItem.description = `${taskMemory.pendingSteps.length} remaining`;
            pendingItem.iconPath = new vscode.ThemeIcon('list-unordered');
            pendingItem.contextValue = 'pendingSteps';
            pendingItem.pendingSteps = taskMemory.pendingSteps;
            items.push(pendingItem);
        }
        
        return items;
    }

    private getFailuresChildren(session: any): MemoryTreeItem[] {
        const failures = session.memory.failureTracking.slice(-10).reverse();
        
        return failures.map((failure: any, index: number) => {
            const item = new MemoryTreeItem(failure.tool, vscode.TreeItemCollapsibleState.None);
            item.description = failure.error.substring(0, 50);
            item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            item.tooltip = `${failure.tool}\n${failure.error}\n${new Date(failure.timestamp).toLocaleString()}`;
            return item;
        });
    }

    private getStateIcon(state: string): vscode.ThemeIcon {
        switch (state) {
            case 'active':
                return new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('testing.iconPassed'));
            case 'paused':
                return new vscode.ThemeIcon('debug-pause', new vscode.ThemeColor('charts.orange'));
            case 'waiting_for_user_input':
                return new vscode.ThemeIcon('comment', new vscode.ThemeColor('charts.blue'));
            case 'terminated':
                return new vscode.ThemeIcon('stop-circle', new vscode.ThemeColor('testing.iconFailed'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}

class MemoryTreeItem extends vscode.TreeItem {
    scopes?: string[];
    pendingSteps?: string[];
}
