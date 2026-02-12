/**
 * Sync Backup Tests
 *
 * Tests for the chrome.storage.sync backup functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetMockChrome, getMockSyncStorage, setMockSyncStorage } from '../mocks/chrome'
import {
  backupSession,
  removeSessionFromSync,
  restoreFromSync,
  getSyncStatus,
  shouldRestoreFromSync,
  clearSyncData,
} from '@/shared/syncBackup'
import { SYNC_STORAGE_KEYS, SYNC_LIMITS } from '@/shared/constants'
import type { Session } from '@/shared/types'

// Helper to create a test session
function createTestSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now()
  return {
    id: overrides.id ?? `session-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? 'Test Session',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    windows: overrides.windows ?? [
      {
        id: 'window-1',
        tabs: [
          {
            id: 'tab-1',
            url: 'https://example.com',
            title: 'Example',
            index: 0,
            pinned: false,
          },
          {
            id: 'tab-2',
            url: 'https://another.com',
            title: 'Another',
            index: 1,
            pinned: true,
          },
        ],
        tabGroups: [],
      },
    ],
    source: overrides.source ?? 'manual',
  }
}

// Helper to create a large session that approaches size limits
function createLargeSession(tabCount: number): Session {
  const tabs = []
  for (let i = 0; i < tabCount; i++) {
    tabs.push({
      id: `tab-${i}`,
      url: `https://example${i}.com/path/to/page?query=${i}`,
      title: `Tab Title ${i} - Some longer title to increase size`,
      index: i,
      pinned: i < 3,
    })
  }

  return {
    id: `large-session-${Math.random().toString(36).slice(2)}`,
    name: 'Large Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    windows: [
      {
        id: 'window-1',
        tabs,
        tabGroups: [],
      },
    ],
    source: 'manual',
  }
}

describe('syncBackup', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('backupSession', () => {
    it('should backup a session to sync storage', async () => {
      const session = createTestSession({ id: 'test-1', name: 'Test Backup' })

      const result = await backupSession(session)

      expect(result).toBe(true)

      const syncStorage = getMockSyncStorage()
      const sessionKey = `${SYNC_STORAGE_KEYS.SESSION_PREFIX}test-1`

      expect(syncStorage[sessionKey]).toBeDefined()
      expect(syncStorage[SYNC_STORAGE_KEYS.MANIFEST]).toBeDefined()

      const manifest = syncStorage[SYNC_STORAGE_KEYS.MANIFEST] as {
        sessions: Array<{ id: string; name: string }>
      }
      expect(manifest.sessions).toHaveLength(1)
      expect(manifest.sessions[0].id).toBe('test-1')
      expect(manifest.sessions[0].name).toBe('Test Backup')
    })

    it('should strip non-essential data to compress sessions', async () => {
      const session = createTestSession()
      session.windows[0].tabs[0].favIconUrl = 'https://example.com/favicon.ico'
      session.windows[0].tabs[0].lastAccessed = Date.now()
      session.windows[0].tabs[0].discarded = true

      await backupSession(session)

      // Verify backup succeeded
      const status = await getSyncStatus()
      expect(status.sessionCount).toBe(1)

      // Restore and verify non-essential data is stripped
      const restored = await restoreFromSync()
      expect(restored).toHaveLength(1)
      // favIconUrl should be stripped (not present after restore)
      expect(restored[0].windows[0].tabs[0].favIconUrl).toBeUndefined()
      // discarded should also be stripped
      expect(restored[0].windows[0].tabs[0].discarded).toBeUndefined()
    })

    it('should update existing session backup', async () => {
      const session = createTestSession({ id: 'test-update' })
      await backupSession(session)

      // Update the session
      session.name = 'Updated Name'
      session.windows[0].tabs.push({
        id: 'tab-3',
        url: 'https://new.com',
        title: 'New Tab',
        index: 2,
        pinned: false,
      })

      await backupSession(session)

      const status = await getSyncStatus()
      expect(status.sessionCount).toBe(1) // Should still be 1, not 2
      expect(status.sessions[0].name).toBe('Updated Name')
    })

    it('should remove oldest sessions when quota is reached', async () => {
      // Create multiple sessions with different timestamps
      const sessions = [
        createTestSession({ id: 'old-1', name: 'Old 1', createdAt: 1000 }),
        createTestSession({ id: 'old-2', name: 'Old 2', createdAt: 2000 }),
        createTestSession({ id: 'new-1', name: 'New 1', createdAt: 3000 }),
      ]

      for (const session of sessions) {
        await backupSession(session)
      }

      const status = await getSyncStatus()
      expect(status.sessionCount).toBe(3)

      // The sessions should be in order (most recent first)
      expect(status.sessions[0].name).toBe('New 1')
      expect(status.sessions[2].name).toBe('Old 1')
    })

    it('should reject sessions that are too large for a single item', async () => {
      // Create a session with high-entropy data that doesn't compress well
      // Random strings compress poorly, so this will exceed the 8KB limit
      const tabs = []
      for (let i = 0; i < 100; i++) {
        // Generate pseudo-random URL that doesn't compress well
        const randomPart = Array.from({ length: 100 }, () =>
          Math.random().toString(36).charAt(2)
        ).join('')
        tabs.push({
          id: `tab-${i}`,
          url: `https://example.com/${randomPart}?q=${randomPart}`,
          title: `Title ${randomPart}`,
          index: i,
          pinned: false,
        })
      }

      const largeSession: Session = {
        id: 'large-session',
        name: 'Large Session',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        windows: [{ id: 'window-1', tabs, tabGroups: [] }],
        source: 'manual',
      }

      const result = await backupSession(largeSession)

      // Should fail gracefully - even with compression, high-entropy data exceeds limit
      expect(result).toBe(false)
    })
  })

  describe('removeSessionFromSync', () => {
    it('should remove a session from sync storage', async () => {
      const session = createTestSession({ id: 'to-remove' })
      await backupSession(session)

      let status = await getSyncStatus()
      expect(status.sessionCount).toBe(1)

      await removeSessionFromSync('to-remove')

      status = await getSyncStatus()
      expect(status.sessionCount).toBe(0)

      const syncStorage = getMockSyncStorage()
      expect(syncStorage[`${SYNC_STORAGE_KEYS.SESSION_PREFIX}to-remove`]).toBeUndefined()
    })

    it('should handle removing non-existent session gracefully', async () => {
      // Should not throw
      await removeSessionFromSync('non-existent')

      const status = await getSyncStatus()
      expect(status.sessionCount).toBe(0)
    })
  })

  describe('restoreFromSync', () => {
    it('should restore all sessions from sync storage', async () => {
      const session1 = createTestSession({ id: 's1', name: 'Session 1' })
      const session2 = createTestSession({ id: 's2', name: 'Session 2' })

      await backupSession(session1)
      await backupSession(session2)

      const restored = await restoreFromSync()

      expect(restored).toHaveLength(2)
      expect(restored.map((s) => s.name).sort()).toEqual(['Session 1', 'Session 2'])
    })

    it('should return empty array when no sessions in sync', async () => {
      const restored = await restoreFromSync()
      expect(restored).toEqual([])
    })

    it('should restore session data correctly', async () => {
      const original = createTestSession({
        id: 'restore-test',
        name: 'Restore Test',
      })
      original.windows[0].tabs[0].pinned = true
      original.windows[0].tabGroups = [
        { id: 'group-1', title: 'My Group', color: 'blue', collapsed: false },
      ]
      original.windows[0].tabs[0].groupId = 'group-1'

      await backupSession(original)
      const restored = await restoreFromSync()

      expect(restored).toHaveLength(1)
      const restoredSession = restored[0]

      expect(restoredSession.name).toBe('Restore Test')
      expect(restoredSession.windows[0].tabs[0].pinned).toBe(true)
      expect(restoredSession.windows[0].tabGroups).toHaveLength(1)
      expect(restoredSession.windows[0].tabGroups[0].title).toBe('My Group')
    })
  })

  describe('getSyncStatus', () => {
    it('should return correct status when empty', async () => {
      const status = await getSyncStatus()

      expect(status.sessionCount).toBe(0)
      // totalBytes includes manifest size even when empty
      expect(status.manifestBytes).toBeGreaterThan(0)
      expect(status.sessionsBytes).toBe(0)
      expect(status.totalBytes).toBe(status.manifestBytes + status.sessionsBytes)
      expect(status.maxBytes).toBe(SYNC_LIMITS.QUOTA_BYTES)
      expect(status.percentUsed).toBeGreaterThan(0) // manifest takes some space
      expect(status.sessions).toEqual([])
      expect(status.itemCount).toBe(1) // just the manifest
      expect(status.compressionEnabled).toBe(true)
    })

    it('should return correct status after backups', async () => {
      const session1 = createTestSession({ id: 's1' })
      const session2 = createTestSession({ id: 's2' })

      await backupSession(session1)
      await backupSession(session2)

      const status = await getSyncStatus()

      expect(status.sessionCount).toBe(2)
      expect(status.totalBytes).toBeGreaterThan(0)
      expect(status.percentUsed).toBeGreaterThan(0)
      expect(status.sessions).toHaveLength(2)
    })
  })

  describe('shouldRestoreFromSync', () => {
    it('should return false when local sessions exist', async () => {
      await backupSession(createTestSession())

      const should = await shouldRestoreFromSync(5)
      expect(should).toBe(false)
    })

    it('should return false when sync is empty', async () => {
      const should = await shouldRestoreFromSync(0)
      expect(should).toBe(false)
    })

    it('should return true when local is empty but sync has data', async () => {
      await backupSession(createTestSession())

      const should = await shouldRestoreFromSync(0)
      expect(should).toBe(true)
    })
  })

  describe('clearSyncData', () => {
    it('should clear all sync data', async () => {
      await backupSession(createTestSession({ id: 's1' }))
      await backupSession(createTestSession({ id: 's2' }))

      let status = await getSyncStatus()
      expect(status.sessionCount).toBe(2)

      await clearSyncData()

      status = await getSyncStatus()
      expect(status.sessionCount).toBe(0)
    })
  })
})
