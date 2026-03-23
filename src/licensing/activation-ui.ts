/**
 * ACTIVATION UI - BEAUTIFUL MODERN DESIGN
 * 
 * Premium activation interface with pricing plans.
 * Hidden by default, shown only when needed.
 */

import * as vscode from 'vscode';
import { LicenseValidator, LicenseStatus } from './license-validator';
import { DeviceFingerprint } from './device-fingerprint';
import { PRICING_PLANS, formatPrice, getPricePerDay } from './plans';

export class ActivationUI {
    private static instance: ActivationUI;
    private panel: vscode.WebviewPanel | null = null;
    private validator: LicenseValidator;
    private deviceFingerprint: DeviceFingerprint;

    private constructor() {
        this.validator = LicenseValidator.getInstance();
        this.deviceFingerprint = DeviceFingerprint.getInstance();
    }

    public static getInstance(): ActivationUI {
        if (!ActivationUI.instance) {
            ActivationUI.instance = new ActivationUI();
        }
        return ActivationUI.instance;
    }

    /**
     * Show activation panel
     */
    public async show(context: vscode.ExtensionContext): Promise<void> {
        // Create or reveal panel
        if (this.panel) {
            this.panel.reveal();
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'apexActivation',
            'Apex License',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        // Set icon
        this.panel.iconPath = vscode.Uri.joinPath(
            context.extensionUri,
            'resources',
            'icon.png'
        );

        // Handle disposal
        this.panel.onDidDispose(() => {
            this.panel = null;
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleMessage(message);
        });

        // Set initial HTML
        await this.updateContent();
    }

    /**
     * Update webview content
     */
    private async updateContent(): Promise<void> {
        if (!this.panel) {
            return;
        }

        const state = this.validator.getCurrentState();
        const deviceInfo = await this.deviceFingerprint.getDeviceInfo();

        this.panel.webview.html = this.getHtmlContent(state, deviceInfo);
    }

    /**
     * Handle messages from webview
     */
    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'activate':
                await this.handleActivation(message.licenseKey);
                break;

            case 'deactivate':
                await this.handleDeactivation();
                break;

            case 'refresh':
                await this.validator.initialize();
                await this.updateContent();
                break;

            case 'copyDeviceId':
                const deviceId = await this.deviceFingerprint.getDeviceId();
                await vscode.env.clipboard.writeText(deviceId);
                vscode.window.showInformationMessage('Device ID copied');
                break;

            case 'buyPlan':
                // TODO: Integrate payment gateway
                vscode.window.showInformationMessage(
                    `Purchase ${message.planName} plan - Payment integration coming soon!`
                );
                break;
        }
    }

    /**
     * Handle license activation
     */
    private async handleActivation(licenseKey: string): Promise<void> {
        if (!licenseKey || licenseKey.trim().length === 0) {
            this.showMessage('error', 'Please enter a license key');
            return;
        }

        // Validate key format
        const keyPattern = /^[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-Z0-9]{2}$/i;
        if (!keyPattern.test(licenseKey.trim())) {
            this.showMessage('error', 'Invalid license key format. Expected: XXXX-XXXX-XXXX-XXXX-XX');
            return;
        }

        this.showMessage('info', '🔄 Validating license key...');

        try {
            const result = await this.validator.activateLicense(licenseKey.trim().toUpperCase());

            if (result.status === LicenseStatus.Valid) {
                this.showMessage('success', '✓ License activated successfully!');
                
                // Update UI to show activated state immediately
                await this.updateContent();
                
                // Show success notification
                vscode.window.showInformationMessage(
                    `🎉 Apex MCP Agent activated! Plan: ${result.planName}`,
                    'Start Using'
                ).then(selection => {
                    if (selection === 'Start Using' && this.panel) {
                        this.panel.dispose();
                    }
                });
            } else {
                this.showMessage('error', result.message || 'Activation failed. Please check your license key.');
            }
        } catch (error) {
            console.error('[Activation] Error:', error);
            this.showMessage('error', `Activation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Handle license deactivation
     */
    private async handleDeactivation(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            'Deactivate license on this device?',
            { modal: true },
            'Deactivate'
        );

        if (confirmed !== 'Deactivate') {
            return;
        }

        const success = await this.validator.deactivateLicense();

        if (success) {
            this.showMessage('success', 'License deactivated');
            await this.updateContent();
        } else {
            this.showMessage('error', 'Deactivation failed');
        }
    }

    /**
     * Show message in webview
     */
    private showMessage(type: 'success' | 'error' | 'info', message: string): void {
        if (this.panel) {
            this.panel.webview.postMessage({
                command: 'showMessage',
                type,
                message
            });
        }
    }

    /**
     * Generate HTML content
     */
    private getHtmlContent(state: any, deviceInfo: any): string {
        const isActivated = state?.status === LicenseStatus.Valid;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Apex License</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            padding: 20px;
            min-height: 100vh;
        }

        .container {
            max-width: 900px;
            margin: 0 auto;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
        }

        .logo {
            width: 60px;
            height: 60px;
            margin: 0 auto 15px;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 30px;
            backdrop-filter: blur(10px);
        }

        h1 {
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
        }

        .subtitle {
            font-size: 15px;
            opacity: 0.9;
        }

        .card {
            background: rgba(255, 255, 255, 0.98);
            border-radius: 16px;
            padding: 30px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            color: #333;
            margin-bottom: 20px;
        }

        .message {
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            display: none;
            font-size: 14px;
        }

        .message.show {
            display: block;
        }

        .message-success {
            background: #d1fae5;
            color: #065f46;
            border: 1px solid #10b981;
        }

        .message-error {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #ef4444;
        }

        .message-info {
            background: #dbeafe;
            color: #1e40af;
            border: 1px solid #3b82f6;
        }

        .status-badge {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 20px;
        }

        .status-valid {
            background: #10b981;
            color: white;
        }

        .status-expired {
            background: #ef4444;
            color: white;
        }

        .status-inactive {
            background: #6b7280;
            color: white;
        }

        .pricing-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 25px 0;
        }

        .plan-card {
            background: #f9fafb;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s;
            position: relative;
        }

        .plan-card:hover {
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
        }

        .plan-card.popular {
            border-color: #667eea;
            background: linear-gradient(135deg, #f0f4ff 0%, #e8edff 100%);
        }

        .plan-card.popular::before {
            content: 'POPULAR';
            position: absolute;
            top: -10px;
            right: 10px;
            background: #667eea;
            color: white;
            padding: 4px 10px;
            border-radius: 10px;
            font-size: 10px;
            font-weight: 700;
        }

        .plan-name {
            font-size: 16px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 8px;
        }

        .plan-price {
            font-size: 28px;
            font-weight: 800;
            color: #667eea;
            margin-bottom: 4px;
        }

        .plan-duration {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 12px;
        }

        .plan-features {
            list-style: none;
            font-size: 12px;
            color: #4b5563;
        }

        .plan-features li {
            padding: 4px 0;
        }

        .plan-features li::before {
            content: '✓';
            color: #10b981;
            font-weight: bold;
            margin-right: 6px;
        }

        .form-group {
            margin: 20px 0;
        }

        label {
            display: block;
            font-weight: 600;
            margin-bottom: 8px;
            color: #374151;
            font-size: 14px;
        }

        input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 14px;
            font-family: 'Courier New', monospace;
            transition: border-color 0.2s;
        }

        input:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            width: 100%;
            padding: 12px;
            border: none;
            border-radius: 8px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-primary {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }

        .btn-primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
        }

        .btn-secondary {
            background: #f3f4f6;
            color: #374151;
            margin-top: 10px;
        }

        .btn-secondary:hover {
            background: #e5e7eb;
        }

        .btn-danger {
            background: #ef4444;
            color: white;
            margin-top: 10px;
        }

        .btn-danger:hover {
            background: #dc2626;
        }

        .info-grid {
            display: grid;
            gap: 12px;
            margin: 20px 0;
        }

        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 10px;
            background: #f9fafb;
            border-radius: 6px;
            font-size: 14px;
        }

        .info-label {
            font-weight: 600;
            color: #6b7280;
        }

        .info-value {
            color: #111827;
            font-weight: 500;
        }

        .device-info {
            background: #f9fafb;
            border-radius: 8px;
            padding: 15px;
            margin-top: 15px;
        }

        .device-info h3 {
            font-size: 12px;
            color: #6b7280;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .device-id {
            font-family: 'Courier New', monospace;
            font-size: 11px;
            background: white;
            padding: 8px;
            border-radius: 4px;
            word-break: break-all;
            color: #111827;
        }

        .copy-btn {
            margin-top: 8px;
            padding: 6px 12px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
        }

        .copy-btn:hover {
            background: #5568d3;
        }

        .divider {
            height: 1px;
            background: #e5e7eb;
            margin: 25px 0;
        }

        .section-title {
            font-size: 18px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 15px;
        }

        .footer {
            text-align: center;
            margin-top: 20px;
            opacity: 0.9;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">🛡️</div>
            <h1>Apex MCP Agent</h1>
            <p class="subtitle">Professional AI Coding Assistant</p>
        </div>

        <div class="card">
            <div id="message" class="message"></div>

            ${isActivated ? this.getActivatedView(state) : this.getActivationView(state)}
        </div>

        <div class="card device-info">
            <h3>Device Information</h3>
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Platform</span>
                    <span class="info-value">${deviceInfo.platform}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Hostname</span>
                    <span class="info-value">${deviceInfo.hostname}</span>
                </div>
            </div>
            <div class="device-id">${deviceInfo.id}</div>
            <button class="copy-btn" onclick="copyDeviceId()">Copy Device ID</button>
        </div>

        <div class="footer">
            <p>Secure licensing powered by Firebase</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function activate() {
            const licenseKey = document.getElementById('licenseKey').value;
            vscode.postMessage({ command: 'activate', licenseKey });
        }

        function deactivate() {
            vscode.postMessage({ command: 'deactivate' });
        }

        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }

        function copyDeviceId() {
            vscode.postMessage({ command: 'copyDeviceId' });
        }

        function buyPlan(planId, planName) {
            vscode.postMessage({ command: 'buyPlan', planId, planName });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'showMessage') {
                showMessage(message.type, message.message);
            }
        });

        function showMessage(type, text) {
            const messageEl = document.getElementById('message');
            messageEl.className = 'message message-' + type + ' show';
            messageEl.textContent = text;
            setTimeout(() => {
                messageEl.className = 'message';
            }, 5000);
        }
    </script>
</body>
</html>`;
    }

    /**
     * Get activated view HTML
     */
    private getActivatedView(state: any): string {
        const daysRemaining = state.daysRemaining || 0;
        const expiryDate = state.expiresAt ? new Date(state.expiresAt).toLocaleDateString() : 'N/A';

        return `
            <span class="status-badge status-valid">✓ Active License</span>
            
            <div class="info-grid">
                <div class="info-item">
                    <span class="info-label">Plan</span>
                    <span class="info-value">${state.planName || 'Active'}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Expires</span>
                    <span class="info-value">${expiryDate}</span>
                </div>
                <div class="info-item">
                    <span class="info-label">Days Remaining</span>
                    <span class="info-value">${daysRemaining} days</span>
                </div>
            </div>

            <button class="btn btn-secondary" onclick="refresh()">Refresh Status</button>
            <button class="btn btn-danger" onclick="deactivate()">Deactivate License</button>
        `;
    }

    /**
     * Get activation view HTML
     */
    private getActivationView(state: any): string {
        const isExpired = state?.status === LicenseStatus.Expired;
        const statusClass = isExpired ? 'status-expired' : 'status-inactive';
        const statusText = isExpired ? '✗ License Expired' : '○ Not Activated';

        // Generate pricing cards
        const pricingCards = PRICING_PLANS.map(plan => `
            <div class="plan-card ${plan.popular ? 'popular' : ''}" onclick="buyPlan('${plan.id}', '${plan.name}')">
                <div class="plan-name">${plan.name}</div>
                <div class="plan-price">${formatPrice(plan.price)}</div>
                <div class="plan-duration">${getPricePerDay(plan)}</div>
                <ul class="plan-features">
                    ${plan.features.map(f => `<li>${f}</li>`).join('')}
                </ul>
            </div>
        `).join('');

        return `
            <span class="status-badge ${statusClass}">${statusText}</span>
            
            <div class="section-title">Choose Your Plan</div>
            <div class="pricing-grid">
                ${pricingCards}
            </div>

            <div class="divider"></div>

            <div class="section-title">Have a License Key?</div>
            <div class="form-group">
                <label for="licenseKey">Enter License Key</label>
                <input 
                    type="text" 
                    id="licenseKey" 
                    placeholder="XXXX-XXXX-XXXX-XXXX-XX"
                    autocomplete="off"
                />
            </div>

            <button class="btn btn-primary" onclick="activate()">Activate License</button>
        `;
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }
}
