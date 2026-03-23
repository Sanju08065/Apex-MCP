/**
 * TEST SERVER-SIDE ENCRYPTION/DECRYPTION
 * 
 * This simulates what Firebase Functions will do
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Load key from Firebase .env
const envPath = path.join(__dirname, '../firebase/functions/.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/BUNDLE_KEY=([a-f0-9]{64})/);
const BUNDLE_KEY = match[1];

console.log('🔐 TESTING SERVER-SIDE ENCRYPTION\n');
console.log('Key loaded from: firebase/functions/.env');
console.log('Key (first 16 chars):', BUNDLE_KEY.substring(0, 16) + '...\n');

// Test data
const testData = 'console.log("Hello from encrypted bundle!");';

// ENCRYPT (what build script does)
function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(BUNDLE_KEY, 'hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return Buffer.concat([iv, encrypted]).toString('base64');
}

// DECRYPT (what Firebase Functions does)
function decrypt(encryptedData) {
    const encryptedBuffer = Buffer.from(encryptedData, 'base64');
    const iv = encryptedBuffer.subarray(0, 16);
    const encrypted = encryptedBuffer.subarray(16);
    
    const key = Buffer.from(BUNDLE_KEY, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
}

// Test
console.log('Original:', testData);

const encrypted = encrypt(testData);
console.log('\nEncrypted (base64):', encrypted.substring(0, 50) + '...');

const decrypted = decrypt(encrypted);
console.log('\nDecrypted:', decrypted);

if (testData === decrypted) {
    console.log('\n✅ ENCRYPTION/DECRYPTION WORKING!\n');
} else {
    console.log('\n❌ ENCRYPTION/DECRYPTION FAILED!\n');
    process.exit(1);
}
