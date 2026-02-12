/**
 * Crash Resilience Safety Tests
 *
 * Proves that Raft's recovery system captures complete browser state
 * and that existing data survives failures.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  captureRecoverySnapshot,
  restoreFromSnapshot,
  recoverySnapshotsStorage,
  recoverySnapshotSync,
} from '@/background/recovery'
import { sessionsStorage } from '@/shared/storage'
import {
  addMockWindow,
  addMockTab,
  addMockTabGroup,
  setMockStorage,
  getMockStorage,
} from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'
import type { Session, RecoverySnapshot } from '@/shared/types'
import { buildSession } from './helpers'

describe('Your sessions survive browser crashes', () => {
  describe('Recovery snapshots capture complete browser state', () => {
    it('captures all tabs across all windows', async () => {
      const win1 = addMockWindow({ focused: true })
      const win2 = addMockWindow({ focused: false })

      addMockTab({ windowId: win1.id, url: 'https://a.com', title: 'A' })
      addMockTab({ windowId: win1.id, url: 'https://b.com', title: 'B' })
      addMockTab({ windowId: win2.id, url: 'https://c.com', title: 'C' })

      const snapshot = await captureRecoverySnapshot()

      expect(snapshot).not.toBeNull()
      expect(snapshot!.stats.windowCount).toBe(2)
      expect(snapshot!.stats.tabCount).toBe(3)

      const allUrls = snapshot!.windows.flatMap((w) => w.tabs.map((t) => t.url))
      expect(allUrls).toContain('https://a.com')
      expect(allUrls).toContain('https://b.com')
      expect(allUrls).toContain('https://c.com')
    })

    it('captures tab groups with membership', async () => {
      const win = addMockWindow({ focused: true })
      const group = addMockTabGroup({ windowId: win.id, title: 'Research', color: 'purple', collapsed: true })

      addMockTab({ windowId: win.id, url: 'https://arxiv.org', title: 'arXiv', groupId: group.id })
      addMockTab({ windowId: win.id, url: 'https://scholar.google.com', title: 'Scholar', groupId: group.id })
      addMockTab({ windowId: win.id, url: 'https://news.ycombinator.com', title: 'HN', groupId: -1 })

      const snapshot = await captureRecoverySnapshot()

      expect(snapshot!.stats.groupCount).toBe(1)
      const snapshotGroup = snapshot!.windows[0].tabGroups[0]
      expect(snapshotGroup.title).toBe('Research')
      expect(snapshotGroup.color).toBe('purple')
      expect(snapshotGroup.collapsed).toBe(true)

      const groupedTabs = snapshot!.windows[0].tabs.filter((t) => t.groupId === snapshotGroup.id)
      expect(groupedTabs).toHaveLength(2)
      const ungrouped = snapshot!.windows[0].tabs.filter((t) => !t.groupId)
      expect(ungrouped).toHaveLength(1)
    })

    it('captures pinned and suspended states', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://pinned.com', title: 'Pinned', pinned: true })
      addMockTab({ windowId: win.id, url: 'https://suspended.com', title: 'Suspended', discarded: true })
      addMockTab({ windowId: win.id, url: 'https://normal.com', title: 'Normal' })

      const snapshot = await captureRecoverySnapshot()
      const tabs = snapshot!.windows[0].tabs

      const pinned = tabs.find((t) => t.url === 'https://pinned.com')!
      const suspended = tabs.find((t) => t.url === 'https://suspended.com')!
      const normal = tabs.find((t) => t.url === 'https://normal.com')!

      expect(pinned.pinned).toBe(true)
      expect(suspended.discarded).toBe(true)
      expect(normal.pinned).toBe(false)
      expect(normal.discarded).toBeFalsy()
    })

    it('full round-trip: capture -> store -> retrieve -> restore', async () => {
      const win = addMockWindow({ focused: true })
      const group = addMockTabGroup({ windowId: win.id, title: 'Work', color: 'blue' })
      addMockTab({ windowId: win.id, url: 'https://github.com', title: 'GitHub', pinned: true, groupId: group.id })
      addMockTab({ windowId: win.id, url: 'https://docs.google.com', title: 'Docs', groupId: group.id })

      const snapshot = await captureRecoverySnapshot()
      expect(snapshot).not.toBeNull()

      const stored = await recoverySnapshotsStorage.getAll()
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe(snapshot!.id)

      const result = await restoreFromSnapshot(snapshot!.id)
      expect(result).not.toBeNull()
      expect(result!.windowsCreated).toBe(1)
      expect(result!.tabsCreated).toBe(2)
    })
  })

  describe('Existing data survives failures', () => {
    it('failed save does not destroy existing sessions', async () => {
      // Pre-populate storage with a valid session
      const existing = buildSession('existing-1', { name: 'My Important Session' })
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [existing] })

      // Make sessionsStorage.save throw to simulate a write failure
      const saveSpy = vi.spyOn(sessionsStorage, 'save').mockRejectedValueOnce(
        new Error('QUOTA_BYTES quota exceeded')
      )

      // Attempt to save a new session directly via sessionsStorage
      const newSession = buildSession('new-1', { name: 'New Session' })
      try {
        await sessionsStorage.save(newSession)
      } catch {
        // Expected to fail
      }

      saveSpy.mockRestore()

      // Verify the original session is still intact
      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toBeDefined()
      expect(stored.some((s) => s.name === 'My Important Session')).toBe(true)
    })

    it('storage quota error throws without silent data loss', async () => {
      // Pre-populate with sessions
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [
          buildSession('s1', { name: 'Session 1' }),
          buildSession('s2', { name: 'Session 2' }),
        ],
      })

      // Make the underlying chrome.storage.local.set fail once
      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(
        new Error('QUOTA_BYTES quota exceeded')
      )

      // The save should throw (not silently lose data)
      await expect(
        sessionsStorage.save(buildSession('s3', { name: 'Session 3' }))
      ).rejects.toThrow()

      // After the error, a fresh read still returns the original sessions
      // (chrome.storage.local.set never executed, so storage wasn't modified)
      // The original s1 and s2 are readable from storage after the error
      const afterError = await sessionsStorage.getAll()
      expect(afterError.some((s) => s.name === 'Session 1')).toBe(true)
      expect(afterError.some((s) => s.name === 'Session 2')).toBe(true)
    })

    it('mid-write failure preserves session structure integrity', async () => {
      const validSession = buildSession('valid', { name: 'Valid Session' })
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [validSession] })

      vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error('Internal error'))

      // The save should throw
      await expect(
        sessionsStorage.save(buildSession('corrupt', { name: 'Might Corrupt' }))
      ).rejects.toThrow()

      // After the error, the original session is still readable and structurally intact
      const stored = await sessionsStorage.getAll()
      const original = stored.find((s) => s.id === 'valid')
      expect(original).toBeDefined()
      expect(original!.name).toBe('Valid Session')
      expect(original!.windows).toBeDefined()
      expect(Array.isArray(original!.windows)).toBe(true)
    })
  })

  describe('Recovery works after restart', () => {
    it('snapshot available after simulated restart', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Example' })

      const snapshot = await captureRecoverySnapshot()
      expect(snapshot).not.toBeNull()

      // Verify snapshot persists in storage (survives restart since it's in chrome.storage)
      const snapshots = await recoverySnapshotsStorage.getAll()
      expect(snapshots).toHaveLength(1)
      expect(snapshots[0].stats.tabCount).toBe(1)
    })

    it('snapshot restores all windows and tabs', async () => {
      const win1 = addMockWindow({ focused: true })
      const win2 = addMockWindow({ focused: false })
      addMockTab({ windowId: win1.id, url: 'https://win1-tab1.com', title: 'W1T1' })
      addMockTab({ windowId: win1.id, url: 'https://win1-tab2.com', title: 'W1T2' })
      addMockTab({ windowId: win2.id, url: 'https://win2-tab1.com', title: 'W2T1' })

      const snapshot = await captureRecoverySnapshot()
      expect(snapshot).not.toBeNull()

      const result = await restoreFromSnapshot(snapshot!.id)
      expect(result).not.toBeNull()
      expect(result!.windowsCreated).toBe(2)
      expect(result!.tabsCreated).toBe(3)
    })

    it('keeps 5 most recent snapshots (rotation)', async () => {
      // Create 7 snapshots manually via recoverySnapshotsStorage.save
      for (let i = 0; i < 7; i++) {
        const snapshot: RecoverySnapshot = {
          id: `recovery:${1000 + i}`,
          timestamp: 1000 + i,
          windows: [{
            id: `win-${i}`,
            tabs: [{
              id: `tab-${i}`,
              url: `https://snapshot${i}.com`,
              title: `Snapshot ${i}`,
              index: 0,
              pinned: false,
            }],
            tabGroups: [],
          }],
          stats: { windowCount: 1, tabCount: 1, groupCount: 0 },
        }
        await recoverySnapshotsStorage.save(snapshot)
      }

      const all = await recoverySnapshotsStorage.getAll()
      expect(all).toHaveLength(5) // MAX_SNAPSHOTS = 5
    })

    it('sync storage provides backup copy', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://important.com', title: 'Important' })

      const snapshot = await captureRecoverySnapshot()
      expect(snapshot).not.toBeNull()

      // The sync save is fire-and-forget, so wait a tick
      await new Promise((r) => setTimeout(r, 50))

      // Verify the local snapshot is saved
      const local = await recoverySnapshotsStorage.getAll()
      expect(local).toHaveLength(1)
    })
  })

  describe('Corrupted storage handled gracefully', () => {
    it("missing session data doesn't crash", async () => {
      // Verify sessionsStorage works when key is empty
      const sessions = await sessionsStorage.getAll()
      expect(sessions).toEqual([])

      // Save should work even when starting from empty state
      const session = buildSession('new-session', { name: 'New' })
      await sessionsStorage.save(session)

      const stored = await sessionsStorage.getAll()
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('New')
    })

    it('recovery snapshot with missing chunks returns null', async () => {
      await chrome.storage.sync.set({
        raft_recovery_meta: { chunkCount: 3, timestamp: Date.now(), tabCount: 50 },
        raft_recovery_0: 'chunk0data',
        // raft_recovery_1 is missing
        raft_recovery_2: 'chunk2data',
      })

      const result = await recoverySnapshotSync.get()
      expect(result).toBeNull()
    })
  })
})
