/**
 * Suspension Flow Integration Tests
 *
 * End-to-end tests for the complete suspension lifecycle using
 * Chrome's native tabs.discard() API.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  setMockStorage,
  addMockTab,
  addMockWindow,
  getMockTabs,
} from '../mocks/chrome'
import {
  suspendTab,
  suspendOtherTabs,
  suspendAllTabs,
  restoreAllTabs,
} from '@/background/suspension'
import { STORAGE_KEYS } from '@/shared/constants'

describe('Suspension Flow Integration', () => {
  describe('suspend -> restore cycle', () => {
    beforeEach(() => {
      addMockWindow({ id: 1, focused: true })
    })

    it('should suspend and restore a tab preserving URL', async () => {
      const originalUrl = 'https://example.com/article?id=123#section'
      addMockTab({
        id: 1,
        windowId: 1,
        url: originalUrl,
        title: 'Test Article',
        active: false,
      })

      // Suspend (discard)
      const suspended = await suspendTab(1)
      expect(suspended).toBe(true)

      let tabs = getMockTabs()
      expect(tabs[0].discarded).toBe(true)
      // URL stays the same with native discard
      expect(tabs[0].url).toBe(originalUrl)

      // Restore (reload)
      await restoreAllTabs(1)

      tabs = getMockTabs()
      expect(tabs[0].discarded).toBe(false)
      expect(tabs[0].url).toBe(originalUrl)
    })

    it('should handle multiple suspend/restore cycles', async () => {
      const url = 'https://example.com'
      addMockTab({
        id: 1,
        windowId: 1,
        url,
        title: 'Test',
        active: false,
      })

      // Cycle 1
      await suspendTab(1)
      expect(getMockTabs()[0].discarded).toBe(true)
      await restoreAllTabs(1)
      expect(getMockTabs()[0].discarded).toBe(false)

      // Cycle 2
      await suspendTab(1)
      expect(getMockTabs()[0].discarded).toBe(true)
      await restoreAllTabs(1)
      expect(getMockTabs()[0].discarded).toBe(false)

      // Cycle 3
      await suspendTab(1)
      expect(getMockTabs()[0].discarded).toBe(true)
      await restoreAllTabs(1)
      expect(getMockTabs()[0].discarded).toBe(false)

      const tabs = getMockTabs()
      expect(tabs[0].url).toBe(url)
    })
  })

  describe('bulk suspension', () => {
    beforeEach(() => {
      addMockWindow({ id: 1, focused: true })
      addMockWindow({ id: 2, focused: false })
    })

    it('should suspend all other tabs in window', async () => {
      // Window 1: active tab + 2 other tabs
      addMockTab({ id: 1, windowId: 1, url: 'https://active.com', active: true })
      addMockTab({ id: 2, windowId: 1, url: 'https://other1.com', active: false })
      addMockTab({ id: 3, windowId: 1, url: 'https://other2.com', active: false })

      // Window 2: should not be affected
      addMockTab({ id: 4, windowId: 2, url: 'https://window2.com', active: false })

      const count = await suspendOtherTabs(1)

      expect(count).toBe(2)

      const tabs = getMockTabs()

      // Active tab not suspended
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(false)

      // Other tabs in window 1 suspended
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 3)?.discarded).toBe(true)

      // Window 2 tab not affected
      expect(tabs.find((t) => t.id === 4)?.discarded).toBe(false)
    })

    it('should suspend all tabs across all windows including active tabs', async () => {
      addMockTab({ id: 1, windowId: 1, url: 'https://w1-active.com', active: true })
      addMockTab({ id: 2, windowId: 1, url: 'https://w1-other.com', active: false })
      addMockTab({ id: 3, windowId: 2, url: 'https://w2-active.com', active: true })
      addMockTab({ id: 4, windowId: 2, url: 'https://w2-other.com', active: false })

      const count = await suspendAllTabs()

      expect(count).toBe(4) // All tabs including previously active ones

      const tabs = getMockTabs()

      // All tabs should be suspended
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 3)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 4)?.discarded).toBe(true)
    })

    it('should restore all suspended tabs in window', async () => {
      // Create already-discarded tabs
      addMockTab({
        id: 1,
        windowId: 1,
        url: 'https://tab1.com',
        active: false,
        discarded: true,
      })
      addMockTab({
        id: 2,
        windowId: 1,
        url: 'https://tab2.com',
        active: false,
        discarded: true,
      })
      addMockTab({
        id: 3,
        windowId: 1,
        url: 'https://not-suspended.com',
        active: true,
        discarded: false,
      })

      const count = await restoreAllTabs(1)

      expect(count).toBe(2)

      const tabs = getMockTabs()
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 3)?.discarded).toBe(false)
    })
  })

  describe('protection rules in bulk operations', () => {
    beforeEach(() => {
      addMockWindow({ id: 1, focused: true })
    })

    it('should respect protection rules when suspending all tabs', async () => {
      // Normal tab - should be suspended
      addMockTab({
        id: 1,
        windowId: 1,
        url: 'https://normal.com',
        active: false,
        pinned: false,
        audible: false,
      })

      // Pinned tab - should not be suspended
      addMockTab({
        id: 2,
        windowId: 1,
        url: 'https://pinned.com',
        active: false,
        pinned: true,
        audible: false,
      })

      // Audio tab - should not be suspended
      addMockTab({
        id: 3,
        windowId: 1,
        url: 'https://music.com',
        active: false,
        pinned: false,
        audible: true,
      })

      // Protected URL - should not be suspended
      addMockTab({
        id: 4,
        windowId: 1,
        url: 'chrome://settings',
        active: false,
        pinned: false,
        audible: false,
      })

      const count = await suspendAllTabs()

      expect(count).toBe(1) // Only the normal tab

      const tabs = getMockTabs()
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 3)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 4)?.discarded).toBe(false)
    })

    it('should respect whitelist in bulk operations', async () => {
      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          suspension: {
            enabled: true,
            neverSuspendPinned: true,
            neverSuspendAudio: true,
            whitelist: ['*google.com*'],
          },
        },
      })

      addMockTab({
        id: 1,
        windowId: 1,
        url: 'https://mail.google.com',
        active: false,
        pinned: false,
        audible: false,
      })

      addMockTab({
        id: 2,
        windowId: 1,
        url: 'https://example.com',
        active: false,
        pinned: false,
        audible: false,
      })

      const count = await suspendAllTabs()

      expect(count).toBe(1) // Only non-whitelisted

      const tabs = getMockTabs()
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(true)
    })
  })

  describe('inactivity-based auto-suspension', () => {
    beforeEach(() => {
      addMockWindow({ id: 1, focused: true })
    })

    it('should auto-suspend inactive tabs while preserving active ones', async () => {
      const thirtyMinutesAgo = Date.now() - 35 * 60 * 1000
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000

      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          suspension: {
            enabled: true,
            inactivityMinutes: 30,
            neverSuspendPinned: true,
            neverSuspendAudio: true,
            whitelist: [],
          },
        },
        [STORAGE_KEYS.TAB_ACTIVITY]: {
          1: thirtyMinutesAgo, // Inactive
          2: fiveMinutesAgo,   // Recently active
          3: thirtyMinutesAgo, // Inactive but active tab
        },
      })

      addMockTab({
        id: 1,
        windowId: 1,
        url: 'https://inactive.com',
        active: false,
        pinned: false,
        audible: false,
      })

      addMockTab({
        id: 2,
        windowId: 1,
        url: 'https://recent.com',
        active: false,
        pinned: false,
        audible: false,
      })

      addMockTab({
        id: 3,
        windowId: 1,
        url: 'https://active-tab.com',
        active: true, // Currently active
        pinned: false,
        audible: false,
      })

      const { checkForInactiveTabs } = await import('@/background/suspension')
      const count = await checkForInactiveTabs()

      expect(count).toBe(1) // Only tab 1

      const tabs = getMockTabs()
      expect(tabs.find((t) => t.id === 1)?.discarded).toBe(true)
      expect(tabs.find((t) => t.id === 2)?.discarded).toBe(false)
      expect(tabs.find((t) => t.id === 3)?.discarded).toBe(false)
    })
  })
})
