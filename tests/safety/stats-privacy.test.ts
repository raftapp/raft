/**
 * Stats Privacy Safety Tests
 *
 * Proves the memory-savings dashboard cannot leak data.
 * Trust contract:
 *   1. The stats accumulator never makes a network request.
 *   2. It only ever writes to chrome.storage.local — never .sync.
 *   3. The persisted blob never contains URLs, titles, or any identifier
 *      that could be linked to a specific tab or site.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  recordSuspension,
  recordMemorySample,
  clearStats,
  getStatsData,
  type StatsData,
} from '@/shared/stats'
import { suspendTab } from '@/background/suspension'
import {
  addMockTab,
  addMockWindow,
  getMockStorage,
  getMockSyncStorage,
} from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'

const SENSITIVE_PATTERNS = [
  /https?:\/\//i,
  /\bexample\.com\b/i,
  /\bsecret-tab\b/i,
  /chrome:\/\//i,
  /\bfavicon\b/i,
]

const SENSITIVE_KEYS = ['url', 'title', 'favIconUrl', 'hostname', 'tabId', 'windowId']

function assertNoSensitiveContent(data: unknown): void {
  const json = JSON.stringify(data ?? {})
  for (const pattern of SENSITIVE_PATTERNS) {
    expect(json).not.toMatch(pattern)
  }
  // Walk the object to make sure no per-tab keys leaked into a bucket.
  function walk(value: unknown): void {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach(walk)
      return
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      expect(SENSITIVE_KEYS).not.toContain(key)
      walk((value as Record<string, unknown>)[key])
    }
  }
  walk(data)
}

describe('Stats stay on this device', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let originalXHR: typeof globalThis.XMLHttpRequest

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch was called from the stats accumulator!')
    })
    originalXHR = globalThis.XMLHttpRequest
    globalThis.XMLHttpRequest = vi.fn(() => {
      throw new Error('XMLHttpRequest was called from the stats accumulator!')
    }) as unknown as typeof XMLHttpRequest
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    globalThis.XMLHttpRequest = originalXHR
  })

  describe('recordSuspension never phones home', () => {
    it('does not call fetch on increment', async () => {
      await recordSuspension(1)
      await recordSuspension(5)
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('does not call fetch when batched across many writes', async () => {
      await Promise.all([
        recordSuspension(1),
        recordSuspension(2),
        recordSuspension(3),
        recordSuspension(4),
      ])
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('recordMemorySample never phones home', () => {
    it('does not call fetch on memory write', async () => {
      await recordMemorySample({ ts: Date.now(), jsHeapBytes: 12345678 })
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })

  describe('Stats live in chrome.storage.local only', () => {
    it('never writes the stats key into chrome.storage.sync', async () => {
      await recordSuspension(7)
      await recordMemorySample({ ts: Date.now(), jsHeapBytes: 999 })
      const sync = getMockSyncStorage()
      expect(STORAGE_KEYS.STATS in sync).toBe(false)
      // Belt and braces: the underlying API was never called for our key.
      expect(chrome.storage.sync.set).not.toHaveBeenCalledWith(
        expect.objectContaining({ [STORAGE_KEYS.STATS]: expect.anything() })
      )
    })

    it('writes appear in chrome.storage.local under the STATS key', async () => {
      await recordSuspension(3)
      const local = getMockStorage()
      const stored = local[STORAGE_KEYS.STATS] as StatsData
      expect(stored).toBeDefined()
      expect(stored.version).toBe(1)
      const today = Object.keys(stored.buckets)[0]
      expect(stored.buckets[today].suspendCount).toBe(3)
    })

    it('clearStats only touches chrome.storage.local', async () => {
      await recordSuspension(2)
      await clearStats()
      const sync = getMockSyncStorage()
      expect(STORAGE_KEYS.STATS in sync).toBe(false)
    })
  })

  describe('Stored payload contains no identifying data', () => {
    it('after a suspension, the bucket holds counts only — no URL, title, or tab id', async () => {
      const win = addMockWindow({ focused: true })
      addMockTab({
        id: 99,
        windowId: win.id,
        url: 'https://example.com/secret-tab',
        title: 'Secret Tab Title',
        favIconUrl: 'https://example.com/favicon.ico',
        active: false,
      })

      const ok = await suspendTab(99)
      expect(ok).toBe(true)
      // suspendTab fires the stats write fire-and-forget; let it settle.
      await new Promise((r) => setTimeout(r, 0))

      const data = await getStatsData()
      const bucket = Object.values(data.buckets)[0]
      expect(bucket.suspendCount).toBeGreaterThanOrEqual(1)
      assertNoSensitiveContent(data)
    })

    it('memory samples contain only ts + heap bytes, never tab/site info', async () => {
      await recordMemorySample({ ts: Date.now(), jsHeapBytes: 42_000_000 })
      const data = await getStatsData()
      assertNoSensitiveContent(data)
      const bucket = Object.values(data.buckets)[0]
      const sample = bucket.samples?.[0]
      expect(sample).toBeDefined()
      // Only the contracted keys are persisted.
      expect(Object.keys(sample!).sort()).toEqual(
        ['jsHeapBytes', 'systemAvailBytes', 'ts'].sort()
      )
    })
  })
})
