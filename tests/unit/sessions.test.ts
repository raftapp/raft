/**
 * Session Management Tests
 *
 * Tests for session capture, restore, search, and lifecycle.
 * Tab groups must be preserved perfectly - this is where competitors fail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setMockStorage,
  getMockStorage,
  addMockTab,
  addMockWindow,
  addMockTabGroup,
  getMockWindows,
  getMockTabs,
  getMockTabGroups,
  resetMockChrome,
} from '../mocks/chrome'
import {
  captureCurrentSession,
  captureWindow,
  restoreSession,
  saveSession,
  searchSessions,
  getSessionStats,
  performAutoSave,
  renameSession,
  deleteSession,
} from '@/background/sessions'
import { STORAGE_KEYS, MAX_SESSIONS } from '@/shared/constants'
import type { Session } from '@/shared/types'
import { removeSessionFromSync, backupSession } from '@/shared/syncBackup'

vi.mock('@/shared/syncBackup', () => ({
  backupSession: vi.fn().mockResolvedValue(true),
  removeSessionFromSync: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/shared/cloudSync', () => ({
  syncEngine: {
    isConfigured: vi.fn().mockResolvedValue(false),
    pushSession: vi.fn().mockResolvedValue(undefined),
    deleteSessionFromCloud: vi.fn().mockResolvedValue(undefined),
  },
  cloudSyncSettingsStorage: {
    get: vi.fn().mockResolvedValue({ enabled: false, intervalMinutes: 15, syncOnSave: true }),
  },
}))

describe('captureCurrentSession', () => {
  it('should capture all windows and tabs', async () => {
    const win1 = addMockWindow({ id: 1, focused: true })
    const win2 = addMockWindow({ id: 2, focused: false })

    addMockTab({ windowId: win1.id, url: 'https://example.com', title: 'Example 1' })
    addMockTab({ windowId: win1.id, url: 'https://example.org', title: 'Example 2' })
    addMockTab({ windowId: win2.id, url: 'https://other.com', title: 'Other' })

    const session = await captureCurrentSession('Test Session')

    expect(session.name).toBe('Test Session')
    expect(session.windows).toHaveLength(2)

    const win1Session = session.windows.find((w) => w.focused)
    const win2Session = session.windows.find((w) => !w.focused)

    expect(win1Session?.tabs).toHaveLength(2)
    expect(win2Session?.tabs).toHaveLength(1)
  })

  it('should skip protected URLs', async () => {
    const win = addMockWindow({ id: 1 })

    addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Keep' })
    addMockTab({ windowId: win.id, url: 'chrome://settings', title: 'Settings' })
    addMockTab({ windowId: win.id, url: 'chrome-extension://some-id/popup.html', title: 'Extension' })
    addMockTab({ windowId: win.id, url: 'about:blank', title: 'Blank' })

    const session = await captureCurrentSession()

    expect(session.windows).toHaveLength(1)
    expect(session.windows[0].tabs).toHaveLength(1)
    expect(session.windows[0].tabs[0].url).toBe('https://example.com')
  })

  it('should capture discarded tabs with their original URL', async () => {
    const win = addMockWindow({ id: 1 })
    const originalUrl = 'https://suspended-page.com/article'

    // With native discard, tabs keep their original URL and have discarded=true
    addMockTab({
      windowId: win.id,
      url: originalUrl,
      title: 'Article',
      discarded: true,
    })

    const session = await captureCurrentSession()

    expect(session.windows[0].tabs[0].url).toBe(originalUrl)
    expect(session.windows[0].tabs[0].discarded).toBe(true)
  })

  it('should capture tab group membership', async () => {
    const win = addMockWindow({ id: 1 })
    const group = addMockTabGroup({ windowId: win.id, title: 'Work', color: 'blue' })

    addMockTab({ windowId: win.id, url: 'https://tab1.com', title: 'Tab 1', groupId: group.id })
    addMockTab({ windowId: win.id, url: 'https://tab2.com', title: 'Tab 2', groupId: group.id })
    addMockTab({ windowId: win.id, url: 'https://tab3.com', title: 'Tab 3' }) // No group

    const session = await captureCurrentSession()

    expect(session.windows[0].tabGroups).toHaveLength(1)
    expect(session.windows[0].tabGroups[0].title).toBe('Work')
    expect(session.windows[0].tabGroups[0].color).toBe('blue')

    const groupedTabs = session.windows[0].tabs.filter((t) => t.groupId !== undefined)
    expect(groupedTabs).toHaveLength(2)

    // All grouped tabs should reference the same group ID
    const groupId = session.windows[0].tabGroups[0].id
    expect(groupedTabs.every((t) => t.groupId === groupId)).toBe(true)
  })

  it('should capture pinned tab state', async () => {
    const win = addMockWindow({ id: 1 })

    addMockTab({ windowId: win.id, url: 'https://pinned.com', title: 'Pinned', pinned: true })
    addMockTab({ windowId: win.id, url: 'https://normal.com', title: 'Normal', pinned: false })

    const session = await captureCurrentSession()

    const pinnedTab = session.windows[0].tabs.find((t) => t.url === 'https://pinned.com')
    const normalTab = session.windows[0].tabs.find((t) => t.url === 'https://normal.com')

    expect(pinnedTab?.pinned).toBe(true)
    expect(normalTab?.pinned).toBe(false)
  })

  it('should set correct source', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com' })

    const manualSession = await captureCurrentSession('Manual', 'manual')
    const autoSession = await captureCurrentSession('Auto', 'auto')
    const importSession = await captureCurrentSession('Import', 'import')

    expect(manualSession.source).toBe('manual')
    expect(autoSession.source).toBe('auto')
    expect(importSession.source).toBe('import')
  })

  it('should skip windows with no saveable tabs', async () => {
    addMockWindow({ id: 1 })
    addMockWindow({ id: 2 })

    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Valid' })
    addMockTab({ windowId: 2, url: 'chrome://settings', title: 'Settings' }) // Protected

    const session = await captureCurrentSession()

    expect(session.windows).toHaveLength(1)
  })
})

describe('captureWindow', () => {
  it('should capture a single window', async () => {
    const win1 = addMockWindow({ id: 1 })
    const win2 = addMockWindow({ id: 2 })

    addMockTab({ windowId: win1.id, url: 'https://win1.com', title: 'Win1' })
    addMockTab({ windowId: win2.id, url: 'https://win2.com', title: 'Win2' })

    const session = await captureWindow(win1.id, 'Window 1')

    expect(session.name).toBe('Window 1')
    expect(session.windows).toHaveLength(1)
    expect(session.windows[0].tabs).toHaveLength(1)
    expect(session.windows[0].tabs[0].url).toBe('https://win1.com')
  })
})

describe('restoreSession', () => {
  beforeEach(() => {
    // Start with a clean browser state
  })

  it('should create windows and tabs from session', async () => {
    const session: Session = {
      id: 'test-session',
      name: 'Test',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [
            { id: 't1', url: 'https://tab1.com', title: 'Tab 1', index: 0, pinned: false },
            { id: 't2', url: 'https://tab2.com', title: 'Tab 2', index: 1, pinned: false },
          ],
          tabGroups: [],
          focused: true,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    const result = await restoreSession('test-session')

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(2)

    const windows = getMockWindows()
    expect(windows).toHaveLength(1)

    const tabs = getMockTabs()
    expect(tabs).toHaveLength(2)
  })

  it('should restore multiple windows', async () => {
    const session: Session = {
      id: 'multi-window',
      name: 'Multi Window',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [{ id: 't1', url: 'https://tab1.com', title: 'Tab 1', index: 0, pinned: false }],
          tabGroups: [],
          focused: true,
          state: 'normal',
        },
        {
          id: 'win-2',
          tabs: [{ id: 't2', url: 'https://tab2.com', title: 'Tab 2', index: 0, pinned: false }],
          tabGroups: [],
          focused: false,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    const result = await restoreSession('multi-window')

    expect(result.windowsCreated).toBe(2)
    expect(result.tabsCreated).toBe(2)
  })

  it('should restore tabs as suspended when asSuspended is true', async () => {
    const session: Session = {
      id: 'suspended-restore',
      name: 'Suspended',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [
            { id: 't1', url: 'https://example.com', title: 'Example', index: 0, pinned: false },
            { id: 't2', url: 'https://other.com', title: 'Other', index: 1, pinned: false },
          ],
          tabGroups: [],
          focused: true,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    const result = await restoreSession('suspended-restore', { asSuspended: true })

    expect(result.windowsCreated).toBe(1)
    expect(result.tabsCreated).toBe(2)

    // Tabs should keep their original URL and be discarded
    const tabs = getMockTabs()
    expect(tabs[0].url).toBe('https://example.com')
    expect(tabs[0].discarded).toBe(true)
    expect(tabs[1].url).toBe('https://other.com')
    expect(tabs[1].discarded).toBe(true)
  })

  it('should recreate tab groups with properties', async () => {
    const session: Session = {
      id: 'grouped-session',
      name: 'Grouped',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [
            { id: 't1', url: 'https://tab1.com', title: 'Tab 1', index: 0, pinned: false, groupId: 'g1' },
            { id: 't2', url: 'https://tab2.com', title: 'Tab 2', index: 1, pinned: false, groupId: 'g1' },
            { id: 't3', url: 'https://tab3.com', title: 'Tab 3', index: 2, pinned: false },
          ],
          tabGroups: [
            { id: 'g1', title: 'Work', color: 'red', collapsed: false },
          ],
          focused: true,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await restoreSession('grouped-session')

    const groups = getMockTabGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Work')
    expect(groups[0].color).toBe('red')

    const tabs = getMockTabs()
    const groupedTabs = tabs.filter((t) => t.groupId !== -1)
    expect(groupedTabs).toHaveLength(2)
  })

  it('should restore pinned tabs', async () => {
    const session: Session = {
      id: 'pinned-session',
      name: 'Pinned',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [
            { id: 't1', url: 'https://pinned.com', title: 'Pinned', index: 0, pinned: true },
            { id: 't2', url: 'https://normal.com', title: 'Normal', index: 1, pinned: false },
          ],
          tabGroups: [],
          focused: true,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await restoreSession('pinned-session')

    const tabs = getMockTabs()
    const pinnedTab = tabs.find((t) => t.url?.includes('pinned.com'))
    expect(pinnedTab?.pinned).toBe(true)
  })

  it('should throw error for nonexistent session', async () => {
    await expect(restoreSession('nonexistent')).rejects.toThrow('Session nonexistent not found')
  })
})

describe('saveSession', () => {
  it('should save a new session', async () => {
    const session: Session = {
      id: 'new-session',
      name: 'New',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }

    await saveSession(session)

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored).toHaveLength(1)
    expect(stored[0].id).toBe('new-session')
  })

  it('should enforce MAX_SESSIONS by removing oldest auto-save first', async () => {
    // Fill storage with MAX_SESSIONS sessions
    const sessions: Session[] = []
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.push({
        id: `session-${i}`,
        name: `Session ${i}`,
        createdAt: i * 1000, // Older sessions have lower timestamps
        updatedAt: i * 1000,
        windows: [],
        source: i < 5 ? 'auto' : 'manual', // First 5 are auto-saves
      })
    }
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

    // Try to save one more
    const newSession: Session = {
      id: 'overflow-session',
      name: 'Overflow',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }

    await saveSession(newSession)

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored).toHaveLength(MAX_SESSIONS)

    // Oldest auto-save (session-0) should be removed
    expect(stored.find((s) => s.id === 'session-0')).toBeUndefined()

    // New session should be present
    expect(stored.find((s) => s.id === 'overflow-session')).toBeDefined()
  })

  it('should remove oldest manual session when no auto-saves exist', async () => {
    const sessions: Session[] = []
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.push({
        id: `session-${i}`,
        name: `Session ${i}`,
        createdAt: i * 1000,
        updatedAt: i * 1000,
        windows: [],
        source: 'manual', // All manual
      })
    }
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

    const newSession: Session = {
      id: 'new-manual',
      name: 'New Manual',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }

    await saveSession(newSession)

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]

    // Oldest session should be removed
    expect(stored.find((s) => s.id === 'session-0')).toBeUndefined()
    expect(stored.find((s) => s.id === 'new-manual')).toBeDefined()
  })
})

describe('searchSessions', () => {
  beforeEach(() => {
    const sessions: Session[] = [
      {
        id: '1',
        name: 'Work Session',
        createdAt: 1000,
        updatedAt: 1000,
        windows: [
          {
            id: 'w1',
            tabs: [
              { id: 't1', url: 'https://github.com/user/repo', title: 'GitHub Repo', index: 0, pinned: false },
            ],
            tabGroups: [],
          },
        ],
        source: 'manual',
      },
      {
        id: '2',
        name: 'Personal Session',
        createdAt: 2000,
        updatedAt: 2000,
        windows: [
          {
            id: 'w2',
            tabs: [
              { id: 't2', url: 'https://youtube.com/watch', title: 'YouTube Video', index: 0, pinned: false },
            ],
            tabGroups: [],
          },
        ],
        source: 'manual',
      },
      {
        id: '3',
        name: 'Research',
        createdAt: 3000,
        updatedAt: 3000,
        windows: [
          {
            id: 'w3',
            tabs: [
              { id: 't3', url: 'https://docs.google.com', title: 'Google Docs', index: 0, pinned: false },
            ],
            tabGroups: [],
          },
        ],
        source: 'auto',
      },
    ]
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })
  })

  it('should return all sessions for empty query', async () => {
    const results = await searchSessions('')
    expect(results).toHaveLength(3)
  })

  it('should search by session name (case insensitive)', async () => {
    const results = await searchSessions('work')
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Work Session')
  })

  it('should search by tab URL', async () => {
    const results = await searchSessions('github')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('1')
  })

  it('should search by tab title', async () => {
    const results = await searchSessions('youtube video')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('2')
  })

  it('should return multiple matches', async () => {
    const results = await searchSessions('google')
    expect(results).toHaveLength(1) // Only Research session has google.com
  })

  it('should handle no matches', async () => {
    const results = await searchSessions('nonexistent-query-xyz')
    expect(results).toHaveLength(0)
  })
})

describe('getSessionStats', () => {
  it('should count windows, tabs, and groups', () => {
    const session: Session = {
      id: 'stats-test',
      name: 'Stats',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'w1',
          tabs: [
            { id: 't1', url: 'https://a.com', title: 'A', index: 0, pinned: false },
            { id: 't2', url: 'https://b.com', title: 'B', index: 1, pinned: false },
          ],
          tabGroups: [{ id: 'g1', title: 'Group', color: 'blue', collapsed: false }],
        },
        {
          id: 'w2',
          tabs: [
            { id: 't3', url: 'https://c.com', title: 'C', index: 0, pinned: false },
          ],
          tabGroups: [],
        },
      ],
      source: 'manual',
    }

    const stats = getSessionStats(session)

    expect(stats.windows).toBe(2)
    expect(stats.tabs).toBe(3)
    expect(stats.groups).toBe(1)
  })

  it('should return zeros for empty session', () => {
    const session: Session = {
      id: 'empty',
      name: 'Empty',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }

    const stats = getSessionStats(session)

    expect(stats.windows).toBe(0)
    expect(stats.tabs).toBe(0)
    expect(stats.groups).toBe(0)
  })
})

describe('performAutoSave', () => {
  it('should not save when auto-save is disabled', async () => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        autoSave: { enabled: false },
      },
    })

    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com' })

    const result = await performAutoSave()

    expect(result).toBeNull()
  })

  it('should save current session when auto-save is enabled', async () => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        autoSave: { enabled: true, intervalMinutes: 60, maxSlots: 5 },
      },
      [STORAGE_KEYS.SESSIONS]: [],
    })

    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Test' })

    const result = await performAutoSave()

    expect(result).not.toBeNull()
    expect(result?.source).toBe('auto')
    expect(result?.name).toBe('Auto-save')

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored).toHaveLength(1)
  })

  it('should not save empty sessions', async () => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        autoSave: { enabled: true, intervalMinutes: 60, maxSlots: 5 },
      },
      [STORAGE_KEYS.SESSIONS]: [],
    })

    // No windows/tabs

    const result = await performAutoSave()

    expect(result).toBeNull()
  })

  it('should enforce maxSlots for auto-saves', async () => {
    const existingAutoSaves: Session[] = [
      { id: 'auto-1', name: 'Auto 1', createdAt: 1000, updatedAt: 1000, windows: [{ id: 'w', tabs: [{ id: 't', url: 'https://a.com', title: 'A', index: 0, pinned: false }], tabGroups: [] }], source: 'auto' },
      { id: 'auto-2', name: 'Auto 2', createdAt: 2000, updatedAt: 2000, windows: [{ id: 'w', tabs: [{ id: 't', url: 'https://b.com', title: 'B', index: 0, pinned: false }], tabGroups: [] }], source: 'auto' },
      { id: 'auto-3', name: 'Auto 3', createdAt: 3000, updatedAt: 3000, windows: [{ id: 'w', tabs: [{ id: 't', url: 'https://c.com', title: 'C', index: 0, pinned: false }], tabGroups: [] }], source: 'auto' },
    ]

    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        autoSave: { enabled: true, intervalMinutes: 60, maxSlots: 3 },
      },
      [STORAGE_KEYS.SESSIONS]: existingAutoSaves,
    })

    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://new.com', title: 'New' })

    await performAutoSave()

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    const autoSaves = stored.filter((s) => s.source === 'auto')

    expect(autoSaves).toHaveLength(3) // maxSlots

    // Oldest auto-save should be removed
    expect(autoSaves.find((s) => s.id === 'auto-1')).toBeUndefined()
  })
})

describe('renameSession', () => {
  it('should rename session and update timestamp', async () => {
    const now = Date.now()
    const session: Session = {
      id: 'rename-me',
      name: 'Old Name',
      createdAt: now - 10000,
      updatedAt: now - 10000,
      windows: [],
      source: 'manual',
    }
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await renameSession('rename-me', 'New Name')

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('New Name')
    expect(stored[0].updatedAt).toBeGreaterThan(now - 10000)
  })

  it('should throw for non-existent session', async () => {
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [] })

    await expect(renameSession('bogus-id', 'Whatever')).rejects.toThrow('Session not found')
  })

  it('should throw for empty/whitespace name', async () => {
    const session: Session = {
      id: 'rename-empty',
      name: 'Has Name',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await expect(renameSession('rename-empty', '   ')).rejects.toThrow(
      'Session name cannot be empty'
    )
  })
})

describe('deleteSession', () => {
  it('should delete session and remove from sync backup', async () => {
    const session: Session = {
      id: 'delete-me',
      name: 'Delete Me',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'manual',
    }
    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await deleteSession('delete-me')

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored.find((s) => s.id === 'delete-me')).toBeUndefined()
    expect(vi.mocked(removeSessionFromSync)).toHaveBeenCalledWith('delete-me')
  })
})

describe('restoreSession — edge cases', () => {
  it('should handle window creation failure gracefully', async () => {
    const session: Session = {
      id: 'fail-window',
      name: 'Fail Window',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-ok',
          tabs: [{ id: 't1', url: 'https://ok.com', title: 'OK', index: 0, pinned: false }],
          tabGroups: [],
          focused: true,
          state: 'normal',
        },
        {
          id: 'win-fail',
          tabs: [{ id: 't2', url: 'https://fail.com', title: 'Fail', index: 0, pinned: false }],
          tabGroups: [],
          focused: false,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    // Make windows.create fail on the second call
    let callCount = 0
    vi.mocked(chrome.windows.create).mockImplementation(async (createData) => {
      callCount++
      if (callCount === 2) {
        throw new Error('Window creation failed')
      }
      // Default mock behavior for the first call
      const win = addMockWindow({
        focused: createData?.focused ?? true,
        state: createData?.state,
      })
      if (createData?.url) {
        const urls = Array.isArray(createData.url) ? createData.url : [createData.url]
        for (const url of urls) {
          addMockTab({ windowId: win.id, url, active: true })
        }
      }
      return { ...win, tabs: win.tabs.map((t) => ({ ...t })) } as chrome.windows.Window
    })

    const result = await restoreSession('fail-window')

    expect(result.windowsCreated).toBe(1)
    expect(result.windowsFailed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('Failed to create window')
  })

  it('should join first tab to existing group via groupIdMap', async () => {
    // Session where both tabs belong to the same group.
    // Tab at index 1 gets created first (after the window), creating the group.
    // Then the first tab (index 0) should join the already-created group.
    const session: Session = {
      id: 'group-join',
      name: 'Group Join',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [
        {
          id: 'win-1',
          tabs: [
            { id: 't1', url: 'https://first.com', title: 'First', index: 0, pinned: false, groupId: 'g1' },
            { id: 't2', url: 'https://second.com', title: 'Second', index: 1, pinned: false, groupId: 'g1' },
          ],
          tabGroups: [{ id: 'g1', title: 'MyGroup', color: 'green', collapsed: false }],
          focused: true,
          state: 'normal',
        },
      ],
      source: 'manual',
    }

    setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

    await restoreSession('group-join')

    const tabs = getMockTabs()
    const groups = getMockTabGroups()

    // Both tabs should be in the same group
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('MyGroup')
    expect(groups[0].color).toBe('green')

    // Both tabs should have the same groupId
    const groupedTabs = tabs.filter((t) => t.groupId !== -1)
    expect(groupedTabs).toHaveLength(2)
    expect(groupedTabs[0].groupId).toBe(groupedTabs[1].groupId)
  })
})

describe('performAutoSave — MAX_SESSIONS eviction', () => {
  it('should evict oldest manual session when no auto-saves exist', async () => {
    // Fill storage to MAX_SESSIONS with all manual sessions
    const sessions: Session[] = []
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.push({
        id: `manual-${i}`,
        name: `Manual ${i}`,
        createdAt: i * 1000,
        updatedAt: i * 1000,
        windows: [
          {
            id: `w-${i}`,
            tabs: [
              { id: `t-${i}`, url: `https://site${i}.com`, title: `Site ${i}`, index: 0, pinned: false },
            ],
            tabGroups: [],
          },
        ],
        source: 'manual',
      })
    }

    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        autoSave: { enabled: true, intervalMinutes: 60, maxSlots: 5 },
      },
      [STORAGE_KEYS.SESSIONS]: sessions,
    })

    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://autosave.com', title: 'Auto' })

    const result = await performAutoSave()

    expect(result).not.toBeNull()
    expect(result?.source).toBe('auto')

    const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
    expect(stored).toHaveLength(MAX_SESSIONS)

    // The oldest manual session (manual-0, createdAt=0) should have been evicted
    expect(stored.find((s) => s.id === 'manual-0')).toBeUndefined()

    // The new auto-save should be present
    expect(stored.find((s) => s.id === result!.id)).toBeDefined()
  })
})

describe('saveSession — sync backup behavior', () => {
  it('should skip sync backup for auto-save sources', async () => {
    const session: Session = {
      id: 'auto-session',
      name: 'Auto-save',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      windows: [],
      source: 'auto',
    }

    await saveSession(session)

    expect(vi.mocked(backupSession)).not.toHaveBeenCalled()
  })
})
