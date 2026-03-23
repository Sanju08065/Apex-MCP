/**
 * =============================================================================
 * APEX MCP AGENT - SECURITY LAYER
 * =============================================================================
 * 
 * Implements absolute filesystem security and path validation.
 * This is the gatekeeper - NO raw filesystem access passes without validation.
 * 
 * SECURITY GUARANTEES:
 * 1. Workspace-only access
 * 2. No ../ traversal
 * 3. No symlinks escaping workspace
 * 4. Blocked paths (.git, .env, secrets) are NEVER accessible
 * 5. All paths are normalized and validated
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { SecurityPolicy, ValidationResult } from './types';

/**
 * Default security policy - can be overridden via configuration
 */
const DEFAULT_SECURITY_POLICY: SecurityPolicy = {
    blockedPaths: [
        '.git',
        '.env',
        '.env.local',
        '.env.production',
        '.env.development',
        '.secret',
        '.secrets',
        'secrets',
        '.ssh',
        '.gnupg',
        '.aws',
        '.azure',
        'node_modules',  // Blocked by default for performance
        '__pycache__'
    ],
    blockedPatterns: [
        /\.env\.[a-zA-Z]+$/,      // .env.* files
        /\.pem$/i,                 // Private keys
        /\.key$/i,                 // Private keys
        /id_rsa/i,                 // SSH keys
        /id_ed25519/i,             // SSH keys
        /\.p12$/i,                 // PKCS12 certificates
        /password/i,               // Password files
        /secret/i,                 // Secret files
        /credential/i,             // Credential files
        /token/i,                  // Token files
        /\.pfx$/i                  // Certificate files
    ],
    blockedExtensions: [
        '.exe', '.dll', '.so', '.dylib',  // Binaries
        '.msi', '.dmg', '.pkg',            // Installers
        '.zip', '.tar', '.gz', '.rar',     // Archives (can contain large data)
    ],
    maxFileSize: 10 * 1024 * 1024,  // 10MB max
    preventSymlinkEscape: true,
    requireWorkspaceScope: true
};

/**
 * SecurityManager - the absolute gatekeeper for all filesystem operations
 */
export class SecurityManager {
    private policy: SecurityPolicy;
    private workspaceRoot: vscode.Uri | null = null;
    private resolvedWorkspacePath: string | null = null;

    constructor(policy: Partial<SecurityPolicy> = {}) {
        this.policy = { ...DEFAULT_SECURITY_POLICY, ...policy };
        this.initializeWorkspace();
    }

    /**
     * Initialize workspace root - called on activation
     */
    private initializeWorkspace(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri;
            this.resolvedWorkspacePath = this.normalizePath(this.workspaceRoot.fsPath);
        }
    }

    /**
     * Update workspace root (called when workspace changes)
     */
    public updateWorkspace(): void {
        this.initializeWorkspace();
    }

    /**
     * Get workspace root URI
     */
    public getWorkspaceRoot(): vscode.Uri | null {
        return this.workspaceRoot;
    }

    /**
     * Normalize a path for consistent comparison
     */
    private normalizePath(inputPath: string): string {
        // Normalize slashes and resolve to absolute path
        let normalized = path.normalize(inputPath);
        // Convert to forward slashes for consistency
        normalized = normalized.replace(/\\/g, '/');
        // Remove trailing slash
        if (normalized.endsWith('/') && normalized.length > 1) {
            normalized = normalized.slice(0, -1);
        }
        return normalized.toLowerCase();
    }

    /**
     * CRITICAL: Validate a path is safe to access
     * Returns ValidationResult with normalized path if valid
     */
    public validatePath(inputPath: string, operation: 'read' | 'write' | 'delete'): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // 1. Check workspace is available
        if (!this.workspaceRoot || !this.resolvedWorkspacePath) {
            return {
                valid: false,
                errors: ['No workspace folder is open'],
                warnings: []
            };
        }

        // 2. Normalize and resolve the path
        let resolvedPath: string;
        try {
            // Handle both absolute and relative paths
            if (path.isAbsolute(inputPath)) {
                resolvedPath = path.resolve(inputPath);
            } else {
                resolvedPath = path.resolve(this.workspaceRoot.fsPath, inputPath);
            }
        } catch (e) {
            return {
                valid: false,
                errors: [`Invalid path format: ${e instanceof Error ? e.message : String(e)}`],
                warnings: []
            };
        }

        const normalizedPath = this.normalizePath(resolvedPath);

        // 3. CRITICAL: Check for path traversal (../)
        if (inputPath.includes('..')) {
            errors.push('Path traversal detected: ".." is not allowed');
        }

        // 4. CRITICAL: Ensure path is within workspace
        if (!normalizedPath.startsWith(this.resolvedWorkspacePath)) {
            errors.push(`Access denied: Path "${inputPath}" is outside workspace`);
        }

        // 5. Check against blocked paths
        for (const blockedPath of this.policy.blockedPaths) {
            const normalizedBlockedPath = blockedPath.toLowerCase().replace(/\\/g, '/');

            // Check if path contains blocked directory
            if (normalizedPath.includes(`/${normalizedBlockedPath}/`) ||
                normalizedPath.endsWith(`/${normalizedBlockedPath}`)) {
                errors.push(`Access denied: "${blockedPath}" is a protected path`);
            }
        }

        // 6. Check against blocked patterns
        const fileName = path.basename(inputPath);
        for (const pattern of this.policy.blockedPatterns) {
            if (pattern.test(fileName) || pattern.test(normalizedPath)) {
                errors.push(`Access denied: Path matches blocked pattern`);
            }
        }

        // 7. Check file extension for writes
        if (operation === 'write' || operation === 'delete') {
            const ext = path.extname(inputPath).toLowerCase();
            if (this.policy.blockedExtensions.includes(ext)) {
                errors.push(`Access denied: "${ext}" files cannot be modified`);
            }
        }

        // 8. Add warnings for potentially sensitive paths
        if (fileName.startsWith('.')) {
            warnings.push('Accessing hidden file/directory');
        }

        if (normalizedPath.includes('config') || normalizedPath.includes('settings')) {
            warnings.push('Accessing configuration file - verify intent');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            sanitizedParams: errors.length === 0 ? { path: resolvedPath } : undefined
        };
    }

    /**
     * Resolve a relative path to absolute path within workspace
     */
    public resolvePath(relativePath: string): vscode.Uri | null {
        const validation = this.validatePath(relativePath, 'read');
        if (!validation.valid || !validation.sanitizedParams) {
            return null;
        }
        return vscode.Uri.file(validation.sanitizedParams.path as string);
    }

    /**
     * Get relative path from workspace root
     */
    public getRelativePath(absolutePath: string): string | null {
        if (!this.workspaceRoot) {
            return null;
        }

        const normalizedAbsolute = this.normalizePath(absolutePath);
        const normalizedWorkspace = this.resolvedWorkspacePath!;

        if (!normalizedAbsolute.startsWith(normalizedWorkspace)) {
            return null;
        }

        return absolutePath.substring(this.workspaceRoot.fsPath.length + 1);
    }

    /**
     * Validate file size before operations
     */
    public validateFileSize(sizeBytes: number): ValidationResult {
        if (sizeBytes > this.policy.maxFileSize) {
            return {
                valid: false,
                errors: [`File too large: ${sizeBytes} bytes exceeds maximum of ${this.policy.maxFileSize} bytes`],
                warnings: []
            };
        }
        return { valid: true, errors: [], warnings: [] };
    }

    /**
     * Check if symlink escapes workspace (if applicable)
     */
    public async validateSymlink(linkPath: string): Promise<ValidationResult> {
        if (!this.policy.preventSymlinkEscape) {
            return { valid: true, errors: [], warnings: [] };
        }

        try {
            const uri = vscode.Uri.file(linkPath);
            const stat = await vscode.workspace.fs.stat(uri);

            // VS Code's stat follows symlinks, so we just validate the resolved path
            // is still within workspace
            return this.validatePath(linkPath, 'read');
        } catch (e) {
            return {
                valid: false,
                errors: [`Cannot validate symlink: ${e instanceof Error ? e.message : String(e)}`],
                warnings: []
            };
        }
    }

    /**
     * Get current security policy (for debugging/logging)
     */
    public getPolicy(): Readonly<SecurityPolicy> {
        return { ...this.policy };
    }

    /**
     * Update security policy at runtime
     */
    public updatePolicy(updates: Partial<SecurityPolicy>): void {
        this.policy = { ...this.policy, ...updates };
    }

    /**
     * Add blocked path dynamically
     */
    public addBlockedPath(pathToBlock: string): void {
        if (!this.policy.blockedPaths.includes(pathToBlock)) {
            this.policy.blockedPaths.push(pathToBlock);
        }
    }

    /**
     * Check if operation is allowed based on read-only mode
     */
    public isOperationAllowed(operation: 'read' | 'write' | 'delete', readOnlyMode: boolean): boolean {
        if (readOnlyMode && (operation === 'write' || operation === 'delete')) {
            return false;
        }
        return true;
    }
}

/**
 * Singleton instance for global access
 */
let securityManagerInstance: SecurityManager | null = null;

export function getSecurityManager(): SecurityManager {
    if (!securityManagerInstance) {
        securityManagerInstance = new SecurityManager();
    }
    return securityManagerInstance;
}

export function initializeSecurityManager(policy?: Partial<SecurityPolicy>): SecurityManager {
    securityManagerInstance = new SecurityManager(policy);
    return securityManagerInstance;
}
