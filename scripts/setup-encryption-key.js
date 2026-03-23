/**
 * SETUP ENCRYPTION KEY IN FIRESTORE
 * 
 * This script helps you store the encryption key in Firestore.
 * Run once to set up the key.
 */

const crypto = require('crypto');

// Generate a random encryption key
const encryptionKey = crypto.randomBytes(32).toString('hex');

console.log('🔐 ENCRYPTION KEY SETUP\n');
console.log('Generated encryption key:', encryptionKey);
console.log('\n📋 SETUP INSTRUCTIONS:\n');
console.log('1. Go to Firebase Console: https://console.firebase.google.com/');
console.log('2. Select your project: apex-agent-f8523');
console.log('3. Go to Firestore Database');
console.log('4. Create a new collection: "config"');
console.log('5. Create a new document with ID: "bundle"');
console.log('6. Add a field:');
console.log('   - Field name: encryptionKey');
console.log('   - Field type: string');
console.log('   - Field value:', encryptionKey);
console.log('\n✅ After setup, run: npm run zip\n');
console.log('⚠️  IMPORTANT: Keep this key secret! It\'s stored only in Firestore.\n');
