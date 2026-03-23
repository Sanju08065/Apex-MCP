/**
 * ENCRYPT ALL FILES WITH .enc EXTENSION
 * 
 * Encrypts all files in the project (except package.json) with .enc extension
 * Uses encryption key from Firebase Firestore
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
 * Check if file should be excluded from encryption
 */
function shouldExclude(filePath) {
    const excludePatterns = [
        'package.json',           // Extension manifest
        'package-lock.json',      // NPM lock file
        'node_modules',           // Dependencies
        '.git',                   // Git directory
        '.enc',                   // Already encrypted files
        'out',                    // Build output
        'out-full',               // Full output
        'build',                  // Build directory
        '.vscodeignore',          // VS Code ignore
        'apex-1.0.0.vsix',        // Extension package
        'out.zip',                // Zip file
        'serviceAccountKey.json', // Firebase key
        '.env'                    // Environment variables
    ];
    
    // Check if file matches any exclude pattern
    for (const pattern of excludePatterns) {
        if (filePath.includes(pattern)) {
            return true;
        }
    }
    
    return false;
}

/**
 * Recursively get all files in directory
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        
        if (shouldExclude(filePath)) {
            continue;
        }
        
        if (fs.statSync(filePath).isDirectory()) {
            arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    }
    
    return arrayOfFiles;
}

async function encryptAllFiles() {
    console.log('🔐 ENCRYPTING ALL FILES WITH .enc EXTENSION...\n');
    
    // Get encryption key from Firestore
    let BUNDLE_KEY;
    try {
        BUNDLE_KEY = await getBundleKey();
    } catch (error) {
        console.error('Failed to get encryption key:', error.message);
        process.exit(1);
    }
    
    const rootDir = path.join(__dirname, '..');
    
    // Get all files
    console.log('  Collecting files to encrypt...\n');
    const allFiles = getAllFiles(rootDir);
    
    let encryptedCount = 0;
    let skippedCount = 0;
    
    for (const filePath of allFiles) {
        const relativePath = path.relative(rootDir, filePath);
        
        try {
            // Read file content
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Encrypt content
            const encrypted = encrypt(content, BUNDLE_KEY);
            
            // Write encrypted file with .enc extension
            const encryptedPath = filePath + '.enc';
            fs.writeFileSync(encryptedPath, encrypted, 'utf8');
            
            console.log(`    🔒 ${relativePath} → ${relativePath}.enc`);
            encryptedCount++;
            
        } catch (error) {
            console.log(`    ⊗ ${relativePath} (skipped: ${error.message})`);
            skippedCount++;
        }
    }
    
    console.log(`\n✅ Encryption complete!`);
    console.log(`   • Encrypted: ${encryptedCount} files`);
    console.log(`   • Skipped: ${skippedCount} files`);
    console.log(`   • Excluded: package.json and other system files\n`);
    
    console.log('🔒 ALL FILES ENCRYPTED WITH .enc EXTENSION');
    console.log('   • Files encrypted with key from Firestore');
    console.log('   • Original files preserved');
    console.log('   • package.json excluded from encryption\n');
    
    process.exit(0);
}

encryptAllFiles();
