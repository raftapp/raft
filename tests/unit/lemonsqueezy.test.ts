/**
 * Tests for Lemon Squeezy licensing integration
 *
 * Tests the Pro tier licensing functionality.
 * Mocks all fetch API calls and Chrome storage.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetMockChrome, setMockStorage, getMockStorage, getMockSyncStorage } from '../mocks/chrome'
import {
  getStoredLicense,
  clearLicense,
  deactivateLicense,
  restoreLicenseFromSync,
  validateLicense,
  activateLicense,
  checkLicense,
  openCheckoutPage,
  getPricing,
} from '@/shared/licensing/lemonsqueezy'
import type { LicenseData } from '@/shared/licensing/lemonsqueezy'
import { LICENSE_STORAGE_KEY } from '@/shared/constants'

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('lemonsqueezy', () => {
  beforeEach(() => {
    resetMockChrome()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('getStoredLicense', () => {
    it('should return null when no license exists', async () => {
      const result = await getStoredLicense()
      expect(result).toBeNull()
    })

    it('should return stored license data', async () => {
      const license: LicenseData = {
        key: 'LICENSE-KEY-123',
        status: 'active',
        email: 'user@example.com',
        validatedAt: Date.now(),
        instanceId: 'instance-123',
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })

      const result = await getStoredLicense()
      expect(result).toEqual(license)
    })
  })

  describe('deactivateLicense', () => {
    it('should return true on successful deactivation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          deactivated: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'KEY-123',
            activation_usage: 0,
          },
        }),
      })

      const result = await deactivateLicense('KEY-123', 'instance-abc')
      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('deactivate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            license_key: 'KEY-123',
            instance_id: 'instance-abc',
          }),
        })
      )
    })

    it('should return false when API reports failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          deactivated: false,
          error: 'Instance not found',
        }),
      })

      const result = await deactivateLicense('KEY-123', 'bad-instance')
      expect(result).toBe(false)
    })

    it('should return false on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await deactivateLicense('KEY-123', 'instance-abc')
      expect(result).toBe(false)
    })
  })

  describe('clearLicense', () => {
    it('should remove license from local and sync storage', async () => {
      const license: LicenseData = {
        key: 'LICENSE-KEY-123',
        status: 'active',
        validatedAt: Date.now(),
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: license })

      await clearLicense()

      const localResult = getMockStorage()[LICENSE_STORAGE_KEY]
      const syncResult = getMockSyncStorage()[LICENSE_STORAGE_KEY]
      expect(localResult).toBeUndefined()
      expect(syncResult).toBeUndefined()
    })

    it('should call deactivate API before clearing storage', async () => {
      const license: LicenseData = {
        key: 'KEY-TO-DEACTIVATE',
        status: 'active',
        validatedAt: Date.now(),
        instanceId: 'instance-xyz',
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: license })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ deactivated: true }),
      })

      await clearLicense()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('deactivate'),
        expect.objectContaining({
          body: JSON.stringify({
            license_key: 'KEY-TO-DEACTIVATE',
            instance_id: 'instance-xyz',
          }),
        })
      )
      expect(getMockStorage()[LICENSE_STORAGE_KEY]).toBeUndefined()
      expect(getMockSyncStorage()[LICENSE_STORAGE_KEY]).toBeUndefined()
    })

    it('should still clear storage when deactivate API fails', async () => {
      const license: LicenseData = {
        key: 'KEY-FAIL-DEACTIVATE',
        status: 'active',
        validatedAt: Date.now(),
        instanceId: 'instance-fail',
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: license })

      mockFetch.mockRejectedValue(new Error('Network error'))

      await clearLicense()

      expect(getMockStorage()[LICENSE_STORAGE_KEY]).toBeUndefined()
      expect(getMockSyncStorage()[LICENSE_STORAGE_KEY]).toBeUndefined()
    })

    it('should skip API call when no instanceId exists', async () => {
      const license: LicenseData = {
        key: 'KEY-NO-INSTANCE',
        status: 'active',
        validatedAt: Date.now(),
        // no instanceId
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })

      await clearLicense()

      expect(mockFetch).not.toHaveBeenCalled()
      expect(getMockStorage()[LICENSE_STORAGE_KEY]).toBeUndefined()
    })
  })

  describe('restoreLicenseFromSync', () => {
    it('should return null when no synced license exists', async () => {
      mockFetch.mockResolvedValue({ ok: false })

      const result = await restoreLicenseFromSync()
      expect(result).toBeNull()
    })

    it('should validate and return synced license', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const syncedLicense: LicenseData = {
        key: 'SYNCED-KEY-123',
        status: 'active',
        validatedAt: now - 1000,
      }
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: syncedLicense })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'SYNCED-KEY-123',
          },
          meta: {
            customer_email: 'restored@example.com',
          },
        }),
      })

      const result = await restoreLicenseFromSync()

      expect(result).not.toBeNull()
      expect(result!.key).toBe('SYNCED-KEY-123')
      expect(result!.status).toBe('active')
    })

    it('should return null when synced license is invalid', async () => {
      const syncedLicense: LicenseData = {
        key: 'INVALID-KEY',
        status: 'active',
        validatedAt: Date.now(),
      }
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: syncedLicense })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: false,
          error: 'License not found',
        }),
      })

      const result = await restoreLicenseFromSync()
      expect(result).toBeNull()
    })
  })

  describe('validateLicense', () => {
    it('should return null for invalid license key', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: false,
          error: 'License not found',
        }),
      })

      const result = await validateLicense('INVALID-KEY')
      expect(result).toBeNull()
    })

    it('should return license data for valid key', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 123,
            status: 'active',
            key: 'VALID-KEY-123',
            activation_limit: 3,
            activation_usage: 1,
            created_at: '2024-01-01',
            expires_at: null,
          },
          instance: {
            id: 'instance-456',
            name: 'Raft-123',
            created_at: '2024-01-01',
          },
          meta: {
            store_id: 1,
            product_id: 2,
            product_name: 'Raft Pro',
            variant_id: 3,
            variant_name: 'Lifetime',
            customer_id: 100,
            customer_name: 'John Doe',
            customer_email: 'john@example.com',
          },
        }),
      })

      const result = await validateLicense('VALID-KEY-123')

      expect(result).not.toBeNull()
      expect(result!.key).toBe('VALID-KEY-123')
      expect(result!.status).toBe('active')
      expect(result!.email).toBe('john@example.com')
      expect(result!.validatedAt).toBe(now)
      expect(result!.instanceId).toBe('instance-456')
    })

    it('should save license to local and sync storage', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'KEY-TO-SAVE',
          },
        }),
      })

      await validateLicense('KEY-TO-SAVE')

      const localLicense = getMockStorage()[LICENSE_STORAGE_KEY]
      const syncLicense = getMockSyncStorage()[LICENSE_STORAGE_KEY]

      expect(localLicense).toBeDefined()
      expect(localLicense.key).toBe('KEY-TO-SAVE')
      expect(syncLicense).toBeDefined()
      expect(syncLicense.key).toBe('KEY-TO-SAVE')
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await validateLicense('ANY-KEY')
      expect(result).toBeNull()
    })

    it('should send correct request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: false,
        }),
      })

      await validateLicense('TEST-KEY')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ license_key: 'TEST-KEY' }),
        })
      )
    })
  })

  describe('activateLicense', () => {
    it('should activate and return license data', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activated: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'ACTIVATE-KEY',
          },
          instance: {
            id: 'new-instance',
            name: `Raft-${now}`,
          },
          meta: {
            customer_email: 'activated@example.com',
          },
        }),
      })

      const result = await activateLicense('ACTIVATE-KEY')

      expect(result).not.toBeNull()
      expect(result!.key).toBe('ACTIVATE-KEY')
      expect(result!.instanceId).toBe('new-instance')
    })

    it('should fall back to validation when activation fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            activated: false,
            error: 'Already activated',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            valid: true,
            license_key: {
              id: 1,
              status: 'active',
              key: 'EXISTING-KEY',
            },
          }),
        })

      const result = await activateLicense('EXISTING-KEY')

      expect(result).not.toBeNull()
      expect(result!.key).toBe('EXISTING-KEY')
      expect(mockFetch).toHaveBeenCalledTimes(2) // Activate then validate
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const result = await activateLicense('ANY-KEY')
      expect(result).toBeNull()
    })

    it('should include instance name in activation request', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          activated: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'KEY',
          },
        }),
      })

      await activateLicense('KEY')

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(requestBody.instance_name).toMatch(/^Raft-/)
    })
  })

  describe('checkLicense', () => {
    it('should return isPro: false when no license stored', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ valid: false }),
      })

      const result = await checkLicense()

      expect(result.isPro).toBe(false)
      expect(result.email).toBeUndefined()
    })

    it('should return isPro: true for active cached license within cache duration', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const license: LicenseData = {
        key: 'CACHED-KEY',
        status: 'active',
        email: 'cached@example.com',
        validatedAt: now - 1000, // 1 second ago (within 24h cache)
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })

      const result = await checkLicense()

      expect(result.isPro).toBe(true)
      expect(result.email).toBe('cached@example.com')
      expect(mockFetch).not.toHaveBeenCalled() // Should use cache
    })

    it('should revalidate expired cache', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const license: LicenseData = {
        key: 'OLD-CACHE-KEY',
        status: 'active',
        validatedAt: now - 3 * 60 * 60 * 1000, // 3 hours ago (outside 2h cache)
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'OLD-CACHE-KEY',
          },
          meta: {
            customer_email: 'revalidated@example.com',
          },
        }),
      })

      const result = await checkLicense()

      expect(result.isPro).toBe(true)
      expect(mockFetch).toHaveBeenCalled() // Should revalidate
    })

    it('should return isPro: false for inactive license', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      const license: LicenseData = {
        key: 'INACTIVE-KEY',
        status: 'inactive',
        validatedAt: now, // Fresh cache
      }
      await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: license })

      // Mock validation response for revalidation
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 1,
            status: 'inactive',
            key: 'INACTIVE-KEY',
          },
        }),
      })

      const result = await checkLicense()
      expect(result.isPro).toBe(false)
    })

    it('should try to restore from sync when no local license', async () => {
      const syncedLicense: LicenseData = {
        key: 'SYNCED-KEY',
        status: 'active',
        email: 'synced@example.com',
        validatedAt: Date.now(),
      }
      await chrome.storage.sync.set({ [LICENSE_STORAGE_KEY]: syncedLicense })

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: true,
          license_key: {
            id: 1,
            status: 'active',
            key: 'SYNCED-KEY',
          },
          meta: {
            customer_email: 'synced@example.com',
          },
        }),
      })

      const result = await checkLicense()

      expect(result.isPro).toBe(true)
      expect(result.email).toBe('synced@example.com')
    })
  })

  describe('openCheckoutPage', () => {
    it('should create a new tab with checkout URL', () => {
      openCheckoutPage()

      expect(chrome.tabs.create).toHaveBeenCalledWith({
        url: expect.stringContaining('lemonsqueezy'),
      })
    })
  })

  describe('getPricing', () => {
    it('should return pricing information', () => {
      const pricing = getPricing()

      expect(pricing.price).toBe(25)
      expect(pricing.currency).toBe('USD')
      expect(pricing.description).toContain('lifetime')
    })
  })
})
