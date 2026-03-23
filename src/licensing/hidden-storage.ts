/**
 * HIDDEN STORAGE
 * 
 * Stores activation data in hidden, encrypted location.
 * Undetectable by normal users, resistant to tampering.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

interface ActivationData {
    deviceId: string;
    licenseKey: string;
    activatedAt: number;
    expiresAt: number;
    plan: string;
    checksum: string;
}

export class HiddenStorage {
    private static instance: HiddenStorage;
    private readonly ENCRYPTION_KEY: Buffer;
    private storagePath: string | null = null;

    private constructor() {
        // Derive encryption key from machine-specific data
        const machineKey = this.getMachineKey();
        this.ENCRYPTION_KEY = crypto.scryptSync(machineKey, 'apex-salt', 32);
    }

    public static getInstance(): HiddenStorage {
        if (!HiddenStorage.instance) {
            HiddenStorage.instance = new HiddenStorage();
        }
        return HiddenStorage.instance;
    }

    /**
     * Get machine-specific key for encryption
     */
    private getMachineKey(): string {
        return `${os.hostname()}-${os.platform()}-${os.arch()}`;
    }

    /**
     * Get hidden storage path (creates if doesn't exist)
     */
    private getStoragePath(): string {
        if (this.storagePath) {
            return this.storagePath;
        }

        const platform = os.platform();
        let baseDir: string;

        if (platform === 'win32') {
            baseDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        } else if (platform === 'darwin') {
            baseDir = path.join(os.homedir(), 'Library', 'Application Support');
        } else {
            baseDir = path.join(os.homedir(), '.config');
        }

        // Create hidden directory with random name
        const hiddenHash = crypto.createHash('md5')
            .update(this.getMachineKey())
            .digest('hex')
            .substring(0, 8);

        const hiddenDir = path.join(baseDir, `.sys-${hiddenHash}`);
        
        if (!fs.existsSync(hiddenDir)) {
            fs.mkdirSync(hiddenDir, { recursive: true, mode: 0o700 });
            
            // Set hidden attribute on Windows
            if (platform === 'win32') {
                try {
                    execSync(`attrib +h "${hiddenDir}"`);
                } catch {}
            }
        }

        this.storagePath = path.join(hiddenDir, 'config.dat');
        return this.storagePath;
    }

    /**
     * Encrypt data
     */
    private encrypt(data: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.ENCRYPTION_KEY, iv);
        
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return iv.toString('hex') + ':' + encrypted;
    }

    /**
     * Decrypt data
     */
    private decrypt(encrypted: string): string {
        const [ivHex, data] = encrypted.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.ENCRYPTION_KEY, iv);
        
        let decrypted = decipher.update(data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    /**
     * Calculate checksum for tamper detection
     */
    private calculateChecksum(data: Omit<ActivationData, 'checksum'>): string {
        const str = JSON.stringify(data);
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    /**
     * Save activation data
     */
    public async saveActivation(data: Omit<ActivationData, 'checksum'>): Promise<void> {
        const checksum = this.calculateChecksum(data);
        const fullData: ActivationData = { ...data, checksum };
        
        const encrypted = this.encrypt(JSON.stringify(fullData));
        const storagePath = this.getStoragePath();
        
        fs.writeFileSync(storagePath, encrypted, { mode: 0o600 });
    }

    /**
     * Load activation data
     */
    public async loadActivation(): Promise<ActivationData | null> {
        try {
            const storagePath = this.getStoragePath();
            
            if (!fs.existsSync(storagePath)) {
                return null;
            }

            const encrypted = fs.readFileSync(storagePath, 'utf8');
            const decrypted = this.decrypt(encrypted);
            const data: ActivationData = JSON.parse(decrypted);

            // Verify checksum (tamper detection)
            const { checksum, ...dataWithoutChecksum } = data;
            const expectedChecksum = this.calculateChecksum(dataWithoutChecksum);

            if (checksum !== expectedChecksum) {
                // Data has been tampered with!
                this.clearActivation();
                return null;
            }

            return data;
        } catch (error) {
            return null;
        }
    }

    /**
     * Clear activation data
     */
    public async clearActivation(): Promise<void> {
        try {
            const storagePath = this.getStoragePath();
            if (fs.existsSync(storagePath)) {
                fs.unlinkSync(storagePath);
            }
        } catch (error) {
            // Ignore errors
        }
    }

    /**
     * Check if activation exists
     */
    public async hasActivation(): Promise<boolean> {
        const data = await this.loadActivation();
        return data !== null;
    }

    /**
     * Get storage location (for debugging only)
     */
    public getStorageLocation(): string {
        return this.getStoragePath();
    }
}
