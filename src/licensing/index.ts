/**
 * LICENSING MODULE
 * 
 * Exports all licensing components.
 */

export { DeviceFingerprint } from './device-fingerprint';
export { HiddenStorage } from './hidden-storage';
export { FirebaseClient, LicenseInfo, ValidationResponse } from './firebase-client';
export { LicenseValidator, LicenseStatus, LicenseState } from './license-validator';
export { ActivationUI } from './activation-ui';
export { PRICING_PLANS, PricingPlan, getPlanById, getPlanByDuration, formatPrice, getPricePerDay } from './plans';
export { CryptoLock, RequiresLicense, guardExecution } from './crypto-lock';
export { IntegrityChecker } from './integrity-check';
