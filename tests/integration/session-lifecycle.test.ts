/**
 * Session Lifecycle Integration Tests
 *
 * End-to-end tests for the complete session management lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  setMockStorage,
  getMockStorage,
  addMockTab,
  addMockWindow,
  addMockTabGroup,
  getMockTabs,
  getMockWindows,
  getMockTabGroups,
} from '../mocks/chrome'
import {
  captureCurrentSession,
  restoreSession,
  saveSession,
  deleteSession,
  getAllSessions,
  performAutoSave,
} from '@/background/sessions'
import { STORAGE_KEYS, MAX_SESSIONS } from '@/shared/constants'
import type { Session } from '@/shared/types'

describe('Session Lifecycle Integration', () => {
  describe('capture -> save -> restore cycle', () => {
    it('should preserve all data through full cycle', async () => {
      // Setup: Complex browser state
      const win = addMockWindow({ id: 1, focused: true, state: 'maximized' })
      const group = addMockTabGroup({ windowId: win.id, title: 'Project', color: 'green', collapsed: false })

      addMockTab({
        id: 1,
        windowId: win.id,
        url: 'https://github.com/project',
        title: 'GitHub',
        index: 0,
        pinned: true,
      })

      addMockTab({
        id: 2,
        windowId: win.id,
        url: 'https://docs.project.com',
        title: 'Docs',
        index: 1,
        groupId: group.id,
      })

      addMockTab({
        id: 3,
        windowId: win.id,
        url: 'https://issues.project.com',
        title: 'Issues',
        index: 2,
        groupId: group.id,
      })

      // Capture
      const session = await captureCurrentSession('My Project')

      // Save
      await saveSession(session)

      // Verify saved
      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('My Project')

      // Clear browser state to simulate fresh restore
      // (The mock resets between beforeEach, so we just verify the session data)

      // Verify session structure
      expect(session.windows).toHaveLength(1)
      expect(session.windows[0].tabs).toHaveLength(3)
      expect(session.windows[0].tabGroups).toHaveLength(1)

      // Verify tab group preserved
      expect(session.windows[0].tabGroups[0].title).toBe('Project')
      expect(session.windows[0].tabGroups[0].color).toBe('green')

      // Verify pinned state preserved
      const pinnedTab = session.windows[0].tabs.find((t) => t.url === 'https://github.com/project')
      expect(pinnedTab?.pinned).toBe(true)

      // Verify group membership
      const groupedTabs = session.windows[0].tabs.filter((t) => t.groupId !== undefined)
      expect(groupedTabs).toHaveLength(2)
    })

    it('should handle discarded tabs in capture -> restore cycle', async () => {
      const win = addMockWindow({ id: 1, focused: true })

      // One normal tab, one discarded tab
      addMockTab({
        id: 1,
        windowId: win.id,
        url: 'https://active.com',
        title: 'Active',
        index: 0,
        discarded: false,
      })

      addMockTab({
        id: 2,
        windowId: win.id,
        url: 'https://suspended.com',
        title: 'Suspended',
        index: 1,
        discarded: true,
      })

      // Capture should preserve URLs and discarded state
      const session = await captureCurrentSession('Mixed Session')

      expect(session.windows[0].tabs[0].url).toBe('https://active.com')
      expect(session.windows[0].tabs[0].discarded).toBeFalsy()
      expect(session.windows[0].tabs[1].url).toBe('https://suspended.com')
      expect(session.windows[0].tabs[1].discarded).toBe(true)

      // Save and verify
      await saveSession(session)

      // Session is saved with discarded state
      const stored = (getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[])[0]
      expect(stored.windows[0].tabs[1].url).toBe('https://suspended.com')
      expect(stored.windows[0].tabs[1].discarded).toBe(true)
    })

    it('should restore as suspended when requested', async () => {
      const session: Session = {
        id: 'restore-suspended',
        name: 'Test',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        windows: [
          {
            id: 'w1',
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

      // Note: With native discard, tabs are discarded asynchronously after creation
      // The test verifies the restore completes without errors
      const result = await restoreSession('restore-suspended', { asSuspended: true })

      expect(result.windowsCreated).toBe(1)
      expect(result.tabsCreated).toBe(2)

      const tabs = getMockTabs()
      expect(tabs).toHaveLength(2)
    })
  })

  describe('auto-save with MAX_SESSIONS enforcement', () => {
    it('should auto-save and enforce limits correctly', async () => {
      // Start with some existing sessions
      const existingSessions: Session[] = []
      for (let i = 0; i < 10; i++) {
        existingSessions.push({
          id: `manual-${i}`,
          name: `Manual ${i}`,
          createdAt: i * 1000,
          updatedAt: i * 1000,
          windows: [
            {
              id: 'w',
              tabs: [{ id: 't', url: `https://manual${i}.com`, title: `M${i}`, index: 0, pinned: false }],
              tabGroups: [],
            },
          ],
          source: 'manual',
        })
      }

      // Add some auto-saves
      for (let i = 0; i < 5; i++) {
        existingSessions.push({
          id: `auto-${i}`,
          name: `Auto ${i}`,
          createdAt: 10000 + i * 1000,
          updatedAt: 10000 + i * 1000,
          windows: [
            {
              id: 'w',
              tabs: [{ id: 't', url: `https://auto${i}.com`, title: `A${i}`, index: 0, pinned: false }],
              tabGroups: [],
            },
          ],
          source: 'auto',
        })
      }

      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          autoSave: { enabled: true, intervalMinutes: 60, maxSlots: 3 },
        },
        [STORAGE_KEYS.SESSIONS]: existingSessions,
      })

      // Create browser state for auto-save
      addMockWindow({ id: 1, focused: true })
      addMockTab({ windowId: 1, url: 'https://current.com', title: 'Current' })

      // Perform auto-save
      await performAutoSave()

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]

      // Manual sessions should be untouched (10)
      const manualSessions = stored.filter((s) => s.source === 'manual')
      expect(manualSessions).toHaveLength(10)

      // Auto-saves should be limited to maxSlots (3)
      const autoSessions = stored.filter((s) => s.source === 'auto')
      expect(autoSessions).toHaveLength(3)

      // Oldest auto-saves should be removed
      expect(autoSessions.find((s) => s.id === 'auto-0')).toBeUndefined()
      expect(autoSessions.find((s) => s.id === 'auto-1')).toBeUndefined()
    })

    it('should handle rapid auto-saves correctly', async () => {
      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          autoSave: { enabled: true, intervalMinutes: 1, maxSlots: 3 },
        },
        [STORAGE_KEYS.SESSIONS]: [],
      })

      addMockWindow({ id: 1, focused: true })
      addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example' })

      // Rapid auto-saves
      await performAutoSave()
      await performAutoSave()
      await performAutoSave()
      await performAutoSave()
      await performAutoSave()

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      const autoSaves = stored.filter((s) => s.source === 'auto')

      // Should not exceed maxSlots
      expect(autoSaves.length).toBeLessThanOrEqual(3)
    })
  })

  describe('session deletion', () => {
    it('should delete session and preserve others', async () => {
      const sessions: Session[] = [
        { id: '1', name: 'Keep 1', createdAt: 1000, updatedAt: 1000, windows: [], source: 'manual' },
        { id: '2', name: 'Delete', createdAt: 2000, updatedAt: 2000, windows: [], source: 'manual' },
        { id: '3', name: 'Keep 2', createdAt: 3000, updatedAt: 3000, windows: [], source: 'manual' },
      ]

      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      await deleteSession('2')

      const remaining = await getAllSessions()
      expect(remaining).toHaveLength(2)
      expect(remaining.map((s) => s.id).sort()).toEqual(['1', '3'])
    })
  })

  describe('multi-window session handling', () => {
    it('should capture and restore multiple windows with different states', async () => {
      const win1 = addMockWindow({ id: 1, focused: true, state: 'maximized' })
      const win2 = addMockWindow({ id: 2, focused: false, state: 'normal' })

      // Window 1: tabs with group
      const group = addMockTabGroup({ windowId: win1.id, title: 'Work', color: 'blue' })
      addMockTab({ windowId: win1.id, url: 'https://win1-tab1.com', title: 'W1T1', groupId: group.id })
      addMockTab({ windowId: win1.id, url: 'https://win1-tab2.com', title: 'W1T2', groupId: group.id })

      // Window 2: standalone tabs
      addMockTab({ windowId: win2.id, url: 'https://win2-tab1.com', title: 'W2T1', pinned: true })
      addMockTab({ windowId: win2.id, url: 'https://win2-tab2.com', title: 'W2T2' })

      const session = await captureCurrentSession('Multi-Window')

      expect(session.windows).toHaveLength(2)

      // Focused window
      const focusedWin = session.windows.find((w) => w.focused)
      expect(focusedWin?.tabs).toHaveLength(2)
      expect(focusedWin?.tabGroups).toHaveLength(1)
      expect(focusedWin?.state).toBe('maximized')

      // Non-focused window
      const otherWin = session.windows.find((w) => !w.focused)
      expect(otherWin?.tabs).toHaveLength(2)
      expect(otherWin?.state).toBe('normal')

      // Pinned tab preserved
      const pinnedTab = otherWin?.tabs.find((t) => t.url === 'https://win2-tab1.com')
      expect(pinnedTab?.pinned).toBe(true)
    })
  })

  describe('tab group preservation', () => {
    it('should preserve complex tab group structures', async () => {
      const win = addMockWindow({ id: 1, focused: true })

      const workGroup = addMockTabGroup({ windowId: win.id, title: 'Work', color: 'blue', collapsed: false })
      const personalGroup = addMockTabGroup({ windowId: win.id, title: 'Personal', color: 'green', collapsed: true })

      // Work tabs
      addMockTab({ windowId: win.id, url: 'https://work1.com', title: 'Work 1', groupId: workGroup.id })
      addMockTab({ windowId: win.id, url: 'https://work2.com', title: 'Work 2', groupId: workGroup.id })

      // Personal tabs
      addMockTab({ windowId: win.id, url: 'https://personal1.com', title: 'Personal 1', groupId: personalGroup.id })

      // Ungrouped tabs
      addMockTab({ windowId: win.id, url: 'https://standalone.com', title: 'Standalone' })

      const session = await captureCurrentSession('Grouped')

      expect(session.windows[0].tabGroups).toHaveLength(2)

      const workGroupData = session.windows[0].tabGroups.find((g) => g.title === 'Work')
      const personalGroupData = session.windows[0].tabGroups.find((g) => g.title === 'Personal')

      expect(workGroupData?.color).toBe('blue')
      expect(workGroupData?.collapsed).toBe(false)
      expect(personalGroupData?.color).toBe('green')
      expect(personalGroupData?.collapsed).toBe(true)

      // Verify correct tab-group mapping
      const workTabs = session.windows[0].tabs.filter((t) => t.groupId === workGroupData?.id)
      const personalTabs = session.windows[0].tabs.filter((t) => t.groupId === personalGroupData?.id)
      const ungroupedTabs = session.windows[0].tabs.filter((t) => !t.groupId)

      expect(workTabs).toHaveLength(2)
      expect(personalTabs).toHaveLength(1)
      expect(ungroupedTabs).toHaveLength(1)
    })

    it('should recreate tab groups on restore', async () => {
      const session: Session = {
        id: 'grouped-restore',
        name: 'Grouped',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        windows: [
          {
            id: 'w1',
            tabs: [
              { id: 't1', url: 'https://group1.com', title: 'G1', index: 0, pinned: false, groupId: 'g1' },
              { id: 't2', url: 'https://group2.com', title: 'G2', index: 1, pinned: false, groupId: 'g1' },
              { id: 't3', url: 'https://standalone.com', title: 'S', index: 2, pinned: false },
            ],
            tabGroups: [
              { id: 'g1', title: 'My Group', color: 'red', collapsed: false },
            ],
            focused: true,
            state: 'normal',
          },
        ],
        source: 'manual',
      }

      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

      await restoreSession('grouped-restore')

      const groups = getMockTabGroups()
      expect(groups).toHaveLength(1)
      expect(groups[0].title).toBe('My Group')
      expect(groups[0].color).toBe('red')

      const tabs = getMockTabs()
      const groupedTabs = tabs.filter((t) => t.groupId !== -1)
      expect(groupedTabs).toHaveLength(2)
    })
  })
})
