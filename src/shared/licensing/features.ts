/**
 * Feature Gating
 *
 * Controls which features are available in Free vs Pro tiers.
 */

import { checkLicense } from './lemonsqueezy'
import { browser } from '../browser'

/**
 * Feature flags for different tiers
 */
export interface FeatureFlags {
  // Free features (everyone)
  unlimitedLocalSessions: boolean
  allSuspensionFeatures: boolean
  importExport: boolean
  sessionOrganization: boolean
  localBackup: boolean

  // Pro features
  cloudSync: boolean
  prioritySupport: boolean
}

/**
 * Free tier feature flags
 */
const FREE_FEATURES: FeatureFlags = {
  // Free
  unlimitedLocalSessions: true,
  allSuspensionFeatures: true,
  importExport: true,
  sessionOrganization: true,
  localBackup: true,

  // Pro only
  cloudSync: false,
  prioritySupport: false,
}

/**
 * Pro tier feature flags
 */
const PRO_FEATURES: FeatureFlags = {
  ...FREE_FEATURES,
  cloudSync: true,
  prioritySupport: true,
}

/**
 * Check if user is Pro.
 *
 * The dev-only override lets us exercise Pro flows locally without a real
 * Lemon Squeezy license. It is gated by `import.meta.env.DEV` so that Vite
 * dead-code-eliminates the entire block (key lookup + storage read) in
 * production builds — the storage key literal never reaches the shipped JS.
 */
export async function isProUser(): Promise<boolean> {
  if (import.meta.env.DEV) {
    const result = await browser.storage.local.get('raft:dev:proOverride')
    if (result['raft:dev:proOverride']) return true
  }
  const { isPro } = await checkLicense()
  return isPro
}

/**
 * Get feature flags for current user
 */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  const isPro = await isProUser()
  return isPro ? PRO_FEATURES : FREE_FEATURES
}

/**
 * Check if a specific feature is available
 */
export async function canUseFeature(feature: keyof FeatureFlags): Promise<boolean> {
  const flags = await getFeatureFlags()
  return flags[feature]
}

/**
 * Check if cloud sync is available
 */
export async function canUseCloudSync(): Promise<boolean> {
  return canUseFeature('cloudSync')
}

/**
 * Feature descriptions for UI
 */
export const FEATURE_DESCRIPTIONS: Record<keyof FeatureFlags, string> = {
  unlimitedLocalSessions: 'Save unlimited sessions locally',
  allSuspensionFeatures: 'Auto-suspend, manual suspend, protection rules',
  importExport: 'Import from OneTab, Session Buddy, and more',
  sessionOrganization: 'Folders, tags, and search',
  localBackup: 'Automatic backup to Chrome sync storage',
  cloudSync: 'Sync sessions to Google Drive across devices',
  prioritySupport: 'Priority email support',
}

/**
 * Free tier feature list
 */
export const FREE_FEATURE_LIST = [
  'Unlimited local sessions',
  'All suspension features',
  'Import/export (JSON, OneTab, Session Buddy)',
  'Session organization (folders, tags, search)',
  'Automatic Chrome sync backup',
]

/**
 * Pro tier feature list (additional to free)
 */
export const PRO_FEATURE_LIST = [
  'Google Drive cloud sync',
  'End-to-end encryption',
  'Sync across unlimited devices',
  'Priority support',
]
