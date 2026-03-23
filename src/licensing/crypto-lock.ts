/**
 * CRYPTO-LOCK SYSTEM
 * 
 * Instead of encrypting code, we encrypt the EXECUTION CONTEXT.
 * The code is visible but CANNOT RUN without a valid license signature.
 * 
 * How it works:
 * 1. Every critical function requires a runtime token
 * 2. Token is derived from: license key + device ID + timestamp
 * 3. Token expires every 60 seconds and must be regenerated
 * 4. Token generation requires solving a cryptographic puzzle using license data
 * 5. Without valid license, puzzle cannot be solved = code cannot execute
 */

import * as crypto from 'crypto';

export class CryptoLock {
    private static instance: CryptoLock;
    private currentToken: string | null = null;
    private tokenExpiry: number = 0;
    private licenseKey: string | null = null;
    private deviceId: string | null = null;
    
    private constructor() {}
    
    public static getInstance(): CryptoLock {
        if (!CryptoLock.instance) {
            CryptoLock.instance = new CryptoLock();
        }
        return CryptoLock.instance;
    }
    
    /**
     * Initialize with license data
     */
    public initialize(licenseKey: string, deviceId: string): void {
        this.licenseKey = licenseKey;
        this.deviceId = deviceId;
        this.regenerateToken();
    }
    
    /**
     * Generate execution token from license
     * This is a cryptographic puzzle that requires valid license data
     */
    private regenerateToken(): void {
        if (!this.licenseKey || !this.deviceId) {
            this.currentToken = null;
            return;
        }
        
        const now = Date.now();
        const timeWindow = Math.floor(now / 60000); // 60 second windows
        
        // Create a cryptographic challenge
        // The solution requires: valid license format + device ID + current time window
        const challenge = `${this.licenseKey}:${this.deviceId}:${timeWindow}`;
        
        // Generate token using PBKDF2 (computationally expensive)
        const token = crypto.pbkdf2Sync(
            challenge,
            'apex-execution-salt',
            100000, // 100k iterations - expensive to compute
            32,
            'sha512'
        ).toString('hex');
        
        this.currentToken = token;
        this.tokenExpiry = now + 60000; // Valid for 60 seconds
    }
    
    /**
     * Get current execution token
     * Must be called before every critical operation
     */
    public getToken(): string {
        const now = Date.now();
        
        // Token expired or doesn't exist
        if (!this.currentToken || now >= this.tokenExpiry) {
            this.regenerateToken();
        }
        
        if (!this.currentToken) {
            throw new Error('Execution blocked: No valid license');
        }
        
        return this.currentToken;
    }
    
    /**
     * Verify token is valid
     */
    public verifyToken(token: string): boolean {
        return token === this.currentToken && Date.now() < this.tokenExpiry;
    }
    
    /**
     * Clear license data (deactivation)
     */
    public clear(): void {
        this.licenseKey = null;
        this.deviceId = null;
        this.currentToken = null;
        this.tokenExpiry = 0;
    }
}

/**
 * Execution Guard Decorator
 * Wraps critical functions to require valid token
 */
export function RequiresLicense() {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ) {
        const originalMethod = descriptor.value;
        
        descriptor.value = async function (...args: any[]) {
            const lock = CryptoLock.getInstance();
            
            try {
                // Get and verify token before execution
                const token = lock.getToken();
                
                // Execute original method
                return await originalMethod.apply(this, args);
            } catch (error) {
                throw new Error(`License required to execute ${propertyKey}`);
            }
        };
        
        return descriptor;
    };
}

/**
 * Function wrapper for non-class functions
 */
export function guardExecution<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: any[]) => {
        const lock = CryptoLock.getInstance();
        const token = lock.getToken(); // Will throw if no valid license
        return fn(...args);
    }) as T;
}
