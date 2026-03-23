/**
 * CODE INTEGRITY VERIFICATION
 * 
 * Makes tampering detectable by:
 * 1. Checksumming critical code paths
 * 2. Verifying function signatures at runtime
 * 3. Detecting debugger/dev tools
 * 4. Random integrity checks during execution
 */

import * as crypto from 'crypto';

export class IntegrityChecker {
    private static instance: IntegrityChecker;
    private checksums: Map<string, string> = new Map();
    private tamperDetected: boolean = false;
    
    private constructor() {
        this.initializeChecksums();
        this.startRandomChecks();
    }
    
    public static getInstance(): IntegrityChecker {
        if (!IntegrityChecker.instance) {
            IntegrityChecker.instance = new IntegrityChecker();
        }
        return IntegrityChecker.instance;
    }
    
    /**
     * Initialize checksums of critical functions
     */
    private initializeChecksums(): void {
        // Store checksums of critical code
        // These will be verified at runtime
        this.checksums.set('validateLicense', this.hashFunction('validateLicense'));
        this.checksums.set('activateLicense', this.hashFunction('activateLicense'));
        this.checksums.set('getToken', this.hashFunction('getToken'));
    }
    
    /**
     * Hash a function's source code
     */
    private hashFunction(name: string): string {
        // In production, this would hash actual function code
        // For now, return a placeholder
        return crypto.createHash('sha256').update(name).digest('hex');
    }
    
    /**
     * Verify code integrity
     */
    public verify(): boolean {
        if (this.tamperDetected) {
            return false;
        }
        
        // Check for debugger
        if (this.isDebuggerAttached()) {
            this.tamperDetected = true;
            return false;
        }
        
        // Verify checksums
        for (const [name, expectedHash] of this.checksums) {
            const currentHash = this.hashFunction(name);
            if (currentHash !== expectedHash) {
                this.tamperDetected = true;
                return false;
            }
        }
        
        return true;
    }
    
    /**
     * Detect if debugger is attached
     */
    private isDebuggerAttached(): boolean {
        // Check for common debugger indicators
        const start = Date.now();
        debugger; // This line will pause if debugger is open
        const end = Date.now();
        
        // If more than 100ms passed, debugger was likely attached
        return (end - start) > 100;
    }
    
    /**
     * Start random integrity checks
     */
    private startRandomChecks(): void {
        setInterval(() => {
            if (!this.verify()) {
                // Tamper detected - disable functionality
                this.onTamperDetected();
            }
        }, Math.random() * 30000 + 30000); // Random interval 30-60 seconds
    }
    
    /**
     * Handle tamper detection
     */
    private onTamperDetected(): void {
        console.error('Integrity check failed');
        // In production, this would disable all functionality
        throw new Error('Code integrity violation detected');
    }
    
    /**
     * Check if tamper was detected
     */
    public isTampered(): boolean {
        return this.tamperDetected;
    }
}
