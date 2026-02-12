/**
 * Tests for licensing and feature gating
 *
 * Tests the Pro tier feature flags and license checking logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetMockChrome, setMockStorage } from '../mocks/chrome'
import {
  isProUser,
  getFeatureFlags,
  canUseFeature,
  canUseCloudSync,
  FEATURE_DESCRIPTIONS,
  FREE_FEATURE_LIST,
  PRO_FEATURE_LIST,
} from '@/shared/licensing/features'
import type { FeatureFlags } from '@/shared/licensing/features'
import * as lemonsqueezy from '@/shared/licensing/lemonsqueezy'

// Mock the lemonsqueezy module
vi.mock('@/shared/licensing/lemonsqueezy', () => ({
  checkLicense: vi.fn(),
}))

describe('licensing/features', () => {
  beforeEach(() => {
    resetMockChrome()
    vi.clearAllMocks()
  })

  describe('isProUser', () => {
    it('should return true when user has Pro license', async () => {
      vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({
        isPro: true,
        email: 'pro@example.com',
      })

      const result = await isProUser()
      expect(result).toBe(true)
    })

    it('should return false when user does not have Pro license', async () => {
      vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({
        isPro: false,
      })

      const result = await isProUser()
      expect(result).toBe(false)
    })

    it('should call checkLicense from lemonsqueezy', async () => {
      vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: false })

      await isProUser()

      expect(lemonsqueezy.checkLicense).toHaveBeenCalled()
    })
  })

  describe('getFeatureFlags', () => {
    describe('Free tier', () => {
      beforeEach(() => {
        vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: false })
      })

      it('should return correct free tier features', async () => {
        const flags = await getFeatureFlags()

        // Free features should be enabled
        expect(flags.unlimitedLocalSessions).toBe(true)
        expect(flags.allSuspensionFeatures).toBe(true)
        expect(flags.importExport).toBe(true)
        expect(flags.sessionOrganization).toBe(true)
        expect(flags.localBackup).toBe(true)

        // Pro features should be disabled
        expect(flags.cloudSync).toBe(false)
        expect(flags.prioritySupport).toBe(false)
      })
    })

    describe('Pro tier', () => {
      beforeEach(() => {
        vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({
          isPro: true,
          email: 'pro@example.com',
        })
      })

      it('should return all features enabled', async () => {
        const flags = await getFeatureFlags()

        // All features should be enabled for Pro
        expect(flags.unlimitedLocalSessions).toBe(true)
        expect(flags.allSuspensionFeatures).toBe(true)
        expect(flags.importExport).toBe(true)
        expect(flags.sessionOrganization).toBe(true)
        expect(flags.localBackup).toBe(true)
        expect(flags.cloudSync).toBe(true)
        expect(flags.prioritySupport).toBe(true)
      })
    })
  })

  describe('canUseFeature', () => {
    describe('Free tier', () => {
      beforeEach(() => {
        vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: false })
      })

      it('should return true for free features', async () => {
        expect(await canUseFeature('unlimitedLocalSessions')).toBe(true)
        expect(await canUseFeature('allSuspensionFeatures')).toBe(true)
        expect(await canUseFeature('importExport')).toBe(true)
        expect(await canUseFeature('sessionOrganization')).toBe(true)
        expect(await canUseFeature('localBackup')).toBe(true)
      })

      it('should return false for Pro features', async () => {
        expect(await canUseFeature('cloudSync')).toBe(false)
        expect(await canUseFeature('prioritySupport')).toBe(false)
      })
    })

    describe('Pro tier', () => {
      beforeEach(() => {
        vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: true })
      })

      it('should return true for all features', async () => {
        expect(await canUseFeature('unlimitedLocalSessions')).toBe(true)
        expect(await canUseFeature('allSuspensionFeatures')).toBe(true)
        expect(await canUseFeature('importExport')).toBe(true)
        expect(await canUseFeature('sessionOrganization')).toBe(true)
        expect(await canUseFeature('localBackup')).toBe(true)
        expect(await canUseFeature('cloudSync')).toBe(true)
        expect(await canUseFeature('prioritySupport')).toBe(true)
      })
    })
  })

  describe('canUseCloudSync', () => {
    it('should return false for free users', async () => {
      vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: false })

      const result = await canUseCloudSync()
      expect(result).toBe(false)
    })

    it('should return true for Pro users', async () => {
      vi.mocked(lemonsqueezy.checkLicense).mockResolvedValue({ isPro: true })

      const result = await canUseCloudSync()
      expect(result).toBe(true)
    })
  })

  describe('FEATURE_DESCRIPTIONS', () => {
    it('should have meaningful descriptions for all features', () => {
      // Verify descriptions contain meaningful content, not just placeholder text
      expect(FEATURE_DESCRIPTIONS.cloudSync).toContain('Google Drive')
      expect(FEATURE_DESCRIPTIONS.prioritySupport).toContain('support')
      expect(FEATURE_DESCRIPTIONS.importExport).toContain('Import')
      expect(FEATURE_DESCRIPTIONS.unlimitedLocalSessions).toContain('session')
      expect(FEATURE_DESCRIPTIONS.allSuspensionFeatures).toContain('suspend')
      expect(FEATURE_DESCRIPTIONS.sessionOrganization.toLowerCase()).toContain('folder')
      expect(FEATURE_DESCRIPTIONS.localBackup).toContain('backup')
    })
  })

  describe('FREE_FEATURE_LIST', () => {
    it('should contain expected free tier features and no Pro features', () => {
      expect(FREE_FEATURE_LIST).toContain('Unlimited local sessions')
      expect(FREE_FEATURE_LIST).toContain('All suspension features')

      // Should not contain Pro features
      const lowerCaseList = FREE_FEATURE_LIST.map(f => f.toLowerCase())
      expect(lowerCaseList.some(f => f.includes('cloud sync'))).toBe(false)
    })
  })

  describe('PRO_FEATURE_LIST', () => {
    it('should contain expected Pro tier features', () => {
      expect(PRO_FEATURE_LIST.some(f => f.toLowerCase().includes('sync'))).toBe(true)
      expect(PRO_FEATURE_LIST.some(f => f.toLowerCase().includes('encryption'))).toBe(true)
      expect(PRO_FEATURE_LIST.some(f => f.toLowerCase().includes('support'))).toBe(true)
    })
  })
})
