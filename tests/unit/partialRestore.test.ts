/**
 * Partial Session Restore Tests
 *
 * Tests for restoreSessionPartial() which allows restoring a subset
 * of windows/tabs from a saved session.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  setMockStorage,
  getMockStorage,
  getMockWindows,
  getMockTabs,
  addMockWindow,
  addMockTab,
  addMockTabGroup,
} from '../mocks/chrome'
import { restoreSessionPartial, saveSession, captureCurrentSession } from '@/background/sessions'
import { STORAGE_KEYS } from '@/shared/constants'
import type { Session, Window, Tab, PartialRestoreSelection } from '@/shared/types'

function makeTestSession(): Session {
  return {
    id: 'test-session-1',
    name: 'Test Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    windows: [
      {
        id: 'win-1',
        tabs: [
          { id: 'tab-1', url: 'https://example.com', title: 'Example', index: 0, pinned: false },
          { id: 'tab-2', url: 'https://google.com', title: 'Google', index: 1, pinned: false },
          {
            id: 'tab-3',
            url: 'https://github.com',
            title: 'GitHub',
            index: 2,
            pinned: true,
            groupId: 'group-1',
          },
        ],
        tabGroups: [{ id: 'group-1', title: 'Dev', color: 'blue', collapsed: false }],
        focused: true,
      },
      {
        id: 'win-2',
        tabs: [
          {
            id: 'tab-4',
            url: 'https://docs.google.com',
            title: 'Docs',
            index: 0,
            pinned: false,
          },
          {
            id: 'tab-5',
            url: 'https://mail.google.com',
            title: 'Mail',
            index: 1,
            pinned: false,
          },
        ],
        tabGroups: [],
      },
    ],
    source: 'manual',
  }
}

describe('restoreSessionPartial', () => {
  beforeEach(() => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        suspension: {
          enabled: false,
          inactivityMinutes: 30,
          neverSuspendPinned: true,
          neverSuspendAudio: true,
          neverSuspendForms: false,
          whitelist: [],
        },
        autoSave: { enabled: false, intervalMinutes: 60, maxSlots: 5 },
        ui: { theme: 'system', showBadge: true },
        exportReminder: { enabled: false, intervalDays: 30 },
      },
    })

    // Store the test session in mock storage so sessionsStorage.get() can find it
    const session = makeTestSession()
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })
  })

  it('should restore specific tabs from one window', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1', 'tab-2'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(2)
    expect(result.windowsFailed).toBe(0)
    expect(result.errors).toHaveLength(0)

    const windows = getMockWindows()
    expect(windows).toHaveLength(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(2)
    expect(tabs.map((t) => t.url)).toContain('https://example.com')
    expect(tabs.map((t) => t.url)).toContain('https://google.com')
  })

  it('should restore tabs from multiple windows', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1'],
        'win-2': ['tab-4'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(2)
    expect(result.tabsCreated).toBe(2)
    expect(result.windowsFailed).toBe(0)
    expect(result.errors).toHaveLength(0)

    const windows = getMockWindows()
    expect(windows).toHaveLength(2)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(2)
    expect(tabs.map((t) => t.url)).toContain('https://example.com')
    expect(tabs.map((t) => t.url)).toContain('https://docs.google.com')
  })

  it('should restore all tabs when all are selected (same as full restore)', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1', 'tab-2', 'tab-3'],
        'win-2': ['tab-4', 'tab-5'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(2)
    expect(result.tabsCreated).toBe(5)
    expect(result.windowsFailed).toBe(0)
    expect(result.errors).toHaveLength(0)

    const windows = getMockWindows()
    expect(windows).toHaveLength(2)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(5)
  })

  it('should return empty result with error when no tabs are selected', async () => {
    const selection: PartialRestoreSelection = {
      windows: {},
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(0)
    expect(result.tabsCreated).toBe(0)
    expect(result.windowsFailed).toBe(0)
    expect(result.errors).toContain('No tabs selected')

    const windows = getMockWindows()
    expect(windows).toHaveLength(0)
  })

  it('should preserve tab groups when group tabs are selected', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        // tab-3 belongs to group-1
        'win-1': ['tab-3'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].url).toBe('https://github.com')

    // The tab should have been assigned to a group (groupId !== -1)
    expect(tabs[0].groupId).not.toBe(-1)
  })

  it('should omit tab groups when no group tabs are selected', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        // tab-1 does not belong to any group
        'win-1': ['tab-1'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].url).toBe('https://example.com')

    // The tab should not be in any group
    expect(tabs[0].groupId).toBe(-1)
  })

  it('should throw error when session does not exist', async () => {
    await expect(
      restoreSessionPartial('nonexistent-id', {
        selection: { windows: { 'win-1': ['tab-1'] } },
      })
    ).rejects.toThrow('Session nonexistent-id not found')
  })

  it('should discard tabs when asSuspended option is used with partial restore', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', {
      selection,
      asSuspended: true,
    })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].url).toBe('https://example.com')
    // The mock chrome.tabs.discard sets discarded = true synchronously
    expect(tabs[0].discarded).toBe(true)
  })

  it('should skip windows with empty tab ID arrays in selection', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1'],
        'win-2': [], // Empty array - should be skipped
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)

    const windows = getMockWindows()
    expect(windows).toHaveLength(1)
  })

  it('should ignore selection entries for windows not in the session', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1'],
        'win-nonexistent': ['tab-99'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    // Only win-1 should be restored; win-nonexistent is silently ignored
    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)
  })

  it('should ignore tab IDs that do not exist in the selected window', async () => {
    const selection: PartialRestoreSelection = {
      windows: {
        'win-1': ['tab-1', 'tab-nonexistent'],
      },
    }

    const result = await restoreSessionPartial('test-session-1', { selection })

    // Only tab-1 exists in win-1, tab-nonexistent is silently filtered out
    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(1)
    expect(tabs[0].url).toBe('https://example.com')
  })
})
