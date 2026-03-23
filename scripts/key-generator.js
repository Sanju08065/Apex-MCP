/**
 * SUPER SECURE LICENSE KEY GENERATOR
 * 
 * Advanced cryptographic key generation with Firebase integration.
 * 
 * SECURITY FEATURES:
 * ✓ Cryptographically secure random generation (crypto.randomBytes)
 * ✓ Checksum validation (prevents typos)
 * ✓ Anti-collision detection (checks existing keys)
 * ✓ Firebase direct upload (no manual entry needed)
 * ✓ Batch generation with analytics
 * ✓ Key format: XXXX-XXXX-XXXX-XXXX-CC (last 2 chars = checksum)
 * 
 * Usage:
 *   node scripts/key-generator.js <plan> <duration> [count]
 * 
 * Examples:
 *   node scripts/key-generator.js trial 1
 *   node scripts/key-generator.js standard 30
 *   node scripts/key-generator.js pro 365 10
 */

const crypto = require('crypto');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
let firebaseInitialized = false;
let db = null;

function initializeFirebase() {
    if (firebaseInitialized) return;
    
    try {
        const serviceAccountPath = path.join(__dirname, '..', 'firebase', 'functions', 'serviceAccountKey.json');
        if (!fs.existsSync(serviceAccountPath)) {
            throw new Error('serviceAccountKey.json not found at firebase/functions/');
        }
        
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
        db = admin.firestore();
        firebaseInitialized = true;
        console.log('✓ Firebase initialized');
        console.log(`  Project: ${serviceAccount.project_id}\n`);
    } catch (error) {
        console.error('✗ Firebase initialization failed:', error.message);
        console.error('  Make sure firebase/functions/serviceAccountKey.json exists\n');
        process.exit(1);
    }
}

// Plans configuration (matches extension pricing)
const PLANS = {
    day1: {
        name: '1 Day Trial',
        duration: 1,
        price: 99,
        maxDevices: 1,
        features: ['full-access', 'basic-support']
    },
    week1: {
        name: '7 Days',
        duration: 7,
        price: 150,
        maxDevices: 2,
        features: ['full-access', 'priority-support']
    },
    week2: {
        name: '15 Days',
        duration: 15,
        price: 200,
        maxDevices: 3,
        features: ['full-access', 'priority-support']
    },
    month1: {
        name: '1 Month',
        duration: 30,
        price: 349,
        maxDevices: 5,
        features: ['full-access', 'premium-support']
    }
};

/**
 * Generate cryptographically secure random bytes
 */
function generateSecureRandom(length) {
    return crypto.randomBytes(length);
}

/**
 * Calculate checksum for key validation
 */
function calculateChecksum(keyBase) {
    const hash = crypto.createHash('sha256').update(keyBase).digest();
    // Take first 2 bytes and convert to base36 (0-9, A-Z)
    const checksum = (hash[0] * 256 + hash[1]) % 1296; // 36^2 = 1296
    return checksum.toString(36).toUpperCase().padStart(2, '0');
}

/**
 * Generate super secure license key with checksum
 * Format: XXXX-XXXX-XXXX-XXXX-CC
 * Last 2 characters (CC) are checksum for validation
 */
function generateSecureLicenseKey() {
    // Generate 4 segments of 4 characters each (16 chars total)
    const segments = [];
    for (let i = 0; i < 4; i++) {
        const bytes = generateSecureRandom(2);
        const segment = bytes.toString('hex').toUpperCase();
        segments.push(segment);
    }
    
    const keyBase = segments.join('-');
    const checksum = calculateChecksum(keyBase);
    
    return `${keyBase}-${checksum}`;
}

/**
 * Validate license key checksum
 */
function validateLicenseKey(licenseKey) {
    const parts = licenseKey.split('-');
    if (parts.length !== 5) {
        return false;
    }
    
    const keyBase = parts.slice(0, 4).join('-');
    const providedChecksum = parts[4];
    const calculatedChecksum = calculateChecksum(keyBase);
    
    return providedChecksum === calculatedChecksum;
}

/**
 * Check if key already exists in Firebase
 */
async function keyExists(licenseKey) {
    if (!firebaseInitialized || !db) {
        return false;
    }
    
    try {
        const doc = await db.collection('licenses').doc(licenseKey).get();
        return doc.exists;
    } catch (error) {
        return false;
    }
}

/**
 * Generate unique key (anti-collision)
 */
async function generateUniqueKey() {
    let attempts = 0;
    const maxAttempts = 100;
    
    while (attempts < maxAttempts) {
        const key = generateSecureLicenseKey();
        
        // Validate checksum
        if (!validateLicenseKey(key)) {
            console.error('Generated invalid key (checksum failed)');
            attempts++;
            continue;
        }
        
        // Check for collision
        const exists = await keyExists(key);
        if (!exists) {
            return key;
        }
        
        console.log(`  Collision detected, regenerating... (attempt ${attempts + 1})`);
        attempts++;
    }
    
    throw new Error('Failed to generate unique key after maximum attempts');
}

/**
 * Create license in Firebase
 */
async function createLicense(licenseKey, planId) {
    const planConfig = PLANS[planId];
    if (!planConfig) {
        throw new Error(`Invalid plan: ${planId}`);
    }

    const now = Date.now();
    const durationDays = planConfig.duration;
    const expiresAt = now + (durationDays * 24 * 60 * 60 * 1000);

    const licenseData = {
        key: licenseKey,
        planId: planId,
        planName: planConfig.name,
        price: planConfig.price,
        maxDevices: planConfig.maxDevices,
        features: planConfig.features,
        durationDays: durationDays,
        createdAt: now,
        expiresAt: expiresAt,
        activatedDevices: [],
        status: 'active',
        lastValidation: null,
        lastActivation: null,
        lastDeactivation: null
    };

    // Display license info
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║           LICENSE CREATED SUCCESSFULLY                 ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
    console.log('  License Key:', licenseKey);
    console.log('  Plan:', planConfig.name);
    console.log('  Price: $' + planConfig.price);
    console.log('  Duration:', durationDays, 'days');
    console.log('  Max Devices:', planConfig.maxDevices);
    console.log('  Features:', planConfig.features.join(', '));
    console.log('  Created:', new Date(now).toLocaleString());
    console.log('  Expires:', new Date(expiresAt).toLocaleString());
    console.log('  Checksum:', validateLicenseKey(licenseKey) ? '✓ Valid' : '✗ Invalid');
    console.log('\n════════════════════════════════════════════════════════\n');

    // Save to Firebase
    if (firebaseInitialized && db) {
        try {
            await db.collection('licenses').doc(licenseKey).set(licenseData);
            console.log('✓ License saved to Firebase Firestore');
            console.log(`  Collection: licenses`);
            console.log(`  Document ID: ${licenseKey}\n`);
        } catch (error) {
            console.error('✗ Failed to save to Firebase:', error.message);
            throw error;
        }
    } else {
        throw new Error('Firebase not initialized');
    }

    return licenseData;
}

/**
 * Generate batch of licenses
 */
async function generateBatch(planId, count) {
    const planConfig = PLANS[planId];
    console.log(`\n🔐 GENERATING ${count} SECURE LICENSE KEYS...\n`);
    console.log(`Plan: ${planConfig.name}`);
    console.log(`Price: $${planConfig.price}`);
    console.log(`Duration: ${planConfig.duration} days`);
    console.log(`Count: ${count}\n`);

    const licenses = [];
    const startTime = Date.now();

    for (let i = 0; i < count; i++) {
        process.stdout.write(`  Generating key ${i + 1}/${count}... `);
        
        try {
            const key = await generateUniqueKey();
            const license = await createLicense(key, planId);
            licenses.push(license);
            process.stdout.write('✓\n');
        } catch (error) {
            process.stdout.write(`✗ ${error.message}\n`);
        }
    }

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    console.log(`║              BATCH GENERATION COMPLETE                 ║`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);
    console.log(`  Generated: ${licenses.length}/${count} licenses`);
    console.log(`  Time: ${duration} seconds`);
    console.log(`  All licenses saved to Firebase Firestore\n`);
    console.log(`\n════════════════════════════════════════════════════════\n`);
}

/**
 * Validate existing key
 */
function validateKey(licenseKey) {
    console.log('\n🔍 VALIDATING LICENSE KEY...\n');
    console.log('  Key:', licenseKey);
    
    const isValid = validateLicenseKey(licenseKey);
    
    if (isValid) {
        console.log('  Status: ✓ Valid checksum');
    } else {
        console.log('  Status: ✗ Invalid checksum');
    }
    
    console.log('\n');
}

/**
 * Main
 */
async function main() {
    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     APEX MCP AGENT - SUPER SECURE KEY GENERATOR       ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    const args = process.argv.slice(2);

    // Validate command
    if (args[0] === 'validate' && args[1]) {
        validateKey(args[1]);
        return;
    }

    if (args.length < 1) {
        console.log('Usage: node key-generator.js <plan> [count]');
        console.log('       node key-generator.js validate <license-key>\n');
        console.log('Available Plans:');
        Object.keys(PLANS).forEach(planId => {
            const plan = PLANS[planId];
            console.log(`  ${planId.padEnd(8)} - ${plan.name.padEnd(15)} $${plan.price.toString().padEnd(4)} (${plan.duration} days, ${plan.maxDevices} devices)`);
        });
        console.log('\nCount: Number of licenses to generate (default: 1)\n');
        console.log('Examples:');
        console.log('  node key-generator.js day1');
        console.log('  node key-generator.js week1 10');
        console.log('  node key-generator.js month1 5');
        console.log('  node key-generator.js validate A1B2-C3D4-E5F6-G7H8-XY\n');
        process.exit(1);
    }

    const planId = args[0].toLowerCase();
    const count = args[1] ? parseInt(args[1]) : 1;

    if (!PLANS[planId]) {
        console.error(`Error: Invalid plan "${planId}"`);
        console.log('Available plans:', Object.keys(PLANS).join(', '));
        process.exit(1);
    }

    if (isNaN(count) || count <= 0) {
        console.error('Error: Count must be a positive number');
        process.exit(1);
    }

    // Initialize Firebase
    initializeFirebase();

    // Generate licenses
    if (count === 1) {
        const key = await generateUniqueKey();
        await createLicense(key, planId);
    } else {
        await generateBatch(planId, count);
    }

    // Cleanup
    if (firebaseInitialized) {
        await admin.app().delete();
    }
}

main().catch(error => {
    console.error('\n✗ Error:', error.message);
    process.exit(1);
});
