/**
 * =============================================================================
 * APEX MCP AGENT - VS CODE EXTENSION ENTRY POINT
 * =============================================================================
 * 
 * Main extension activation and deactivation WITH LICENSING.
 * This file will be encrypted in the bundle.
 */

import * as vscode from 'vscode';

// Core imports
import { initializeSecurityManager, SecurityManager } from './security';
import { SessionManager } from './session';
import { createToolRegistry, ToolRegistry } from './tools';
import { MCPServer } from './mcpServer';
import { AgentLoopController } from './agentLoop';

// UI imports
import {
    AgentControlViewProvider,
    ActionHistoryTreeProvider,
    SessionMemoryTreeProvider
} from './ui';

// Licensing imports
import {
    LicenseValidator,
    LicenseStatus,
    ActivationUI,
    CryptoLock,
    IntegrityChecker
} from './licensing';

// Global instances
let securityManager: SecurityManager;
let sessionManager: SessionManager;
let toolRegistry: ToolRegistry;
let mcpServer: MCPServer;
let agentController: AgentLoopController;
let licenseValidator: LicenseValidator;
let activationUI: ActivationUI;
let cryptoLock: CryptoLock;
let integrityChecker: IntegrityChecker;
let mainExtensionActivated = false;

/**
 * Main extension activation (with licensing check)
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    try {
        console.log('[Apex] Starting activation...');
        
        // Initialize integrity checker
        integrityChecker = IntegrityChecker.getInstance();
        if (integrityChecker.isTampered()) {
            throw new Error('Code integrity violation detected');
        }
        
        // Initialize crypto-lock
        cryptoLock = CryptoLock.getInstance();
        
        // Initialize licensing
        licenseValidator = LicenseValidator.getInstance();
        activationUI = ActivationUI.getInstance();
        
        // Check license status
        const licenseState = await licenseValidator.initialize();
        console.log('[Apex] License status:', licenseState.status);

        if (licenseState.status !== LicenseStatus.Valid) {
            console.log('[Apex] License not valid, showing activation UI');
            
            // Show activation UI
            await activationUI.show(context);
            
            // Register command to check activation status
            const checkActivationCommand = vscode.commands.registerCommand('apex-mcp.checkActivation', async () => {
                const newState = licenseValidator.getCurrentState();
                if (newState && newState.status === LicenseStatus.Valid && !mainExtensionActivated) {
                    console.log('[Apex] License now valid, activating main extension');
                    
                    // Initialize crypto-lock with license data
                    const deviceId = await (await import('./licensing/device-fingerprint')).DeviceFingerprint.getInstance().getDeviceId();
                    const activation = await (await import('./licensing/hidden-storage')).HiddenStorage.getInstance().loadActivation();
                    if (activation) {
                        cryptoLock.initialize(activation.licenseKey, deviceId);
                    }
                    
                    await activateMainExtension(context);
                }
            });
            context.subscriptions.push(checkActivationCommand);
            
            // Poll for activation every 2 seconds
            const pollInterval = setInterval(async () => {
                const currentState = licenseValidator.getCurrentState();
                if (currentState && currentState.status === LicenseStatus.Valid && !mainExtensionActivated) {
                    clearInterval(pollInterval);
                    console.log('[Apex] License activated, loading main extension');
                    
                    // Initialize crypto-lock with license data
                    const { DeviceFingerprint } = await import('./licensing/device-fingerprint');
                    const { HiddenStorage } = await import('./licensing/hidden-storage');
                    const deviceId = await DeviceFingerprint.getInstance().getDeviceId();
                    const activation = await HiddenStorage.getInstance().loadActivation();
                    if (activation) {
                        cryptoLock.initialize(activation.licenseKey, deviceId);
                    }
                    
                    await activateMainExtension(context);
                }
            }, 2000);
            
            // Stop polling after 5 minutes
            setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
            
            return;
        }

        // License is valid, initialize crypto-lock and load main extension
        console.log('[Apex] License valid, activating main extension');
        const { DeviceFingerprint } = await import('./licensing/device-fingerprint');
        const { HiddenStorage } = await import('./licensing/hidden-storage');
        const deviceId = await DeviceFingerprint.getInstance().getDeviceId();
        const activation = await HiddenStorage.getInstance().loadActivation();
        if (activation) {
            cryptoLock.initialize(activation.licenseKey, deviceId);
        }
        
        await activateMainExtension(context);
        
    } catch (error) {
        console.error('[Apex] Activation error:', error);
        vscode.window.showErrorMessage(
            `Failed to activate Apex MCP Agent: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

/**
 * Activate main extension features
 */
async function activateMainExtension(context: vscode.ExtensionContext): Promise<void> {
    if (mainExtensionActivated) {
        console.log('[Apex] Main extension already activated');
        return;
    }
    
    // Verify crypto-lock is initialized
    try {
        cryptoLock.getToken(); // Will throw if not initialized
    } catch (error) {
        throw new Error('Crypto-lock not initialized - license required');
    }
    
    console.log('Apex MCP Agent is now active');

    // Initialize core components
    initializeCoreComponents(context);

    // Register commands
    registerCommands(context);

    // Register views
    registerViews(context);

    // Register configuration listeners
    registerConfigurationListeners(context);

    mainExtensionActivated = true;
    
    // Show welcome message
    vscode.window.showInformationMessage('🚀 Apex MCP Agent is ready!');
}

/**
 * Initialize all core components
 */
function initializeCoreComponents(context: vscode.ExtensionContext): void {
    // Load configuration
    const config = vscode.workspace.getConfiguration('apex-mcp');

    // Initialize security manager
    const blockedPaths = config.get<string[]>('blockedPaths', ['.git', '.env', '.secret', 'node_modules']);
    securityManager = initializeSecurityManager({
        blockedPaths
    });

    // Initialize session manager
    sessionManager = new SessionManager();
    context.subscriptions.push({ dispose: () => sessionManager.dispose() });

    // Create tool registry with all built-in tools
    toolRegistry = createToolRegistry(securityManager, sessionManager);
    context.subscriptions.push({ dispose: () => toolRegistry.dispose() });

    // Initialize MCP server
    mcpServer = new MCPServer(toolRegistry, sessionManager, securityManager);
    context.subscriptions.push({ dispose: () => mcpServer.dispose() });

    // Initialize agent loop controller
    agentController = new AgentLoopController(
        sessionManager,
        toolRegistry,
        securityManager,
        mcpServer,
        {
            maxStepsPerSession: config.get('maxStepsPerSession', 100),
            maxToolCallsPerStep: config.get('maxToolCallsPerStep', 10),
            failureLoopThreshold: config.get('failureLoopThreshold', 3)
        }
    );
    context.subscriptions.push({ dispose: () => agentController.dispose() });
}

/**
 * Register all commands
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // Start Agent - REQUIRES LICENSE TOKEN
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.startAgent', async () => {
            try {
                // Verify license token before execution
                cryptoLock.getToken();
                
                const request = await vscode.window.showInputBox({
                    prompt: 'What would you like the agent to do?',
                    placeHolder: 'e.g., "Add error handling to the authentication module"',
                    ignoreFocusOut: true
                });

                if (request) {
                    await agentController.startAgent(request);
                }
            } catch (error) {
                vscode.window.showErrorMessage('License required to start agent');
            }
        })
    );

    // Pause Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.pauseAgent', () => {
            agentController.pauseLoop();
            vscode.window.showInformationMessage('⏸️ Agent paused');
        })
    );

    // Stop Agent
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.stopAgent', () => {
            agentController.stopLoop();
            vscode.window.showInformationMessage('⏹️ Agent stopped');
        })
    );

    // Kill Switch
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.killSwitch', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                '🚨 EMERGENCY: Kill agent immediately?',
                { modal: true },
                'Kill Now'
            );

            if (confirmed === 'Kill Now') {
                agentController.killLoop();
            }
        })
    );

    // Toggle Read-Only Mode
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.toggleReadOnlyMode', () => {
            const isReadOnly = agentController.toggleReadOnlyMode();
            vscode.window.showInformationMessage(
                `👁️ Read-Only Mode: ${isReadOnly ? 'ON' : 'OFF'}`
            );
        })
    );

    // View Session History
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.viewSessionHistory', () => {
            const history = agentController.getActionHistory();

            // Create and show output channel with history
            const output = vscode.window.createOutputChannel('Apex MCP History');
            output.clear();
            output.appendLine('=== Agent Session History ===\n');

            if (history.length === 0) {
                output.appendLine('No actions recorded yet.');
            } else {
                history.forEach((action, index) => {
                    output.appendLine(`${index + 1}. [${action.status.toUpperCase()}] ${action.tool}`);
                    output.appendLine(`   Time: ${new Date(action.timestamp).toLocaleString()}`);
                    output.appendLine(`   Summary: ${action.summary}`);
                    output.appendLine('');
                });
            }

            output.show();
        })
    );

    // Rollback Last Action
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.rollbackLastAction', async () => {
            const confirmed = await vscode.window.showWarningMessage(
                '↩️ Rollback the last action?',
                { modal: true },
                'Rollback'
            );

            if (confirmed === 'Rollback') {
                const success = await agentController.rollbackLastAction();
                if (success) {
                    vscode.window.showInformationMessage('↩️ Action rolled back');
                } else {
                    vscode.window.showErrorMessage('No rollback available');
                }
            }
        })
    );

    // Start MCP Server in Terminal
    let mcpServerTerminal: vscode.Terminal | undefined;
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.startMcpServer', () => {
            // Dispose existing terminal if any
            if (mcpServerTerminal) {
                mcpServerTerminal.dispose();
            }

            // Create a new terminal for the MCP server
            mcpServerTerminal = vscode.window.createTerminal({
                name: 'Apex MCP Server',
                cwd: context.extensionUri.fsPath,
                iconPath: new vscode.ThemeIcon('robot')
            });

            // Show the terminal
            mcpServerTerminal.show();

            // Run the standalone MCP server
            const serverPath = vscode.Uri.joinPath(context.extensionUri, 'out', 'mcpServerStandalone.js').fsPath;
            mcpServerTerminal.sendText(`node "${serverPath}"`);

            vscode.window.showInformationMessage('🚀 MCP Server started in terminal');
        })
    );

    // License Management Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.showLicense', async () => {
            await activationUI.show(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('apex-mcp.checkLicense', async () => {
            const state = licenseValidator.getCurrentState();
            if (state?.status === LicenseStatus.Valid) {
                const days = licenseValidator.getDaysRemaining();
                vscode.window.showInformationMessage(
                    `✓ License active - ${days} days remaining`
                );
            } else {
                vscode.window.showWarningMessage(
                    `License status: ${state?.message || 'Not activated'}`,
                    'Activate'
                ).then(action => {
                    if (action === 'Activate') {
                        activationUI.show(context);
                    }
                });
            }
        })
    );
}

/**
 * Register views
 */
function registerViews(context: vscode.ExtensionContext): void {
    // Agent Control Webview
    const agentControlProvider = new AgentControlViewProvider(
        context.extensionUri,
        agentController,
        sessionManager
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AgentControlViewProvider.viewType,
            agentControlProvider
        )
    );

    // Action History Tree View
    const actionHistoryProvider = new ActionHistoryTreeProvider(agentController);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            'apex-mcp.actionHistory',
            actionHistoryProvider
        )
    );

    // Session Memory Tree View
    const sessionMemoryProvider = new SessionMemoryTreeProvider(sessionManager);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(
            'apex-mcp.sessionMemory',
            sessionMemoryProvider
        )
    );

    // Subscribe to events to refresh views
    const events = sessionManager.getEventEmitter();
    events.on(require('./types').AgentEventType.ToolCallExecuted, () => {
        actionHistoryProvider.refresh();
        sessionMemoryProvider.refresh();
    });
}

/**
 * Register configuration change listeners
 */
function registerConfigurationListeners(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('apex-mcp')) {
                const config = vscode.workspace.getConfiguration('apex-mcp');

                // Update security manager
                const blockedPaths = config.get<string[]>('blockedPaths', []);
                securityManager.updatePolicy({ blockedPaths });

                console.log('Apex MCP configuration updated');
            }
        })
    );

    // Listen for workspace changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            securityManager.updateWorkspace();
        })
    );
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
    console.log('Apex MCP Agent is deactivating');

    // Kill any active session
    if (agentController) {
        agentController.killLoop();
    }
}
