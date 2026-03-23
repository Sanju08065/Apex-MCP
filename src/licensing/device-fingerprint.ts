/**
 * DEVICE FINGERPRINTING
 * 
 * Creates unique, persistent device identifier using multiple hardware signals.
 * Resistant to VM detection, spoofing, and tampering.
 */

import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

export class DeviceFingerprint {
    private static instance: DeviceFingerprint;
    private cachedFingerprint: string | null = null;

    private constructor() {}

    public static getInstance(): DeviceFingerprint {
        if (!DeviceFingerprint.instance) {
            DeviceFingerprint.instance = new DeviceFingerprint();
        }
        return DeviceFingerprint.instance;
    }

    /**
     * Get unique device ID (cached for performance)
     */
    public async getDeviceId(): Promise<string> {
        if (this.cachedFingerprint) {
            return this.cachedFingerprint;
        }

        const components = await this.gatherComponents();
        const fingerprint = this.hashComponents(components);
        
        this.cachedFingerprint = fingerprint;
        return fingerprint;
    }

    /**
     * Gather hardware components for fingerprinting
     */
    private async gatherComponents(): Promise<Record<string, string>> {
        const components: Record<string, string> = {};

        try {
            // OS Information
            components.platform = os.platform();
            components.arch = os.arch();
            components.hostname = os.hostname();
            
            // CPU Information
            const cpus = os.cpus();
            if (cpus.length > 0) {
                components.cpuModel = cpus[0].model;
                components.cpuCores = cpus.length.toString();
            }

            // Memory
            components.totalMemory = os.totalmem().toString();

            // Network Interfaces (MAC addresses)
            const networkInterfaces = os.networkInterfaces();
            const macAddresses: string[] = [];
            
            for (const [, interfaces] of Object.entries(networkInterfaces)) {
                if (interfaces) {
                    for (const iface of interfaces) {
                        if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
                            macAddresses.push(iface.mac);
                        }
                    }
                }
            }
            components.macAddresses = macAddresses.sort().join(',');

            // Platform-specific identifiers
            components.platformId = await this.getPlatformSpecificId();

        } catch (error) {
            console.error('Error gathering device components:', error);
        }

        return components;
    }

    /**
     * Get platform-specific unique identifier
     */
    private async getPlatformSpecificId(): Promise<string> {
        try {
            const platform = os.platform();

            if (platform === 'win32') {
                // Windows: Get machine GUID
                const output = execSync('wmic csproduct get uuid', { encoding: 'utf8' });
                const match = output.match(/[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}/i);
                if (match) return match[0];
            } else if (platform === 'darwin') {
                // macOS: Get hardware UUID
                const output = execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID', { encoding: 'utf8' });
                const match = output.match(/"([A-F0-9-]+)"/i);
                if (match) return match[1];
            } else if (platform === 'linux') {
                // Linux: Get machine ID
                const output = execSync('cat /etc/machine-id || cat /var/lib/dbus/machine-id', { encoding: 'utf8' });
                return output.trim();
            }
        } catch (error) {
            // Fallback to hostname + username
            return `${os.hostname()}-${os.userInfo().username}`;
        }

        return 'unknown';
    }

    /**
     * Hash all components into single fingerprint
     */
    private hashComponents(components: Record<string, string>): string {
        const sorted = Object.keys(components)
            .sort()
            .map(key => `${key}:${components[key]}`)
            .join('|');

        return crypto
            .createHash('sha256')
            .update(sorted)
            .digest('hex');
    }

    /**
     * Detect if running in VM or sandbox (anti-tampering)
     */
    public async detectVirtualization(): Promise<boolean> {
        try {
            const platform = os.platform();
            
            if (platform === 'win32') {
                const output = execSync('systeminfo', { encoding: 'utf8' });
                const vmIndicators = ['vmware', 'virtualbox', 'qemu', 'xen', 'hyper-v'];
                return vmIndicators.some(indicator => 
                    output.toLowerCase().includes(indicator)
                );
            } else if (platform === 'linux') {
                const output = execSync('dmidecode -s system-manufacturer', { encoding: 'utf8' });
                const vmIndicators = ['vmware', 'virtualbox', 'qemu', 'xen', 'kvm'];
                return vmIndicators.some(indicator => 
                    output.toLowerCase().includes(indicator)
                );
            }
        } catch (error) {
            // If we can't detect, assume not VM
            return false;
        }

        return false;
    }

    /**
     * Get device info for display
     */
    public async getDeviceInfo(): Promise<{
        id: string;
        platform: string;
        hostname: string;
        isVirtual: boolean;
    }> {
        const deviceId = await this.getDeviceId();
        const isVirtual = await this.detectVirtualization();

        return {
            id: deviceId.substring(0, 16) + '...',
            platform: `${os.platform()} ${os.arch()}`,
            hostname: os.hostname(),
            isVirtual
        };
    }
}
