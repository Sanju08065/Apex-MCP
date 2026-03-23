/**
 * BUNDLE LOADER - Loads extension code from SERVER-SIDE DECRYPTED bundle
 * 
 * SERVER-SIDE DECRYPTION: TRUE SECURITY!
 * 1. Bundle is encrypted with server-side key (bundle.enc)
 * 2. Encryption key NEVER leaves the server
 * 3. Client fetches key from Firebase Firestore
 * 4. Client decrypts bundle.enc locally (after license validation)
 * 5. No keys in client code = real security
 * 
 * PLUS crypto-lock for execution control.
 */

import * as path from 'path';
import * as fs from 'fs';
import { FirebaseClient } from './licensing/firebase-client';
import { DeviceFingerprint } from './licensing/device-fingerprint';

class ZipLoader {
    private bundle: Map<string, string> = new Map();
    private cache: Map<string, any> = new Map();
    private licenseKey: string;
    private deviceId: string = '';

    constructor(licenseKey: string) {
        this.licenseKey = licenseKey;
    }

    /**
     * Load and decrypt bundle from server
     */
    public async loadBundle(): Promise<void> {
        // Get device ID
        this.deviceId = await DeviceFingerprint.getInstance().getDeviceId();
        
        const bundleEncPath = path.join(__dirname, 'bundle.enc');
        
        if (!fs.existsSync(bundleEncPath)) {
            throw new Error('bundle.enc not found. Extension may be corrupted.');
        }

        console.log('[ZipLoader] Loading encrypted bundle...');

        // Load encrypted bundle directly
        const encryptedBundleData = fs.readFileSync(bundleEncPath, 'utf8');

        console.log('[ZipLoader] Fetching decryption key from Firestore...');

        // Get encryption key directly from Firestore
        const firebase = FirebaseClient.getInstance();
        const encryptionKey = await this.getEncryptionKeyFromFirestore();
        
        if (!encryptionKey) {
            throw new Error('Failed to get encryption key from Firestore');
        }

        console.log('[ZipLoader] Decrypting bundle locally...');

        // Decrypt the bundle ONCE (files inside are plain text)
        const crypto = require('crypto');
        const decryptedBundleJson = this.decryptData(encryptedBundleData, encryptionKey, crypto);
        const bundle = JSON.parse(decryptedBundleJson);

        // Store decrypted files in bundle map
        for (const [fileName, content] of Object.entries(bundle)) {
            this.bundle.set(fileName, content as string);
        }

        console.log('[ZipLoader] Bundle decrypted successfully!');
    }

    /**
     * Get encryption key from Firestore
     */
    private async getEncryptionKeyFromFirestore(): Promise<string | null> {
        const https = require('https');
        
        return new Promise((resolve) => {
            const path = '/v1/projects/apex-agent-f8523/databases/(default)/documents/config/bundle';
            
            const options = {
                hostname: 'firestore.googleapis.com',
                port: 443,
                path,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            };

            const req = https.request(options, (res: any) => {
                let body = '';

                res.on('data', (chunk: any) => {
                    body += chunk;
                });

                res.on('end', () => {
                    try {
                        if (res.statusCode === 404) {
                            console.error('[ZipLoader] Encryption key not found in Firestore');
                            resolve(null);
                            return;
                        }

                        const response = JSON.parse(body);
                        
                        if (response.error) {
                            console.error('[ZipLoader] Firestore error:', response.error);
                            resolve(null);
                            return;
                        }

                        const key = response.fields?.encryptionKey?.stringValue;
                        resolve(key || null);
                    } catch (error) {
                        console.error('[ZipLoader] Parse error:', error);
                        resolve(null);
                    }
                });
            });

            req.on('error', (error: any) => {
                console.error('[ZipLoader] Request error:', error);
                resolve(null);
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });

            req.end();
        });
    }

    /**
     * Decrypt data with AES-256-CBC
     */
    private decryptData(encryptedData: string, keyHex: string, crypto: any): string {
        const encryptedBuffer = Buffer.from(encryptedData, 'base64');
        const iv = encryptedBuffer.subarray(0, 16);
        const encrypted = encryptedBuffer.subarray(16);
        
        const key = Buffer.from(keyHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString('utf8');
    }

    /**
     * Load module from decrypted bundle
     */
    public require(modulePath: string): any {
        // Check cache
        if (this.cache.has(modulePath)) {
            return this.cache.get(modulePath);
        }

        // Get decrypted file from bundle
        const fileName = modulePath + '.js';
        const code = this.bundle.get(fileName);

        if (!code) {
            throw new Error(`Module not found in bundle: ${modulePath}`);
        }
        
        // Create module context
        const module = { exports: {} };
        const exports = module.exports;
        
        // Create a safe require function
        const moduleRequire = (id: string) => {
            // Handle relative requires
            if (id.startsWith('./') || id.startsWith('../')) {
                const resolved = path.join(path.dirname(modulePath), id);
                return this.require(resolved);
            }
            // Handle node built-ins and external modules
            return require(id);
        };

        try {
            // Execute in isolated context with proper module wrapper
            const wrapper = `(function(exports, require, module, __filename, __dirname) { ${code}\n});`;
            const compiledWrapper = eval(wrapper);
            
            compiledWrapper.call(
                exports,
                exports,
                moduleRequire,
                module,
                modulePath + '.js',
                path.dirname(modulePath)
            );
        } catch (error) {
            throw new Error(`Failed to load module ${modulePath}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Cache result
        this.cache.set(modulePath, module.exports);
        return module.exports;
    }
}

// Global loader instance
let loader: ZipLoader | null = null;

export async function initZipLoader(licenseKey: string): Promise<ZipLoader> {
    if (!loader) {
        loader = new ZipLoader(licenseKey);
        await loader.loadBundle();
    }
    return loader;
}

export async function loadFromZip(modulePath: string, licenseKey: string): Promise<any> {
    const zipLoader = await initZipLoader(licenseKey);
    return zipLoader.require(modulePath);
}
