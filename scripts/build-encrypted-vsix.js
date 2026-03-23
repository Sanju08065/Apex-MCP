/**
 * BUILD ENCRYPTED VSIX
 * 
 * 1. Build the extension normally
 * 2. Encrypt all files in out/ with .enc extension (except package.json)
 * 3. Package into VSIX
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Use Firebase Admin SDK
const admin = require('firebase-admin');
const serviceAccount = require('../firebase/functions/serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/**
 * Get encryption key from Firestore
 */
async function getBundleKey() {
    console.log('📡 Fetching encryption key from Firestore...');
    
    try {
        const doc = await db.collection('config').doc('bundle').get();
        
        if (!doc.exists) {
            console.error('\n❌ ERROR: Encryption key not found in Firestore!');
            throw new Error('Encryption key not configured');
        }

        const data = doc.data();
        const key = data.encryptionKey;
        
        if (!key || key.length !== 64) {
            throw new Error('Invalid encryption key in Firestore');
        }

        console.log('✓ Encryption key loaded from Firestore\n');
        return key;
    } catch (error) {
        throw error;
    }
}

/**
 * Encrypt data with AES-256-CBC
 */
function encrypt(text, key) {
    const iv = crypto.randomBytes(16);
    const keyBuffer = Buffer.from(key, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
    
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    // Return IV + encrypted data as base64
    return Buffer.concat([iv, encrypted]).toString('base64');
}

/**
 * Bundle and encrypt all files in out/ directory into bundle.enc
 */
async function createEncryptedBundle(key) {
    console.log('\n🔐 Creating encrypted bundle...\n');
    
    const outDir = path.join(__dirname, '../out');
    
    if (!fs.existsSync(outDir)) {
        console.error('❌ out/ directory not found. Run build first.');
        process.exit(1);
    }
    
    const files = fs.readdirSync(outDir);
    const bundle = {};
    let fileCount = 0;
    
    for (const file of files) {
        // Skip extension.js and mcpServerStandalone.js - they stay unencrypted
        if (file === 'extension.js' || file === 'mcpServerStandalone.js') {
            console.log(`    ⊗ ${file} (excluded - entry point)`);
            continue;
        }
        
        const filePath = path.join(outDir, file);
        const stat = fs.statSync(filePath);
        
        if (!stat.isFile()) {
            continue;
        }
        
        try {
            // Read file content (NOT encrypted yet)
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Add to bundle as plain text (will be encrypted as whole bundle)
            bundle[file] = content;
            
            console.log(`    • ${file}`);
            fileCount++;
            
        } catch (error) {
            console.log(`    ⊗ ${file} (skipped: ${error.message})`);
        }
    }
    
    // Convert bundle to JSON
    const bundleJson = JSON.stringify(bundle);
    
    // Encrypt the ENTIRE bundle (not individual files)
    const encryptedBundle = encrypt(bundleJson, key);
    
    // Write bundle.enc
    const bundlePath = path.join(outDir, 'bundle.enc');
    fs.writeFileSync(bundlePath, encryptedBundle, 'utf8');
    
    console.log(`\n✓ Created bundle.enc with ${fileCount} files (encrypted as single bundle)\n`);
}

/**
 * Encrypt resources into resources.enc
 */
async function encryptResources(key) {
    console.log('🔐 Creating encrypted resources bundle...\n');
    
    const resourcesDir = path.join(__dirname, '../resources');
    
    if (!fs.existsSync(resourcesDir)) {
        console.log('⊗ No resources directory found\n');
        return;
    }
    
    const files = fs.readdirSync(resourcesDir);
    const bundle = {};
    let fileCount = 0;
    
    for (const file of files) {
        // Skip .enc files
        if (file.endsWith('.enc')) {
            continue;
        }
        
        const filePath = path.join(resourcesDir, file);
        const stat = fs.statSync(filePath);
        
        if (!stat.isFile()) {
            continue;
        }
        
        try {
            // Read file content as base64 (for binary files like images)
            const content = fs.readFileSync(filePath);
            bundle[file] = content.toString('base64');
            
            console.log(`    • ${file}`);
            fileCount++;
            
        } catch (error) {
            console.log(`    ⊗ ${file} (skipped: ${error.message})`);
        }
    }
    
    // Convert bundle to JSON
    const bundleJson = JSON.stringify(bundle);
    
    // Encrypt the entire bundle
    const encryptedBundle = encrypt(bundleJson, key);
    
    // Write resources.enc
    const bundlePath = path.join(resourcesDir, 'resources.enc');
    fs.writeFileSync(bundlePath, encryptedBundle, 'utf8');
    
    console.log(`\n✓ Created resources.enc with ${fileCount} files\n`);
}

/**
 * Update .vscodeignore to include bundle.enc
 */
function updateVsCodeIgnore() {
    console.log('📝 Updating .vscodeignore...\n');
    
    const vscodeignorePath = path.join(__dirname, '../.vscodeignore');
    let content = fs.readFileSync(vscodeignorePath, 'utf8');
    
    // Add bundle.enc to be included
    if (!content.includes('!out/bundle.enc')) {
        content = content.replace(
            '!out/extension.js\n!out/mcpServerStandalone.js\n!out/*.enc\n!out.zip',
            '!out/extension.js\n!out/mcpServerStandalone.js\n!out/bundle.enc\n!out.zip'
        );
    }
    
    // Add resources.enc to be included
    if (!content.includes('!resources/resources.enc')) {
        content = content.replace(
            'resources/**',
            'resources/**\n!resources/resources.enc'
        );
    }
    
    fs.writeFileSync(vscodeignorePath, content);
    console.log('✓ Updated .vscodeignore to include bundle.enc and resources.enc\n');
}

async function buildEncryptedVsix() {
    console.log('🚀 BUILDING ENCRYPTED VSIX PACKAGE...\n');
    
    try {
        // Step 0: Clean up any existing .enc files
        console.log('📦 Step 0: Cleaning up old .enc files...\n');
        const rootDir = path.join(__dirname, '..');
        
        // Remove tsconfig.json.enc if exists
        const tsconfigEnc = path.join(rootDir, 'tsconfig.json.enc');
        if (fs.existsSync(tsconfigEnc)) {
            fs.unlinkSync(tsconfigEnc);
            console.log('✓ Removed tsconfig.json.enc\n');
        }
        
        // Remove any .enc files in root
        const rootFiles = fs.readdirSync(rootDir);
        for (const file of rootFiles) {
            if (file.endsWith('.enc') && fs.statSync(path.join(rootDir, file)).isFile()) {
                fs.unlinkSync(path.join(rootDir, file));
                console.log(`✓ Removed ${file}\n`);
            }
        }
        
        // Remove any .enc files in resources/
        const resourcesDir = path.join(rootDir, 'resources');
        if (fs.existsSync(resourcesDir)) {
            const resourceFiles = fs.readdirSync(resourcesDir);
            for (const file of resourceFiles) {
                if (file.endsWith('.enc')) {
                    fs.unlinkSync(path.join(resourcesDir, file));
                    console.log(`✓ Removed resources/${file}\n`);
                }
            }
        }
        
        // Remove any .enc files in out/
        const outDir = path.join(rootDir, 'out');
        if (fs.existsSync(outDir)) {
            const outFiles = fs.readdirSync(outDir);
            for (const file of outFiles) {
                if (file.endsWith('.enc') && file !== 'bundle.enc') {
                    fs.unlinkSync(path.join(outDir, file));
                    console.log(`✓ Removed out/${file}\n`);
                }
            }
        }
        
        // Remove old apex-1.0.0.vsix if exists
        const oldVsix = path.join(rootDir, 'apex-1.0.0.vsix');
        if (fs.existsSync(oldVsix)) {
            fs.unlinkSync(oldVsix);
            console.log('✓ Removed old apex-1.0.0.vsix\n');
        }
        
        // Step 1: Run normal build
        console.log('📦 Step 1: Building extension...\n');
        execSync('npm run build', { stdio: 'inherit' });
        
        // Step 2: Get encryption key
        console.log('\n📦 Step 2: Getting encryption key...\n');
        const key = await getBundleKey();
        
        // Step 3: Encrypt files in out/
        console.log('📦 Step 3: Creating encrypted bundle...\n');
        await createEncryptedBundle(key);
        
        // Step 4: Encrypt resources
        console.log('📦 Step 4: Encrypting resources...\n');
        await encryptResources(key);
        
        // Step 5: Update .vscodeignore
        console.log('📦 Step 5: Updating package configuration...\n');
        updateVsCodeIgnore();
        
        // Step 6: Package VSIX
        console.log('📦 Step 6: Creating VSIX package...\n');
        execSync('vsce package --no-dependencies --allow-missing-repository', { stdio: 'inherit' });
        
        console.log('\n✅ ENCRYPTED VSIX BUILD COMPLETE!\n');
        console.log('🔒 Security Features:');
        console.log('   • All files bundled into bundle.enc (single encrypted file)');
        console.log('   • Resources bundled into resources.enc');
        console.log('   • package.json NOT encrypted (required by VS Code)');
        console.log('   • extension.js and mcpServerStandalone.js NOT encrypted (entry points)');
        console.log('   • Encryption key from Firestore');
        console.log('   • AES-256-CBC encryption\n');
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Build failed:', error.message);
        process.exit(1);
    }
}

buildEncryptedVsix();
