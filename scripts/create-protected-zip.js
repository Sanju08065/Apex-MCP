/**
 * CREATE ENCRYPTED BUNDLE
 * 
 * Gets encryption key from Firebase Firestore, encrypts bundle.
 * Key is NEVER stored in code - only in Firestore.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
            console.error('\nYou need to create it first:');
            console.error('1. Generate key: node scripts/setup-encryption-key.js');
            console.error('2. Go to Firebase Console > Firestore');
            console.error('3. Create collection: config');
            console.error('4. Create document: bundle');
            console.error('5. Add field: encryptionKey (string) = <your-64-char-hex-key>\n');
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

async function createProtectedZip() {
    console.log('🔐 CREATING SERVER-SIDE ENCRYPTED BUNDLE...\n');
    
    // Get encryption key from Firestore
    let BUNDLE_KEY;
    try {
        BUNDLE_KEY = await getBundleKey();
    } catch (error) {
        console.error('Failed to get encryption key:', error.message);
        process.exit(1);
    }
    
    const outDir = path.join(__dirname, '../out');
    const outFullDir = path.join(__dirname, '../out-full');
    const zipPath = path.join(__dirname, '../out.zip');
    
    // Create out-full directory if it doesn't exist
    if (!fs.existsSync(outFullDir)) {
        fs.mkdirSync(outFullDir);
    }
    
    // Collect all files to bundle
    const files = fs.readdirSync(outDir);
    const filesToBundle = [];
    
    console.log('  Collecting files to bundle...\n');
    
    for (const file of files) {
        // Skip extension.js (stub) and mcpServerStandalone.js - they must stay in out/
        if (file === 'extension.js' || file === 'mcpServerStandalone.js') {
            console.log(`    ⊗ ${file} (${file === 'extension.js' ? 'stub' : 'MCP server'} - excluded from bundle)`);
            continue;
        }
        
        const filePath = path.join(outDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
            console.log(`    • ${file}`);
            filesToBundle.push(file);
        }
    }
    
    console.log('\n  Encrypting files with SERVER-SIDE key...');
    
    // Create encrypted bundle
    const bundle = {};
    
    for (const file of filesToBundle) {
        const filePath = path.join(outDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Encrypt with server-side key from Firestore
        bundle[file] = encrypt(content, BUNDLE_KEY);
        
        console.log(`    🔒 ${file} (encrypted)`);
    }
    
    // Write bundle as JSON
    const bundleJson = JSON.stringify(bundle);
    
    console.log('\n  Creating ZIP...');
    
    // Create simple ZIP
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('bundle.json', Buffer.from(bundleJson, 'utf8'));
    zip.writeZip(zipPath);
    
    // Also save individual files to out-full for reference
    for (const file of filesToBundle) {
        const filePath = path.join(outDir, file);
        const content = fs.readFileSync(filePath);
        fs.writeFileSync(path.join(outFullDir, file), content);
    }
    
    console.log('\n✓ Created: out.zip (SERVER-SIDE encrypted bundle)\n');
    console.log('✓ Individual files saved to: out-full/ (for reference)\n');
    
    console.log('🔒 SERVER-SIDE ENCRYPTION - TRUE SECURITY!');
    console.log('   • Files encrypted with key from Firestore');
    console.log('   • Key stored ONLY in Firestore (config/bundle)');
    console.log('   • Key NEVER in source code or client');
    console.log('   • Client must call Firebase to decrypt');
    console.log('   • License validated before decryption');
    console.log('   • NO keys in code = REAL security\n');
}

createProtectedZip();
