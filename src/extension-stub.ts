/**
 * EXTENSION ENTRY POINT WITH LICENSING
 */

import * as vscode from 'vscode';
import { LicenseValidator, LicenseStatus } from './licensing/license-validator';
import { ActivationUI } from './licensing/activation-ui';

let mainExtensionActivated = false;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[Apex] Starting activation...');
        
        // Check license first
        const validator = LicenseValidator.getInstance();
        const activationUI = ActivationUI.getInstance();
        
        // Initialize and check license
        const licenseState = await validator.initialize();
        console.log('[Apex] License status:', licenseState.status);

        if (licenseState.status !== LicenseStatus.Valid) {
            console.log('[Apex] License not valid, showing activation UI');
            
            // Show activation UI and wait for activation
            await activationUI.show(context);
            
            // Register command to check activation status
            const checkActivationCommand = vscode.commands.registerCommand('apex-mcp.checkActivation', async () => {
                const newState = validator.getCurrentState();
                if (newState && newState.status === LicenseStatus.Valid && !mainExtensionActivated) {
                    console.log('[Apex] License now valid, activating main extension');
                    await activateMainExtension(context);
                }
            });
            context.subscriptions.push(checkActivationCommand);
            
            // Poll for activation every 2 seconds
            const pollInterval = setInterval(async () => {
                const currentState = validator.getCurrentState();
                if (currentState && currentState.status === LicenseStatus.Valid && !mainExtensionActivated) {
                    clearInterval(pollInterval);
                    console.log('[Apex] License activated, loading main extension');
                    await activateMainExtension(context);
                }
            }, 2000);
            
            // Stop polling after 5 minutes
            setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
            
            return;
        }

        // License is valid, load main extension immediately
        console.log('[Apex] License valid, activating main extension');
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
 * Activate main extension
 */
async function activateMainExtension(context: vscode.ExtensionContext) {
    if (mainExtensionActivated) {
        console.log('[Apex] Main extension already activated');
        return;
    }
    
    try {
        console.log('[Apex] Loading main extension module...');
        const mainExtension = await import('./extension');
        
        console.log('[Apex] Calling main extension activate...');
        await mainExtension.activate(context);
        
        mainExtensionActivated = true;
        console.log('[Apex] Main extension activated successfully');
        
        vscode.window.showInformationMessage('🚀 Apex MCP Agent is ready!');
    } catch (error) {
        console.error('[Apex] Failed to activate main extension:', error);
        throw error;
    }
}

/**
 * Extension deactivation
 */
export async function deactivate() {
    try {
        if (mainExtensionActivated) {
            const mainExtension = await import('./extension');
            if (mainExtension.deactivate) {
                return mainExtension.deactivate();
            }
        }
    } catch (error) {
        console.error('[Apex] Deactivation error:', error);
    }
}
