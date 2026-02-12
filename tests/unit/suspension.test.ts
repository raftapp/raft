/**
 * Suspension Logic Tests
 *
 * Tests for tab suspension including protection rules and inactivity detection.
 * Uses Chrome's native tabs.discard() API for tab suspension.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setMockStorage,
  addMockTab,
  addMockWindow,
  getMockTabs,
} from '../mocks/chrome'
import {
  canSuspendTab,
  suspendTab,
  checkForInactiveTabs,
  getTabCounts,
  restoreAllTabs,
} from '@/background/suspension'
import { STORAGE_KEYS } from '@/shared/constants'
import { DEFAULT_SETTINGS } from '@/shared/types'
import type { Settings } from '@/shared/types'

describe('canSuspendTab', () => {
  const defaultSettings: Settings = DEFAULT_SETTINGS

  describe('basic protection rules', () => {
    it('should not suspend tabs without URL', async () => {
      const tab = { id: 1 } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('No URL')
    })

    it('should not suspend already discarded tabs', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        discarded: true,
      } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Already discarded')
    })

    it('should not suspend chrome:// URLs', async () => {
      const tab = { id: 1, url: 'chrome://settings' } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Protected URL')
    })

    it('should not suspend chrome-extension:// URLs', async () => {
      const tab = {
        id: 1,
        url: 'chrome-extension://some-extension/popup.html',
      } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Protected URL')
    })

    it('should not suspend edge:// URLs', async () => {
      const tab = { id: 1, url: 'edge://settings' } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Protected URL')
    })

    it('should not suspend about: URLs', async () => {
      const tab = { id: 1, url: 'about:blank' } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Protected URL')
    })

    it('should not suspend file:// URLs', async () => {
      const tab = { id: 1, url: 'file:///home/user/document.html' } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Protected URL')
    })

    it('should allow normal HTTP URLs', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        pinned: false,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const result = await canSuspendTab(tab, defaultSettings)

      expect(result.canSuspend).toBe(true)
      expect(result.reason).toBeUndefined()
    })
  })

  describe('pinned tab protection', () => {
    it('should not suspend pinned tabs when setting enabled', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        pinned: true,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: { ...defaultSettings.suspension, neverSuspendPinned: true },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Pinned tab')
    })

    it('should allow suspending pinned tabs when setting disabled', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        pinned: true,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: { ...defaultSettings.suspension, neverSuspendPinned: false },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(true)
    })
  })

  describe('audio protection', () => {
    it('should not suspend tabs playing audio when setting enabled', async () => {
      const tab = {
        id: 1,
        url: 'https://youtube.com/watch',
        pinned: false,
        audible: true,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: { ...defaultSettings.suspension, neverSuspendAudio: true },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Playing audio')
    })

    it('should allow suspending audio tabs when setting disabled', async () => {
      const tab = {
        id: 1,
        url: 'https://youtube.com/watch',
        pinned: false,
        audible: true,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: { ...defaultSettings.suspension, neverSuspendAudio: false },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(true)
    })
  })

  describe('whitelist protection', () => {
    it('should not suspend whitelisted URLs (exact match)', async () => {
      const tab = {
        id: 1,
        url: 'https://mail.google.com/mail/u/0/',
        pinned: false,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: {
          ...defaultSettings.suspension,
          whitelist: ['https://mail.google.com/mail/u/0/'],
        },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Whitelisted')
    })

    it('should not suspend whitelisted URLs (wildcard)', async () => {
      const tab = {
        id: 1,
        url: 'https://mail.google.com/mail/u/0/inbox',
        pinned: false,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: {
          ...defaultSettings.suspension,
          whitelist: ['https://mail.google.com/*'],
        },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Whitelisted')
    })

    it('should not suspend whitelisted URLs (domain wildcard)', async () => {
      const tab = {
        id: 1,
        url: 'https://www.github.com/user/repo/issues',
        pinned: false,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: {
          ...defaultSettings.suspension,
          whitelist: ['*github.com*'],
        },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Whitelisted')
    })

    it('should allow non-whitelisted URLs', async () => {
      const tab = {
        id: 1,
        url: 'https://example.com',
        pinned: false,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const settings: Settings = {
        ...defaultSettings,
        suspension: {
          ...defaultSettings.suspension,
          whitelist: ['https://mail.google.com/*'],
        },
      }

      const result = await canSuspendTab(tab, settings)

      expect(result.canSuspend).toBe(true)
    })
  })

  describe('loading settings from storage', () => {
    it('should load settings from storage when not provided', async () => {
      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          suspension: { neverSuspendPinned: true },
        },
      })

      const tab = {
        id: 1,
        url: 'https://example.com',
        pinned: true,
        audible: false,
        discarded: false,
      } as chrome.tabs.Tab

      const result = await canSuspendTab(tab)

      expect(result.canSuspend).toBe(false)
      expect(result.reason).toBe('Pinned tab')
    })
  })
})

describe('suspendTab', () => {
  beforeEach(() => {
    const win = addMockWindow({ id: 1, focused: true })
    addMockTab({
      id: 1,
      windowId: win.id,
      url: 'https://example.com',
      title: 'Example',
      active: false,
    })
  })

  it('should suspend a tab by discarding it', async () => {
    const result = await suspendTab(1)

    expect(result).toBe(true)

    const tabs = getMockTabs()
    const tab = tabs.find((t) => t.id === 1)
    expect(tab?.discarded).toBe(true)
    // URL should remain unchanged with native discard
    expect(tab?.url).toBe('https://example.com')
  })

  it('should return false for protected tabs', async () => {
    addMockTab({
      id: 2,
      windowId: 1,
      url: 'chrome://settings',
      title: 'Settings',
      active: false,
    })

    const result = await suspendTab(2)

    expect(result).toBe(false)
  })

  it('should return false for nonexistent tabs', async () => {
    const result = await suspendTab(999)

    expect(result).toBe(false)
  })
})

describe('restoreAllTabs', () => {
  beforeEach(() => {
    addMockWindow({ id: 1, focused: true })
  })

  it('should restore discarded tabs by reloading them', async () => {
    // Create discarded tabs
    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://tab1.com',
      title: 'Tab 1',
      active: false,
      discarded: true,
    })
    addMockTab({
      id: 2,
      windowId: 1,
      url: 'https://tab2.com',
      title: 'Tab 2',
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

describe('checkForInactiveTabs', () => {
  beforeEach(() => {
    addMockWindow({ id: 1, focused: true })
  })

  it('should not suspend when suspension is disabled', async () => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        suspension: { enabled: false },
      },
    })

    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: false,
    })

    const suspended = await checkForInactiveTabs()

    expect(suspended).toBe(0)
  })

  it('should suspend tabs that exceed inactivity threshold', async () => {
    const thirtyMinutesAgo = Date.now() - 31 * 60 * 1000

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
        1: thirtyMinutesAgo,
      },
    })

    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: false,
      pinned: false,
      audible: false,
    })

    const suspended = await checkForInactiveTabs()

    expect(suspended).toBe(1)

    const tabs = getMockTabs()
    expect(tabs[0].discarded).toBe(true)
  })

  it('should not suspend recently active tabs', async () => {
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
        1: fiveMinutesAgo,
      },
    })

    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: false,
      pinned: false,
      audible: false,
    })

    const suspended = await checkForInactiveTabs()

    expect(suspended).toBe(0)
  })

  it('should not suspend active tabs', async () => {
    const thirtyMinutesAgo = Date.now() - 31 * 60 * 1000

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
        1: thirtyMinutesAgo,
      },
    })

    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: true, // Active tab
      pinned: false,
      audible: false,
    })

    const suspended = await checkForInactiveTabs()

    expect(suspended).toBe(0)
  })

  it('should respect protection rules during auto-suspend', async () => {
    const thirtyMinutesAgo = Date.now() - 31 * 60 * 1000

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
        1: thirtyMinutesAgo,
        2: thirtyMinutesAgo,
      },
    })

    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: false,
      pinned: true, // Protected
      audible: false,
    })

    addMockTab({
      id: 2,
      windowId: 1,
      url: 'https://other.com',
      active: false,
      pinned: false,
      audible: false,
    })

    const suspended = await checkForInactiveTabs()

    expect(suspended).toBe(1) // Only the non-pinned tab
  })
})

describe('getTabCounts', () => {
  beforeEach(() => {
    addMockWindow({ id: 1, focused: true })
  })

  it('should count total, suspended, and suspendable tabs', async () => {
    // Normal suspendable tab
    addMockTab({
      id: 1,
      windowId: 1,
      url: 'https://example.com',
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    })

    // Already discarded tab
    addMockTab({
      id: 2,
      windowId: 1,
      url: 'https://suspended.com',
      active: false,
      pinned: false,
      audible: false,
      discarded: true,
    })

    // Protected tab (pinned)
    addMockTab({
      id: 3,
      windowId: 1,
      url: 'https://pinned.com',
      active: false,
      pinned: true,
      audible: false,
      discarded: false,
    })

    // Protected URL
    addMockTab({
      id: 4,
      windowId: 1,
      url: 'chrome://settings',
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    })

    const counts = await getTabCounts()

    expect(counts.total).toBe(4)
    expect(counts.suspended).toBe(1)
    expect(counts.suspendable).toBe(1) // Only tab 1
  })

  it('should return zeros for empty browser', async () => {
    const counts = await getTabCounts()

    expect(counts.total).toBe(0)
    expect(counts.suspended).toBe(0)
    expect(counts.suspendable).toBe(0)
  })
})
