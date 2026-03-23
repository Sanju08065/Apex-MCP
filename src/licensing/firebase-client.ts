/**
 * FIREBASE CLIENT - DIRECT FIRESTORE ACCESS
 * 
 * Simple direct access to Firestore using REST API.
 * No Cloud Functions needed.
 */

import * as https from 'https';

export interface LicenseInfo {
    key: string;
    planId?: string;
    plan: string;
    price?: number;
    expiresAt: number;
    maxDevices: number;
    features: string[];
}

export interface ValidationResponse {
    valid: boolean;
    license?: LicenseInfo;
    error?: string;
    message?: string;
}

export class FirebaseClient {
    private static instance: FirebaseClient;
    
    // Firebase project configuration
    private readonly PROJECT_ID = 'apex-agent-f8523';
    private readonly API_KEY = 'AIzaSyBxXxXxXxXxXxXxXxXxXxXxXxXxXxXxXxX'; // Get from Firebase Console
    
    private constructor() {}

    public static getInstance(): FirebaseClient {
        if (!FirebaseClient.instance) {
            FirebaseClient.instance = new FirebaseClient();
        }
        return FirebaseClient.instance;
    }

    /**
     * Validate license key - Simple Firestore read
     */
    public async validateLicense(
        licenseKey: string,
        deviceId: string
    ): Promise<ValidationResponse> {
        try {
            // Read license document from Firestore
            const license = await this.getLicenseFromFirestore(licenseKey);

            if (!license) {
                return {
                    valid: false,
                    error: 'Invalid license key',
                    message: 'License key not found'
                };
            }

            // Check if active
            if (license.status !== 'active') {
                return {
                    valid: false,
                    error: 'License inactive',
                    message: 'License has been deactivated'
                };
            }

            // Check expiration
            if (Date.now() > license.expiresAt) {
                return {
                    valid: false,
                    error: 'License expired',
                    message: 'License has expired'
                };
            }

            // Check if device is activated
            const isDeviceActivated = license.activatedDevices?.some(
                (device: any) => device.deviceId === deviceId
            );

            if (!isDeviceActivated) {
                return {
                    valid: false,
                    error: 'Device not activated',
                    message: 'This device is not activated'
                };
            }

            return {
                valid: true,
                license: {
                    key: licenseKey,
                    planId: license.planId,
                    plan: license.planName || license.plan,
                    price: license.price,
                    expiresAt: license.expiresAt,
                    maxDevices: license.maxDevices,
                    features: license.features || []
                }
            };
        } catch (error) {
            return {
                valid: false,
                error: 'Network error',
                message: 'Could not connect to license server'
            };
        }
    }

    /**
     * Activate license on device - Update Firestore
     */
    public async activateLicense(
        licenseKey: string,
        deviceId: string,
        deviceInfo: {
            platform: string;
            hostname: string;
        }
    ): Promise<ValidationResponse> {
        try {
            console.log('[Firebase] Activating license:', licenseKey);
            console.log('[Firebase] Device ID:', deviceId.substring(0, 16) + '...');
            
            // Read license
            const license = await this.getLicenseFromFirestore(licenseKey);

            if (!license) {
                console.log('[Firebase] License not found in Firestore');
                return {
                    valid: false,
                    error: 'Invalid license key',
                    message: 'License key not found'
                };
            }

            console.log('[Firebase] License found:', license.planName);

            // Check if active
            if (license.status !== 'active') {
                console.log('[Firebase] License status:', license.status);
                return {
                    valid: false,
                    error: 'License inactive',
                    message: 'License has been deactivated'
                };
            }

            // Check expiration
            if (Date.now() > license.expiresAt) {
                console.log('[Firebase] License expired');
                return {
                    valid: false,
                    error: 'License expired',
                    message: 'License has expired'
                };
            }

            // Check if already activated
            const activatedDevices = license.activatedDevices || [];
            const existingDevice = activatedDevices.find(
                (device: any) => device.deviceId === deviceId
            );

            if (existingDevice) {
                console.log('[Firebase] Device already activated');
                // Already activated
                return {
                    valid: true,
                    license: {
                        key: licenseKey,
                        planId: license.planId,
                        plan: license.planName || license.plan,
                        price: license.price,
                        expiresAt: license.expiresAt,
                        maxDevices: license.maxDevices,
                        features: license.features || []
                    },
                    message: 'Device already activated'
                };
            }

            // Check device limit
            if (activatedDevices.length >= license.maxDevices) {
                console.log('[Firebase] Device limit reached:', activatedDevices.length, '/', license.maxDevices);
                return {
                    valid: false,
                    error: 'Device limit reached',
                    message: `Maximum ${license.maxDevices} devices allowed`
                };
            }

            // Add device
            activatedDevices.push({
                deviceId,
                platform: deviceInfo.platform,
                hostname: deviceInfo.hostname,
                activatedAt: Date.now()
            });

            console.log('[Firebase] Updating Firestore with new device...');
            
            // Update Firestore
            await this.updateLicenseInFirestore(licenseKey, {
                activatedDevices,
                lastActivation: Date.now()
            });

            console.log('[Firebase] Activation successful!');

            return {
                valid: true,
                license: {
                    key: licenseKey,
                    planId: license.planId,
                    plan: license.planName || license.plan,
                    price: license.price,
                    expiresAt: license.expiresAt,
                    maxDevices: license.maxDevices,
                    features: license.features || []
                },
                message: 'License activated successfully'
            };
        } catch (error) {
            console.error('[Firebase] Activation error:', error);
            return {
                valid: false,
                error: 'Activation failed',
                message: error instanceof Error ? error.message : 'Could not activate license'
            };
        }
    }

    /**
     * Deactivate license from device
     */
    public async deactivateLicense(
        licenseKey: string,
        deviceId: string
    ): Promise<{ success: boolean; message: string }> {
        try {
            const license = await this.getLicenseFromFirestore(licenseKey);

            if (!license) {
                return {
                    success: false,
                    message: 'License key not found'
                };
            }

            // Remove device
            const activatedDevices = (license.activatedDevices || []).filter(
                (device: any) => device.deviceId !== deviceId
            );

            await this.updateLicenseInFirestore(licenseKey, {
                activatedDevices,
                lastDeactivation: Date.now()
            });

            return {
                success: true,
                message: 'License deactivated successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: 'Could not deactivate license'
            };
        }
    }

    /**
     * Get license from Firestore using REST API
     */
    private getLicenseFromFirestore(licenseKey: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const path = `/v1/projects/${this.PROJECT_ID}/databases/(default)/documents/licenses/${licenseKey}`;
            
            console.log('[Firebase] Fetching license:', licenseKey);
            console.log('[Firebase] URL:', `https://firestore.googleapis.com${path}`);
            
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

            const req = https.request(options, (res) => {
                let body = '';

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    try {
                        console.log('[Firebase] Response status:', res.statusCode);
                        
                        if (res.statusCode === 404) {
                            console.log('[Firebase] License not found');
                            resolve(null);
                            return;
                        }

                        const response = JSON.parse(body);
                        
                        if (response.error) {
                            console.log('[Firebase] Error response:', response.error);
                            resolve(null);
                            return;
                        }

                        // Convert Firestore document to simple object
                        const data = this.convertFirestoreDocument(response);
                        console.log('[Firebase] License data:', JSON.stringify(data, null, 2));
                        resolve(data);
                    } catch (error) {
                        console.error('[Firebase] Parse error:', error);
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => {
                console.error('[Firebase] Request error:', error);
                reject(error);
            });
            req.on('timeout', () => {
                console.error('[Firebase] Request timeout');
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    /**
     * Update license in Firestore using REST API
     */
    private updateLicenseInFirestore(licenseKey: string, updates: any): Promise<void> {
        return new Promise((resolve, reject) => {
            const path = `/v1/projects/${this.PROJECT_ID}/databases/(default)/documents/licenses/${licenseKey}?updateMask.fieldPaths=${Object.keys(updates).join('&updateMask.fieldPaths=')}`;
            
            // Convert to Firestore format
            const firestoreData = this.convertToFirestoreDocument(updates);
            const postData = JSON.stringify({ fields: firestoreData });

            const options = {
                hostname: 'firestore.googleapis.com',
                port: 443,
                path,
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let body = '';

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error('Update failed'));
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Convert Firestore document to simple object
     */
    private convertFirestoreDocument(doc: any): any {
        if (!doc.fields) return null;

        const result: any = {};
        for (const [key, value] of Object.entries(doc.fields)) {
            const field = value as any;
            if (field.stringValue !== undefined) result[key] = field.stringValue;
            else if (field.integerValue !== undefined) result[key] = parseInt(field.integerValue);
            else if (field.doubleValue !== undefined) result[key] = field.doubleValue;
            else if (field.booleanValue !== undefined) result[key] = field.booleanValue;
            else if (field.arrayValue) {
                result[key] = field.arrayValue.values?.map((v: any) => {
                    if (v.mapValue) return this.convertFirestoreDocument({ fields: v.mapValue.fields });
                    return v.stringValue || v.integerValue || v.doubleValue || v.booleanValue;
                }) || [];
            }
        }
        return result;
    }

    /**
     * Convert simple object to Firestore format
     */
    private convertToFirestoreDocument(obj: any): any {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') result[key] = { stringValue: value };
            else if (typeof value === 'number') result[key] = { integerValue: value };
            else if (typeof value === 'boolean') result[key] = { booleanValue: value };
            else if (Array.isArray(value)) {
                result[key] = {
                    arrayValue: {
                        values: value.map(v => {
                            if (typeof v === 'object') {
                                return { mapValue: { fields: this.convertToFirestoreDocument(v) } };
                            }
                            return { stringValue: String(v) };
                        })
                    }
                };
            }
        }
        return result;
    }

    /**
     * SERVER-SIDE DECRYPTION METHODS
     * 
     * These methods call Firebase Cloud Functions to decrypt the bundle.
     * The encryption key NEVER leaves the server - TRUE security!
     */

    /**
     * Get decryption token from server
     */
    public async getDecryptionToken(
        licenseKey: string,
        deviceId: string
    ): Promise<{ success: boolean; token?: string; expiresAt?: number; error?: string }> {
        return new Promise((resolve) => {
            const postData = JSON.stringify({ licenseKey, deviceId });
            
            const options = {
                hostname: 'us-central1-apex-agent-f8523.cloudfunctions.net',
                port: 443,
                path: '/getDecryptionToken',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                let body = '';

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        resolve(response);
                    } catch (error) {
                        resolve({ success: false, error: 'Invalid response' });
                    }
                });
            });

            req.on('error', () => {
                resolve({ success: false, error: 'Network error' });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Request timeout' });
            });

            req.write(postData);
            req.end();
        });
    }

    /**
     * Decrypt a bundle chunk using server-side decryption
     */
    public async decryptChunk(
        licenseKey: string,
        deviceId: string,
        chunkId: string,
        encryptedData: string
    ): Promise<{ success: boolean; decrypted?: string; error?: string }> {
        return new Promise((resolve) => {
            const postData = JSON.stringify({
                licenseKey,
                deviceId,
                chunkId,
                encryptedData
            });
            
            const options = {
                hostname: 'us-central1-apex-agent-f8523.cloudfunctions.net',
                port: 443,
                path: '/decryptChunk',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 30000 // 30 seconds for decryption
            };

            const req = https.request(options, (res) => {
                let body = '';

                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = JSON.parse(body);
                        resolve(response);
                    } catch (error) {
                        resolve({ success: false, error: 'Invalid response' });
                    }
                });
            });

            req.on('error', () => {
                resolve({ success: false, error: 'Network error' });
            });
            req.on('timeout', () => {
                req.destroy();
                resolve({ success: false, error: 'Request timeout' });
            });

            req.write(postData);
            req.end();
        });
    }
}
