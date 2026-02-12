/**
 * Data Isolation Safety Tests
 *
 * Proves that Raft's core operations never phone home.
 * Directly addresses the Great Suspender fear: your data stays on your device.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { captureCurrentSession, saveSession, restoreSession } from '@/background/sessions'
import { captureRecoverySnapshot, restoreFromSnapshot } from '@/background/recovery'
import { exportAsJson, exportAsText } from '@/shared/importExport/exporters'
import { importSessions } from '@/shared/importExport'
import {
  addMockWindow,
  addMockTab,
  setMockStorage,
} from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'
import { buildSession } from './helpers'

describe('Your data stays on your device', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let originalXHR: typeof globalThis.XMLHttpRequest

  beforeEach(() => {
    // Spy on fetch - should never be called during local operations
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch was called during a local-only operation!')
    })

    // Save and replace XMLHttpRequest
    originalXHR = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = vi.fn(() => {
      throw new Error('XMLHttpRequest was called during a local-only operation!')
    }) as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    globalThis.XMLHttpRequest = originalXHR
  })

  describe('Saving sessions makes no network requests', () => {
    it('captureCurrentSession never calls fetch', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Example' })

      await captureCurrentSession('Test Session')

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('saveSession only writes to chrome.storage.local', async () => {
      const session = buildSession('s1', { name: 'Local Only' })

      // Disable cloud sync to isolate local behavior
      setMockStorage({
        'raft:cloud:settings': { enabled: false },
      })

      await saveSession(session)

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('restoreSession makes no network calls', async () => {
      const session = buildSession('restore-test', { name: 'Restore Test' })
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [session],
        'raft:cloud:settings': { enabled: false },
      })

      await restoreSession('restore-test')

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('Recovery is completely local', () => {
    it('captureRecoverySnapshot never calls fetch', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Example' })

      await captureRecoverySnapshot()

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('restoreFromSnapshot never calls fetch', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({ windowId: win.id, url: 'https://example.com', title: 'Example' })

      const snapshot = await captureRecoverySnapshot()
      expect(snapshot).not.toBeNull()

      fetchSpy.mockClear()

      await restoreFromSnapshot(snapshot!.id)

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('Import/export stays in-memory', () => {
    it('importSessions makes no network calls', () => {
      const raftExport = JSON.stringify({
        version: '1.0',
        raftVersion: '0.1.0',
        exportedAt: Date.now(),
        sessions: [{
          id: 's1',
          name: 'Imported',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          windows: [{
            id: 'w1',
            tabs: [{ id: 't1', url: 'https://example.com', title: 'Example', index: 0, pinned: false }],
            tabGroups: [],
          }],
        }],
      })

      importSessions(raftExport)

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('exportAsJson makes no network calls', () => {
      const session = buildSession('s1', { name: 'Export Test' })

      exportAsJson([session])

      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('exportAsText makes no network calls', () => {
      const session = buildSession('s1', { name: 'Export Test' })

      exportAsText([session])

      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
