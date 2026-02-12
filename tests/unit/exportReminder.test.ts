/**
 * Tests for Export Reminder functionality
 *
 * Tests the export reminder state management and triggers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resetMockChrome } from '../mocks/chrome'
import { settingsStorage, storage } from '@/shared/storage'
import { STORAGE_KEYS, EXPORT_REMINDER_CONFIG } from '@/shared/constants'
import { DEFAULT_SETTINGS } from '@/shared/types'

describe('Export Reminder Settings', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('DEFAULT_SETTINGS', () => {
    it('should have exportReminder enabled by default', () => {
      expect(DEFAULT_SETTINGS.exportReminder).toBeDefined()
      expect(DEFAULT_SETTINGS.exportReminder.enabled).toBe(true)
      expect(DEFAULT_SETTINGS.exportReminder.intervalDays).toBe(30)
    })
  })

  describe('settingsStorage with exportReminder', () => {
    it('should save and retrieve exportReminder settings', async () => {
      const settings = await settingsStorage.get()

      // Update export reminder settings
      const updated = await settingsStorage.update({
        exportReminder: {
          enabled: false,
          intervalDays: 14,
          lastExportDate: 1234567890,
        },
      })

      expect(updated.exportReminder.enabled).toBe(false)
      expect(updated.exportReminder.intervalDays).toBe(14)
      expect(updated.exportReminder.lastExportDate).toBe(1234567890)
    })

    it('should preserve other settings when updating exportReminder', async () => {
      // Set up initial settings
      await settingsStorage.update({
        suspension: { enabled: true, inactivityMinutes: 45 },
      })

      // Update only exportReminder
      const updated = await settingsStorage.update({
        exportReminder: { enabled: false },
      })

      // Verify suspension settings preserved
      expect(updated.suspension.inactivityMinutes).toBe(45)
    })

    it('should track lastMilestoneReached', async () => {
      const updated = await settingsStorage.update({
        exportReminder: {
          lastMilestoneReached: 100,
        },
      })

      expect(updated.exportReminder.lastMilestoneReached).toBe(100)
    })
  })
})

describe('Export Reminder State Storage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  it('should store and retrieve export reminder state', async () => {
    const state = {
      pending: true,
      reason: 'time' as const,
      daysSinceExport: 35,
      triggeredAt: Date.now(),
    }

    await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, state)
    const retrieved = await storage.get(STORAGE_KEYS.EXPORT_REMINDER_STATE, null)

    expect(retrieved).not.toBeNull()
    expect(retrieved.pending).toBe(true)
    expect(retrieved.reason).toBe('time')
    expect(retrieved.daysSinceExport).toBe(35)
  })

  it('should store milestone-based reminder state', async () => {
    const state = {
      pending: true,
      reason: 'milestone' as const,
      milestone: 100,
      triggeredAt: Date.now(),
    }

    await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, state)
    const retrieved = await storage.get(STORAGE_KEYS.EXPORT_REMINDER_STATE, null)

    expect(retrieved.reason).toBe('milestone')
    expect(retrieved.milestone).toBe(100)
  })

  it('should clear reminder state', async () => {
    await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, { pending: true, reason: 'time', triggeredAt: Date.now() })
    await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)

    const retrieved = await storage.get(STORAGE_KEYS.EXPORT_REMINDER_STATE, null)
    expect(retrieved).toBeNull()
  })
})

describe('Export Reminder Configuration', () => {
  it('should have correct default interval', () => {
    expect(EXPORT_REMINDER_CONFIG.DEFAULT_INTERVAL_DAYS).toBe(30)
  })

  it('should have milestone thresholds defined', () => {
    expect(EXPORT_REMINDER_CONFIG.MILESTONES).toContain(50)
    expect(EXPORT_REMINDER_CONFIG.MILESTONES).toContain(100)
    expect(EXPORT_REMINDER_CONFIG.MILESTONES).toContain(200)
    expect(EXPORT_REMINDER_CONFIG.MILESTONES).toContain(500)
    expect(EXPORT_REMINDER_CONFIG.MILESTONES).toContain(1000)
  })

  it('should have milestones in ascending order', () => {
    const milestones = EXPORT_REMINDER_CONFIG.MILESTONES
    for (let i = 1; i < milestones.length; i++) {
      expect(milestones[i]).toBeGreaterThan(milestones[i - 1])
    }
  })
})

describe('Export Reminder Integration', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  it('should track lastExportDate when marking export complete', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    // Simulate marking export complete
    const settings = await settingsStorage.get()
    await settingsStorage.update({
      exportReminder: { ...settings.exportReminder, lastExportDate: now },
    })

    const updated = await settingsStorage.get()
    expect(updated.exportReminder.lastExportDate).toBe(now)

    vi.useRealTimers()
  })

  it('should clear pending reminder when dismissed', async () => {
    // Set a pending reminder
    await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, {
      pending: true,
      reason: 'time',
      daysSinceExport: 45,
      triggeredAt: Date.now(),
    })

    // Dismiss it
    await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)

    const state = await storage.get(STORAGE_KEYS.EXPORT_REMINDER_STATE, null)
    expect(state).toBeNull()
  })

  it('should update milestone tracking when triggered', async () => {
    const settings = await settingsStorage.get()
    await settingsStorage.update({
      exportReminder: { ...settings.exportReminder, lastMilestoneReached: 100 },
    })

    const updated = await settingsStorage.get()
    expect(updated.exportReminder.lastMilestoneReached).toBe(100)
  })
})
