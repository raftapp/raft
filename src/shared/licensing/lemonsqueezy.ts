/**
 * Lemon Squeezy Integration
 *
 * Handles Pro tier licensing using Lemon Squeezy (https://lemonsqueezy.com)
 *
 * Lemon Squeezy provides:
 * - Merchant of Record (handles VAT/GST globally)
 * - License key validation API
 * - Professional checkout experience
 * - Multiple payment methods
 */

import { LEMONSQUEEZY, LICENSE_STORAGE_KEY } from '../constants'
import { storage } from '../storage'

/**
 * Stored license data
 */
export interface LicenseData {
  /** The license key */
  key: string
  /** License status */
  status: 'active' | 'inactive' | 'expired' | 'disabled'
  /** Customer email */
  email?: string
  /** When the license was validated */
  validatedAt: number
  /** License instance ID (from activation) */
  instanceId?: string
}

/**
 * Lemon Squeezy API response for license validation
 */
interface ValidateLicenseResponse {
  valid: boolean
  error?: string
  license_key?: {
    id: number
    status: string
    key: string
    activation_limit: number
    activation_usage: number
    created_at: string
    expires_at: string | null
  }
  instance?: {
    id: string
    name: string
    created_at: string
  }
  meta?: {
    store_id: number
    product_id: number
    product_name: string
    variant_id: number
    variant_name: string
    customer_id: number
    customer_name: string
    customer_email: string
  }
}

/**
 * Lemon Squeezy API response for license activation
 * Uses `activated` instead of `valid` (which is only on the validate endpoint)
 */
interface ActivateLicenseResponse {
  activated: boolean
  error?: string
  license_key?: {
    id: number
    status: string
    key: string
    activation_limit: number
    activation_usage: number
    created_at: string
    expires_at: string | null
  }
  instance?: {
    id: string
    name: string
    created_at: string
  }
  meta?: {
    store_id: number
    product_id: number
    product_name: string
    variant_id: number
    variant_name: string
    customer_id: number
    customer_name: string
    customer_email: string
  }
}

/**
 * Cache duration: 2 hours (short enough to catch revoked/refunded licenses promptly)
 */
const CACHE_DURATION_MS = 2 * 60 * 60 * 1000

/**
 * Get stored license data
 */
export async function getStoredLicense(): Promise<LicenseData | null> {
  return storage.get<LicenseData | null>(LICENSE_STORAGE_KEY, null)
}

/**
 * Save license data
 */
async function saveLicense(license: LicenseData): Promise<void> {
  await storage.set(LICENSE_STORAGE_KEY, license)
  // Also save to sync storage so it syncs across devices
  await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: license })
}

/**
 * Clear stored license
 */
export async function clearLicense(): Promise<void> {
  await storage.remove(LICENSE_STORAGE_KEY)
  await chrome.storage.sync.remove(LICENSE_STORAGE_KEY)
}

/**
 * Try to restore license from sync storage (for new installs)
 */
export async function restoreLicenseFromSync(): Promise<LicenseData | null> {
  const result = await chrome.storage.sync.get(LICENSE_STORAGE_KEY)
  const synced = result[LICENSE_STORAGE_KEY] as LicenseData | undefined

  if (synced?.key) {
    // Validate the synced license
    const validated = await validateLicense(synced.key)
    if (validated) {
      return validated
    }
  }

  return null
}

/**
 * Validate a license key with Lemon Squeezy API
 */
export async function validateLicense(licenseKey: string): Promise<LicenseData | null> {
  try {
    const response = await fetch(LEMONSQUEEZY.VALIDATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        license_key: licenseKey,
      }),
    })

    const data: ValidateLicenseResponse = await response.json()

    if (!data.valid || !data.license_key) {
      console.warn('[Raft] License validation failed:', data.error)
      return null
    }

    const license: LicenseData = {
      key: licenseKey,
      status: data.license_key.status as LicenseData['status'],
      email: data.meta?.customer_email,
      validatedAt: Date.now(),
      instanceId: data.instance?.id,
    }

    await saveLicense(license)
    return license
  } catch (err) {
    console.error('[Raft] License validation error:', err)
    return null
  }
}

/**
 * Activate a license key (increments activation count)
 */
export async function activateLicense(licenseKey: string): Promise<LicenseData | null> {
  try {
    // Generate a unique instance name for this device
    const instanceName = `Raft-${Date.now()}`

    const response = await fetch(LEMONSQUEEZY.ACTIVATE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: instanceName,
      }),
    })

    const data: ActivateLicenseResponse = await response.json()

    if (!data.activated || !data.license_key) {
      console.warn('[Raft] License activation failed:', data.error)
      // If activation fails, try just validating (maybe already activated)
      return validateLicense(licenseKey)
    }

    const license: LicenseData = {
      key: licenseKey,
      status: data.license_key.status as LicenseData['status'],
      email: data.meta?.customer_email,
      validatedAt: Date.now(),
      instanceId: data.instance?.id,
    }

    await saveLicense(license)
    return license
  } catch (err) {
    console.error('[Raft] License activation error:', err)
    return null
  }
}

/**
 * Check if user has valid Pro license
 * Uses cached data if recent enough, otherwise revalidates
 */
export async function checkLicense(): Promise<{ isPro: boolean; email?: string }> {
  const stored = await getStoredLicense()

  // No license stored
  if (!stored?.key) {
    // Try to restore from sync
    const synced = await restoreLicenseFromSync()
    if (synced?.status === 'active') {
      return { isPro: true, email: synced.email }
    }
    return { isPro: false }
  }

  // Check if cache is fresh enough
  const cacheAge = Date.now() - stored.validatedAt
  if (cacheAge < CACHE_DURATION_MS && stored.status === 'active') {
    return { isPro: true, email: stored.email }
  }

  // Revalidate
  const validated = await validateLicense(stored.key)
  if (validated?.status === 'active') {
    return { isPro: true, email: validated.email }
  }

  return { isPro: false }
}

/**
 * Open the Lemon Squeezy checkout page
 */
export function openCheckoutPage(): void {
  // Open checkout in new tab
  chrome.tabs.create({ url: LEMONSQUEEZY.CHECKOUT_URL })
}

/**
 * Get pricing information
 */
export function getPricing(): { price: number; currency: string; description: string } {
  return {
    price: 25,
    currency: 'USD',
    description: 'One-time payment, lifetime access',
  }
}
