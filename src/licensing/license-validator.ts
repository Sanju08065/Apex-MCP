/**
 * LICENSE VALIDATOR
 * 
 * Main licensing logic - validates, activates, monitors licenses.
 * Integrates device fingerprinting, hidden storage, and Firebase.
 */

import * as vscode from 'vscode';
import { DeviceFingerprint } from './device-fingerprint';
import { HiddenStorage } from './hidden-storage';
import { FirebaseClient, ValidationResponse } from './firebase-client';

export enum LicenseStatus {
    Valid = 'valid',
    Expired = 'expired',
    Invalid = 'invalid',
    NotActivated = 'not_activated',
    DeviceMismatch = 'device_mismatch',
    Tampered = 'tampered'
}

export interface LicenseState {
    status: LicenseStatus;
    planId?: string;
    planName?: string;
    price?: number;
    expiresAt?: number;
    daysRemaining?: number;
    deviceId?: string;
    message?: string;
}

export class LicenseValidator {
    private static instance: LicenseValidator;
    private deviceFingerprint: DeviceFingerprint;
    private hiddenStorage: HiddenStorage;
    private firebaseClient: FirebaseClient;
    private validationTimer: NodeJS.Timeout | null = null;
    private currentState: LicenseState | null = null;

    private constructor() {
        this.deviceFingerprint = DeviceFingerprint.getInstance();
        this.hiddenStorage = HiddenStorage.getInstance();
        this.firebaseClient = FirebaseClient.getInstance();
    }

    public static getInstance(): LicenseValidator {
        if (!LicenseValidator.instance) {
            LicenseValidator.instance = new LicenseValidator();
        }
        return LicenseValidator.instance;
    }

    /**
     * Initialize and validate license on startup
     */
    public async initialize(): Promise<LicenseState> {
        console.log('[License] Initializing...');

        // Get device ID
        const deviceId = await this.deviceFingerprint.getDeviceId();
        console.log('[License] Device ID:', deviceId.substring(0, 16) + '...');

        // Check for existing activation
        const activation = await this.hiddenStorage.loadActivation();

        if (!activation) {
            console.log('[License] No activation found');
            this.currentState = {
                status: LicenseStatus.NotActivated,
                message: 'License not activated'
            };
            return this.currentState;
        }

        // Verify device ID matches
        if (activation.deviceId !== deviceId) {
            console.log('[License] Device ID mismatch - possible transfer');
            await this.hiddenStorage.clearActivation();
            this.currentState = {
                status: LicenseStatus.DeviceMismatch,
                message: 'License activated on different device'
            };
            return this.currentState;
        }

        // Check expiration
        const now = Date.now();
        if (now > activation.expiresAt) {
            console.log('[License] License expired');
            this.currentState = {
                status: LicenseStatus.Expired,
                planId: activation.plan,
                planName: activation.plan,
                price: 0,
                expiresAt: activation.expiresAt,
                message: 'License has expired'
            };
            return this.currentState;
        }

        // Validate with Firebase (online check)
        const validation = await this.firebaseClient.validateLicense(
            activation.licenseKey,
            deviceId
        );

        if (!validation.valid) {
            console.log('[License] Online validation failed:', validation.error);
            // Allow offline grace period (24 hours)
            const lastCheck = activation.activatedAt;
            const gracePeriod = 24 * 60 * 60 * 1000; // 24 hours
            
            if (now - lastCheck < gracePeriod) {
                console.log('[License] Using offline grace period');
                this.currentState = this.createValidState(activation);
            } else {
                this.currentState = {
                    status: LicenseStatus.Invalid,
                    message: validation.message || 'License validation failed'
                };
            }
        } else {
            console.log('[License] Valid license');
            this.currentState = this.createValidState(activation);
        }

        // Start periodic validation
        this.startPeriodicValidation();

        return this.currentState;
    }

    /**
     * Activate license with key
     */
    public async activateLicense(licenseKey: string): Promise<LicenseState> {
        console.log('[License] Activating license...');

        // Get device info
        const deviceId = await this.deviceFingerprint.getDeviceId();
        const deviceInfo = await this.deviceFingerprint.getDeviceInfo();

        // Activate with Firebase
        const response = await this.firebaseClient.activateLicense(
            licenseKey,
            deviceId,
            {
                platform: deviceInfo.platform,
                hostname: deviceInfo.hostname
            }
        );

        if (!response.valid || !response.license) {
            console.log('[License] Activation failed:', response.error);
            return {
                status: LicenseStatus.Invalid,
                message: response.message || 'Activation failed'
            };
        }

        // Save activation data
        await this.hiddenStorage.saveActivation({
            deviceId,
            licenseKey,
            plan: response.license.plan || 'unknown',
            activatedAt: Date.now(),
            expiresAt: response.license.expiresAt
        });

        console.log('[License] Activation successful');
        this.currentState = {
            status: LicenseStatus.Valid,
            planId: response.license.planId,
            planName: response.license.plan,
            price: response.license.price,
            expiresAt: response.license.expiresAt,
            daysRemaining: this.calculateDaysRemaining(response.license.expiresAt),
            deviceId: deviceId.substring(0, 16) + '...',
            message: 'License activated successfully'
        };

        // Start periodic validation
        this.startPeriodicValidation();

        return this.currentState;
    }

    /**
     * Deactivate current license
     */
    public async deactivateLicense(): Promise<boolean> {
        console.log('[License] Deactivating...');

        const activation = await this.hiddenStorage.loadActivation();
        if (!activation) {
            return false;
        }

        // Deactivate on server
        await this.firebaseClient.deactivateLicense(
            activation.licenseKey,
            activation.deviceId
        );

        // Clear local storage
        await this.hiddenStorage.clearActivation();

        // Stop validation
        this.stopPeriodicValidation();

        this.currentState = {
            status: LicenseStatus.NotActivated,
            message: 'License deactivated'
        };

        return true;
    }

    /**
     * Get current license state
     */
    public getCurrentState(): LicenseState | null {
        return this.currentState;
    }

    /**
     * Check if license is valid
     */
    public isValid(): boolean {
        return this.currentState?.status === LicenseStatus.Valid;
    }

    /**
     * Get days remaining
     */
    public getDaysRemaining(): number {
        if (!this.currentState?.expiresAt) {
            return 0;
        }
        return this.calculateDaysRemaining(this.currentState.expiresAt);
    }

    /**
     * Start periodic validation (every 6 hours)
     */
    private startPeriodicValidation(): void {
        if (this.validationTimer) {
            return;
        }

        const interval = 6 * 60 * 60 * 1000; // 6 hours
        this.validationTimer = setInterval(async () => {
            console.log('[License] Periodic validation check');
            await this.initialize();
        }, interval);
    }

    /**
     * Stop periodic validation
     */
    private stopPeriodicValidation(): void {
        if (this.validationTimer) {
            clearInterval(this.validationTimer);
            this.validationTimer = null;
        }
    }

    /**
     * Create valid state from activation data
     */
    private createValidState(activation: any): LicenseState {
        return {
            status: LicenseStatus.Valid,
            planId: activation.planId,
            planName: activation.planName,
            price: activation.price,
            expiresAt: activation.expiresAt,
            daysRemaining: this.calculateDaysRemaining(activation.expiresAt),
            deviceId: activation.deviceId.substring(0, 16) + '...',
            message: 'License is active'
        };
    }

    /**
     * Calculate days remaining
     */
    private calculateDaysRemaining(expiresAt: number): number {
        const now = Date.now();
        const remaining = expiresAt - now;
        return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        this.stopPeriodicValidation();
    }
}
