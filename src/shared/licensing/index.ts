/**
 * Licensing module public API
 */

export {
  checkLicense,
  validateLicense,
  activateLicense,
  getStoredLicense,
  clearLicense,
  restoreLicenseFromSync,
  openCheckoutPage,
  getPricing,
} from './lemonsqueezy'

export type { LicenseData } from './lemonsqueezy'

export {
  isProUser,
  getFeatureFlags,
  canUseFeature,
  canUseCloudSync,
  FEATURE_DESCRIPTIONS,
  FREE_FEATURE_LIST,
  PRO_FEATURE_LIST,
} from './features'

export type { FeatureFlags } from './features'
