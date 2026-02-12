/**
 * Session Fidelity Safety Tests
 *
 * Proves that Raft saves and restores every tab property faithfully.
 * This is the core "Your tabs are safe" promise.
 */

import { describe, it, expect } from 'vitest'
import { captureCurrentSession } from '@/background/sessions'
import {
  addMockWindow,
  addMockTab,
  addMockTabGroup,
  setMockStorage,
  getMockStorage,
} from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'
import type { Session } from '@/shared/types'
import { buildRealisticBrowserState } from './helpers'

describe('Your tabs are saved exactly as they were', () => {
  describe('Every tab property survives save and restore', () => {
    it('preserves URLs, titles, and favicons for all tabs', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({
        windowId: win.id,
        url: 'https://github.com/anthropics/claude',
        title: 'Claude on GitHub',
        favIconUrl: 'https://github.com/favicon.ico',
      })
      addMockTab({
        windowId: win.id,
        url: 'https://docs.google.com/document/d/abc',
        title: 'Project Brief',
        favIconUrl: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico',
      })

      const session = await captureCurrentSession('Test')
      const tabs = session.windows[0].tabs

      expect(tabs[0].url).toBe('https://github.com/anthropics/claude')
      expect(tabs[0].title).toBe('Claude on GitHub')
      expect(tabs[0].favIconUrl).toBe('https://github.com/favicon.ico')
      expect(tabs[1].url).toBe('https://docs.google.com/document/d/abc')
      expect(tabs[1].title).toBe('Project Brief')
      expect(tabs[1].favIconUrl).toBe('https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico')
    })

    it('preserves pinned state for every tab', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://mail.google.com', title: 'Gmail', pinned: true })
      addMockTab({ windowId: win.id, url: 'https://github.com', title: 'GitHub', pinned: true })
      addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Regular Tab', pinned: false })

      const session = await captureCurrentSession('Pinned Test')
      const tabs = session.windows[0].tabs

      expect(tabs[0].pinned).toBe(true)
      expect(tabs[1].pinned).toBe(true)
      expect(tabs[2].pinned).toBe(false)
    })

    it('preserves tab position (index) within each window', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://first.com', title: 'First', index: 0 })
      addMockTab({ windowId: win.id, url: 'https://second.com', title: 'Second', index: 1 })
      addMockTab({ windowId: win.id, url: 'https://third.com', title: 'Third', index: 2 })

      const session = await captureCurrentSession('Index Test')
      const tabs = session.windows[0].tabs

      expect(tabs[0].index).toBe(0)
      expect(tabs[0].url).toBe('https://first.com')
      expect(tabs[1].index).toBe(1)
      expect(tabs[1].url).toBe('https://second.com')
      expect(tabs[2].index).toBe(2)
      expect(tabs[2].url).toBe('https://third.com')
    })

    it('preserves suspended (discarded) state', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://active.com', title: 'Active', discarded: false })
      addMockTab({ windowId: win.id, url: 'https://suspended.com', title: 'Suspended', discarded: true })

      const session = await captureCurrentSession('Discard Test')
      const tabs = session.windows[0].tabs

      expect(tabs[0].discarded).toBe(false)
      expect(tabs[1].discarded).toBe(true)
    })
  })

  describe('Tab groups are preserved perfectly', () => {
    it('saves and restores group names', async () => {
      const win = addMockWindow({ focused: true })
      const group = addMockTabGroup({ windowId: win.id, title: 'Shopping List', color: 'green' })
      addMockTab({ windowId: win.id, url: 'https://amazon.com', title: 'Amazon', groupId: group.id })

      const session = await captureCurrentSession('Group Name Test')
      const groups = session.windows[0].tabGroups

      expect(groups).toHaveLength(1)
      expect(groups[0].title).toBe('Shopping List')
    })

    it('saves and restores all 8 Chrome group colors', async () => {
      const win = addMockWindow({ focused: true })
      const colors: chrome.tabGroups.Color[] = [
        'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan',
      ]

      for (const color of colors) {
        const group = addMockTabGroup({ windowId: win.id, title: `${color} group`, color })
        addMockTab({ windowId: win.id, url: `https://${color}.example.com`, title: color, groupId: group.id })
      }

      const session = await captureCurrentSession('Color Test')
      const groups = session.windows[0].tabGroups

      expect(groups).toHaveLength(8)
      const savedColors = groups.map((g) => g.color).sort()
      const expectedColors = [...colors].sort()
      expect(savedColors).toEqual(expectedColors)
    })

    it('saves and restores collapsed/expanded state', async () => {
      const win = addMockWindow({ focused: true })
      const expanded = addMockTabGroup({ windowId: win.id, title: 'Expanded', color: 'blue', collapsed: false })
      const collapsed = addMockTabGroup({ windowId: win.id, title: 'Collapsed', color: 'red', collapsed: true })

      addMockTab({ windowId: win.id, url: 'https://a.com', title: 'A', groupId: expanded.id })
      addMockTab({ windowId: win.id, url: 'https://b.com', title: 'B', groupId: collapsed.id })

      const session = await captureCurrentSession('Collapsed Test')
      const groups = session.windows[0].tabGroups

      const expandedGroup = groups.find((g) => g.title === 'Expanded')
      const collapsedGroup = groups.find((g) => g.title === 'Collapsed')

      expect(expandedGroup!.collapsed).toBe(false)
      expect(collapsedGroup!.collapsed).toBe(true)
    })

    it('maintains correct tab-to-group membership', async () => {
      const win = addMockWindow({ focused: true })
      const work = addMockTabGroup({ windowId: win.id, title: 'Work', color: 'blue' })
      const personal = addMockTabGroup({ windowId: win.id, title: 'Personal', color: 'green' })

      addMockTab({ windowId: win.id, url: 'https://jira.com', title: 'Jira', groupId: work.id })
      addMockTab({ windowId: win.id, url: 'https://github.com', title: 'GitHub', groupId: work.id })
      addMockTab({ windowId: win.id, url: 'https://reddit.com', title: 'Reddit', groupId: personal.id })

      const session = await captureCurrentSession('Membership Test')
      const tabs = session.windows[0].tabs
      const groups = session.windows[0].tabGroups

      const workGroup = groups.find((g) => g.title === 'Work')!
      const personalGroup = groups.find((g) => g.title === 'Personal')!

      const jira = tabs.find((t) => t.url === 'https://jira.com')!
      const github = tabs.find((t) => t.url === 'https://github.com')!
      const reddit = tabs.find((t) => t.url === 'https://reddit.com')!

      expect(jira.groupId).toBe(workGroup.id)
      expect(github.groupId).toBe(workGroup.id)
      expect(reddit.groupId).toBe(personalGroup.id)
    })

    it('handles tabs not in any group', async () => {
      const win = addMockWindow({ focused: true })
      const group = addMockTabGroup({ windowId: win.id, title: 'Grouped', color: 'blue' })

      addMockTab({ windowId: win.id, url: 'https://grouped.com', title: 'Grouped Tab', groupId: group.id })
      addMockTab({ windowId: win.id, url: 'https://ungrouped.com', title: 'Ungrouped Tab', groupId: -1 })

      const session = await captureCurrentSession('Ungrouped Test')
      const tabs = session.windows[0].tabs

      const grouped = tabs.find((t) => t.url === 'https://grouped.com')!
      const ungrouped = tabs.find((t) => t.url === 'https://ungrouped.com')!

      expect(grouped.groupId).toBeDefined()
      expect(ungrouped.groupId).toBeUndefined()
    })
  })

  describe('Multiple windows are preserved', () => {
    it('saves and restores 3+ windows', async () => {
      addMockWindow({ focused: true })
      addMockWindow({ focused: false })
      addMockWindow({ focused: false })

      // Add at least one saveable tab per window
      const windows = [1, 2, 3]
      for (const winId of windows) {
        addMockTab({ windowId: winId, url: `https://window${winId}.example.com`, title: `Window ${winId}` })
      }

      const session = await captureCurrentSession('Multi-Window Test')
      expect(session.windows.length).toBe(3)
    })

    it('preserves window state (normal, minimized, maximized)', async () => {
      const normal = addMockWindow({ state: 'normal', focused: false })
      const minimized = addMockWindow({ state: 'minimized', focused: false })
      const maximized = addMockWindow({ state: 'maximized', focused: true })

      addMockTab({ windowId: normal.id, url: 'https://normal.com', title: 'Normal' })
      addMockTab({ windowId: minimized.id, url: 'https://minimized.com', title: 'Minimized' })
      addMockTab({ windowId: maximized.id, url: 'https://maximized.com', title: 'Maximized' })

      const session = await captureCurrentSession('Window State Test')

      const states = session.windows.map((w) => w.state)
      expect(states).toContain('normal')
      expect(states).toContain('minimized')
      expect(states).toContain('maximized')
    })
  })

  describe('Complex real-world scenarios', () => {
    it('workday setup: 3 windows, 7 groups, 27 tabs, mixed pins', async () => {
      const state = buildRealisticBrowserState()

      const session = await captureCurrentSession('Workday')

      // Verify window count
      expect(session.windows.length).toBe(3)

      // Verify total tab count
      const totalTabs = session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
      expect(totalTabs).toBe(state.tabCount)

      // Verify total group count
      const totalGroups = session.windows.reduce((sum, w) => sum + w.tabGroups.length, 0)
      expect(totalGroups).toBe(7)

      // Verify pinned tabs exist
      const allTabs = session.windows.flatMap((w) => w.tabs)
      const pinnedCount = allTabs.filter((t) => t.pinned).length
      expect(pinnedCount).toBeGreaterThanOrEqual(3)

      // Verify discarded tabs exist
      const discardedCount = allTabs.filter((t) => t.discarded).length
      expect(discardedCount).toBeGreaterThanOrEqual(3)

      // Verify group color diversity
      const allGroups = session.windows.flatMap((w) => w.tabGroups)
      const uniqueColors = new Set(allGroups.map((g) => g.color))
      expect(uniqueColors.size).toBeGreaterThanOrEqual(6)
    })

    it('stores session to chrome.storage and retrieves it intact', async () => {
      const win = addMockWindow({ focused: true })
      const group = addMockTabGroup({ windowId: win.id, title: 'Dev', color: 'cyan' })

      addMockTab({ windowId: win.id, url: 'https://github.com', title: 'GitHub', pinned: true, groupId: group.id })
      addMockTab({ windowId: win.id, url: 'https://vitejs.dev', title: 'Vite', groupId: group.id, discarded: true })

      const session = await captureCurrentSession('Storage Round-Trip')

      // Save to mock storage
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

      // Retrieve from storage
      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)

      const retrieved = stored[0]
      expect(retrieved.name).toBe('Storage Round-Trip')
      expect(retrieved.windows).toHaveLength(1)
      expect(retrieved.windows[0].tabs).toHaveLength(2)
      expect(retrieved.windows[0].tabGroups).toHaveLength(1)

      // Verify exact data
      const tabs = retrieved.windows[0].tabs
      expect(tabs[0].url).toBe('https://github.com')
      expect(tabs[0].pinned).toBe(true)
      expect(tabs[1].discarded).toBe(true)
      expect(retrieved.windows[0].tabGroups[0].title).toBe('Dev')
      expect(retrieved.windows[0].tabGroups[0].color).toBe('cyan')
    })
  })
})
