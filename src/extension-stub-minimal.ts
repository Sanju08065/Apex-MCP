/**
 * MINIMAL EXTENSION ENTRY POINT
 * 
 * This file ONLY exports activate/deactivate.
 * ALL logic is in extension-real.js (encrypted with SERVER-SIDE key).
 * 
 * SERVER-SIDE DECRYPTION = TRUE SECURITY:
 * - Bundle encrypted with key that NEVER leaves Firebase server
 * - Client sends encrypted chunks to Firebase Cloud Functions
 * - Server validates license and decrypts
 * - No encryption keys in client code!
 */

import * as vscode from 'vscode';

let mainExtension: any = null;
let isLoaded = false;

/**
 * Get license key from storage
 */
async function getLicenseKey(): Promise<string | null> {
    try {
        // Dynamically import hidden storage
        const { HiddenStorage } = await import('./licensing/hidden-storage');
        const storage = HiddenStorage.getInstance();
        const activation = await storage.loadActivation();
        
        return activation?.licenseKey || null;
    } catch (error) {
        console.error('[Apex] Failed to load license key:', error);
        return null;
    }
}

/**
 * Show activation UI if no license
 */
async function showActivationUI(context: vscode.ExtensionContext): Promise<void> {
    try {
        const { ActivationUI } = await import('./licensing/activation-ui');
        const ui = ActivationUI.getInstance();
        await ui.show(context);
    } catch (error) {
        console.error('[Apex] Failed to show activation UI:', error);
    }
}

/**
 * Load the real extension from SERVER-SIDE DECRYPTED bundle
 */
async function loadMainExtension(): Promise<any> {
    if (isLoaded) {
        return mainExtension;
    }

    try {
        // Get license key
        const licenseKey = await getLicenseKey();
        
        if (!licenseKey) {
            throw new Error('No license key found - activation required');
        }
        
        console.log('[Apex] Loading encrypted bundle from server...');
        
        // Dynamically import the zip loader
        const { loadFromZip } = await import('./zip-loader');
        
        // Load extension-real.js from the SERVER-DECRYPTED bundle
        // The bundle is encrypted with a key that NEVER leaves the server
        // Firebase validates license and decrypts chunks server-side
        mainExtension = await loadFromZip('extension-real', licenseKey);
        isLoaded = true;
        
        console.log('[Apex] Bundle loaded and decrypted successfully!');
        
        return mainExtension;
    } catch (error) {
        console.error('[Apex] Failed to load main extension:', error);
        throw new Error(`Failed to load encrypted extension: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    try {
        console.log('[Apex] Loading encrypted extension...');
        
        // Check for license key
        const licenseKey = await getLicenseKey();
        
        if (!licenseKey) {
            // No license - show activation UI
            console.log('[Apex] No license found - showing activation UI');
            await showActivationUI(context);
            
            // Register command to show license UI
            context.subscriptions.push(
                vscode.commands.registerCommand('apex-mcp.showLicense', async () => {
                    await showActivationUI(context);
                })
            );
            
            // Show notification
            const action = await vscode.window.showWarningMessage(
                'Apex MCP Agent requires activation',
                'Activate Now',
                'Dismiss'
            );
            
            if (action === 'Activate Now') {
                await showActivationUI(context);
            }
            
            return; // Don't load extension without license
        }
        
        const ext = await loadMainExtension();
        
        if (!ext || !ext.activate) {
            throw new Error('Extension module is invalid or missing activate function');
        }
        
        console.log('[Apex] Calling main activate...');
        await ext.activate(context);
        
    } catch (error) {
        console.error('[Apex] Activation failed:', error);
        vscode.window.showErrorMessage(
            `Failed to activate Apex: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

/**
 * Extension deactivation
 */
export async function deactivate() {
    try {
        if (mainExtension && mainExtension.deactivate) {
            return await mainExtension.deactivate();
        }
    } catch (error) {
        console.error('[Apex] Deactivation error:', error);
    }
}
