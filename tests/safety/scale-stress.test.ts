/**
 * Scale & Stress Safety Tests
 *
 * Proves that Raft handles large sessions correctly without data loss.
 */

import { describe, it, expect } from 'vitest'
import { nanoid } from 'nanoid'
import { exportAsJson } from '@/shared/importExport/exporters'
import { parseRaft } from '@/shared/importExport/parsers/raft'
import { searchSessions } from '@/background/sessions'
import {
  recoverySnapshotsStorage,
  recoverySnapshotSync,
} from '@/background/recovery'
import { setMockStorage } from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'
import type { Session, RecoverySnapshot } from '@/shared/types'
import { buildLargeSession, buildSession } from './helpers'

describe('Raft handles your biggest sessions', () => {
  describe('Large sessions work correctly', () => {
    it('100 tabs across 5 windows', () => {
      const session = buildLargeSession(5, 20)

      const totalTabs = session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
      expect(totalTabs).toBe(100)

      // Round-trip through export/import
      const exported = exportAsJson([session])
      const imported = parseRaft(exported.data)

      expect(imported.success).toBe(true)
      const importedTabs = imported.sessions[0].windows.reduce((sum, w) => sum + w.tabs.length, 0)
      expect(importedTabs).toBe(100)
    })

    it('200 tabs with 20 tab groups', () => {
      const session = buildLargeSession(10, 20, 2)

      const totalTabs = session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const totalGroups = session.windows.reduce((sum, w) => sum + w.tabGroups.length, 0)
      expect(totalTabs).toBe(200)
      expect(totalGroups).toBe(20)

      // Round-trip
      const exported = exportAsJson([session])
      const imported = parseRaft(exported.data)

      expect(imported.success).toBe(true)
      const importedTabs = imported.sessions[0].windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const importedGroups = imported.sessions[0].windows.reduce((sum, w) => sum + w.tabGroups.length, 0)
      expect(importedTabs).toBe(200)
      expect(importedGroups).toBe(20)

      // Verify group membership survived
      for (const win of imported.sessions[0].windows) {
        const groupIds = new Set(win.tabGroups.map((g) => g.id))
        for (const tab of win.tabs) {
          if (tab.groupId) {
            expect(groupIds.has(tab.groupId)).toBe(true)
          }
        }
      }
    })

    it('MAX_SESSIONS (1000) sessions stored', async () => {
      const sessions: Session[] = []
      for (let i = 0; i < 1000; i++) {
        sessions.push(buildSession(`s-${i}`, { name: `Session ${i}` }))
      }

      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      // Export all 1000
      const exported = exportAsJson(sessions)
      expect(exported.stats.sessionsExported).toBe(1000)

      // Parse back
      const imported = parseRaft(exported.data)
      expect(imported.success).toBe(true)
      expect(imported.sessions).toHaveLength(1000)
    })
  })

  describe('Recovery at scale', () => {
    it('snapshot with 100+ tabs', async () => {
      const snapshot: RecoverySnapshot = {
        id: `recovery:${Date.now()}`,
        timestamp: Date.now(),
        windows: [],
        stats: { windowCount: 0, tabCount: 0, groupCount: 0 },
      }

      // Build 5 windows with 25 tabs each
      let totalTabs = 0
      for (let w = 0; w < 5; w++) {
        const tabs = []
        for (let t = 0; t < 25; t++) {
          tabs.push({
            id: nanoid(),
            url: `https://example.com/w${w}/t${t}`,
            title: `Tab ${t}`,
            index: t,
            pinned: t === 0,
          })
          totalTabs++
        }
        snapshot.windows.push({
          id: nanoid(),
          tabs,
          tabGroups: [],
          state: 'normal',
        })
      }
      snapshot.stats = { windowCount: 5, tabCount: totalTabs, groupCount: 0 }

      await recoverySnapshotsStorage.save(snapshot)

      const stored = await recoverySnapshotsStorage.getAll()
      expect(stored).toHaveLength(1)
      expect(stored[0].stats.tabCount).toBe(125)
    })

    it('chunked sync for 500+ tabs', async () => {
      const snapshot: RecoverySnapshot = {
        id: `recovery:${Date.now()}`,
        timestamp: Date.now(),
        windows: [],
        stats: { windowCount: 0, tabCount: 0, groupCount: 0 },
      }

      // Build 10 windows with 55 tabs each = 550 tabs
      let totalTabs = 0
      for (let w = 0; w < 10; w++) {
        const tabs = []
        for (let t = 0; t < 55; t++) {
          tabs.push({
            id: nanoid(),
            url: `https://example-${w}-${t}.com/path/to/page?query=test`,
            title: `Window ${w} Tab ${t} - Some Long Title Here`,
            index: t,
            pinned: false,
          })
          totalTabs++
        }
        snapshot.windows.push({
          id: nanoid(),
          tabs,
          tabGroups: [],
          state: 'normal',
        })
      }
      snapshot.stats = { windowCount: 10, tabCount: totalTabs, groupCount: 0 }

      const saved = await recoverySnapshotSync.save(snapshot)
      expect(saved).toBe(true)

      // Retrieve and verify
      const retrieved = await recoverySnapshotSync.get()
      expect(retrieved).not.toBeNull()
      expect(retrieved!.stats.tabCount).toBe(550)

      const retrievedTotalTabs = retrieved!.windows.reduce((sum, w) => sum + w.tabs.length, 0)
      expect(retrievedTotalTabs).toBe(550)
    })
  })

  describe('Search at scale', () => {
    it('searches across 50 sessions with 500+ tabs', async () => {
      const sessions: Session[] = []
      for (let i = 0; i < 50; i++) {
        sessions.push(buildSession(`s-${i}`, {
          name: `Session ${i}`,
          windows: [{
            id: nanoid(),
            tabs: Array.from({ length: 12 }, (_, t) => ({
              id: nanoid(),
              url: `https://site${t}.example.com/page${i}`,
              title: t === 0 && i === 25 ? 'NEEDLE in haystack' : `Tab ${t} Session ${i}`,
              index: t,
              pinned: false,
            })),
            tabGroups: [],
          }],
        }))
      }

      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      const results = await searchSessions('NEEDLE')
      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('Session 25')
    })
  })
})
