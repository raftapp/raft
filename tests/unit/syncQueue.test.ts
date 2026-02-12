/**
 * Tests for sync queue operations
 *
 * Tests the persistent sync queue with exponential backoff for cloud sync.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetMockChrome, getMockStorage } from '../mocks/chrome'
import {
  enqueueUpload,
  enqueueDelete,
  markComplete,
  markFailed,
  getNextItem,
  getPendingItems,
  clearQueue,
  hasPendingItems,
  getNextRetryTime,
} from '@/shared/cloudSync/syncQueue'
import { syncQueueStorage, syncStateStorage } from '@/shared/cloudSync/storage'
import { SYNC_RETRY, CLOUD_SYNC_KEYS } from '@/shared/constants'

describe('syncQueue', () => {
  beforeEach(() => {
    resetMockChrome()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('enqueueUpload', () => {
    it('should add an upload item to the queue', async () => {
      await enqueueUpload('session-123')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('upload')
      expect(items[0].sessionId).toBe('session-123')
      expect(items[0].retryCount).toBe(0)
    })

    it('should update pending count in sync state', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')

      const state = await syncStateStorage.get()
      expect(state.pendingCount).toBe(2)
    })

    it('should replace existing item for same session', async () => {
      const now = Date.now()
      vi.setSystemTime(now)
      await enqueueUpload('session-123')

      vi.setSystemTime(now + 1000)
      await enqueueUpload('session-123')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].queuedAt).toBe(now + 1000)
    })
  })

  describe('enqueueDelete', () => {
    it('should add a delete item to the queue', async () => {
      await enqueueDelete('session-456')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('delete')
      expect(items[0].sessionId).toBe('session-456')
    })

    it('should replace upload with delete for same session', async () => {
      await enqueueUpload('session-123')
      await enqueueDelete('session-123')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('delete')
    })
  })

  describe('markComplete', () => {
    it('should remove item from queue', async () => {
      await enqueueUpload('session-1')
      const items = await getPendingItems()
      const itemId = items[0].id

      await markComplete(itemId)

      const remaining = await getPendingItems()
      expect(remaining).toHaveLength(0)
    })

    it('should update pending count', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')
      const items = await getPendingItems()

      await markComplete(items[0].id)

      const state = await syncStateStorage.get()
      expect(state.pendingCount).toBe(1)
    })

    it('should handle non-existent item gracefully', async () => {
      await markComplete('non-existent-id')
      // Should not throw
    })
  })

  describe('markFailed', () => {
    it('should increment retry count', async () => {
      await enqueueUpload('session-123')
      const items = await getPendingItems()
      const itemId = items[0].id

      await markFailed(itemId, 'Network error')

      const updated = await getPendingItems()
      expect(updated[0].retryCount).toBe(1)
    })

    it('should set last error', async () => {
      await enqueueUpload('session-123')
      const items = await getPendingItems()

      await markFailed(items[0].id, 'Connection timeout')

      const updated = await getPendingItems()
      expect(updated[0].lastError).toBe('Connection timeout')
    })

    it('should schedule next retry with backoff', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-123')
      const items = await getPendingItems()

      const result = await markFailed(items[0].id, 'Error')
      expect(result).toBe(true)

      const updated = await getPendingItems()
      // nextRetryAt should be in the future with some jitter
      expect(updated[0].nextRetryAt).toBeGreaterThan(now)
      expect(updated[0].nextRetryAt).toBeLessThanOrEqual(
        now + SYNC_RETRY.INITIAL_DELAY_MS * 1.1 * SYNC_RETRY.BACKOFF_MULTIPLIER
      )
    })

    it('should return false and remove item after max retries', async () => {
      await enqueueUpload('session-123')
      let items = await getPendingItems()
      let itemId = items[0].id

      // Fail repeatedly until max retries
      for (let i = 0; i < SYNC_RETRY.MAX_RETRIES; i++) {
        const result = await markFailed(itemId, 'Error')
        if (i < SYNC_RETRY.MAX_RETRIES - 1) {
          expect(result).toBe(true)
        } else {
          expect(result).toBe(false)
        }
        items = await getPendingItems()
        if (items.length > 0 && items[0].sessionId === 'session-123') {
          itemId = items[0].id
        }
      }

      // Item should be removed after max retries
      const remaining = await getPendingItems()
      const sessionItem = remaining.find(i => i.sessionId === 'session-123')
      expect(sessionItem).toBeUndefined()
    })

    it('should return false for non-existent item', async () => {
      const result = await markFailed('non-existent', 'Error')
      expect(result).toBe(false)
    })

    it('should apply exponential backoff', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-123')
      let items = await getPendingItems()
      const itemId = items[0].id

      // First failure - delay should be ~INITIAL_DELAY_MS * 2^1
      await markFailed(itemId, 'Error 1')
      items = await getPendingItems()
      const delay1 = items[0].nextRetryAt - now

      // Second failure - delay should be ~INITIAL_DELAY_MS * 2^2
      vi.setSystemTime(items[0].nextRetryAt + 1)
      await markFailed(itemId, 'Error 2')
      items = await getPendingItems()
      const delay2 = items[0].nextRetryAt - (now + delay1 + 1)

      // Second delay should be approximately double (with jitter)
      expect(delay2).toBeGreaterThan(delay1 * 0.8)
    })

    it('should cap delay at MAX_DELAY_MS', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-123')
      let items = await getPendingItems()
      const itemId = items[0].id

      // Fail many times to reach max delay
      for (let i = 0; i < 8; i++) {
        items = await getPendingItems()
        const item = items.find(it => it.id === itemId)
        if (!item) break
        vi.setSystemTime(item.nextRetryAt + 1)
        await markFailed(itemId, `Error ${i}`)
      }

      items = await getPendingItems()
      const item = items.find(it => it.sessionId === 'session-123')
      if (item) {
        const currentTime = Date.now()
        const delay = item.nextRetryAt - currentTime
        // Should not exceed MAX_DELAY_MS * 1.1 (with jitter)
        expect(delay).toBeLessThanOrEqual(SYNC_RETRY.MAX_DELAY_MS * 1.1)
      }
    })
  })

  describe('getNextItem', () => {
    it('should return null when queue is empty', async () => {
      const item = await getNextItem()
      expect(item).toBeNull()
    })

    it('should return item ready for processing', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-123')

      const item = await getNextItem()
      expect(item).not.toBeNull()
      expect(item!.sessionId).toBe('session-123')
    })

    it('should not return items scheduled for future', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-123')
      const items = await getPendingItems()
      await markFailed(items[0].id, 'Error') // Schedules retry in future

      const nextItem = await getNextItem()
      expect(nextItem).toBeNull()
    })

    it('should return oldest item first (by queuedAt)', async () => {
      const now = Date.now()
      vi.setSystemTime(now)
      await enqueueUpload('session-1')

      vi.setSystemTime(now + 1000)
      await enqueueUpload('session-2')

      vi.setSystemTime(now + 2000)
      await enqueueUpload('session-3')

      const item = await getNextItem()
      expect(item!.sessionId).toBe('session-1')
    })
  })

  describe('getPendingItems', () => {
    it('should return empty array when queue is empty', async () => {
      const items = await getPendingItems()
      expect(items).toEqual([])
    })

    it('should return all pending items', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')
      await enqueueDelete('session-3')

      const items = await getPendingItems()
      expect(items).toHaveLength(3)
    })
  })

  describe('clearQueue', () => {
    it('should remove all items from queue', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')
      await enqueueDelete('session-3')

      await clearQueue()

      const items = await getPendingItems()
      expect(items).toHaveLength(0)
    })

    it('should reset pending count to 0', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')

      await clearQueue()

      const state = await syncStateStorage.get()
      expect(state.pendingCount).toBe(0)
    })
  })

  describe('hasPendingItems', () => {
    it('should return false when queue is empty', async () => {
      const hasPending = await hasPendingItems()
      expect(hasPending).toBe(false)
    })

    it('should return true when queue has items', async () => {
      await enqueueUpload('session-123')

      const hasPending = await hasPendingItems()
      expect(hasPending).toBe(true)
    })
  })

  describe('getNextRetryTime', () => {
    it('should return null when queue is empty', async () => {
      const time = await getNextRetryTime()
      expect(time).toBeNull()
    })

    it('should return earliest nextRetryAt time', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-1')
      const items = await getPendingItems()

      const time = await getNextRetryTime()
      expect(time).toBe(items[0].nextRetryAt)
    })

    it('should return minimum time across multiple items', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await enqueueUpload('session-1')
      vi.setSystemTime(now + 100)
      await enqueueUpload('session-2')
      vi.setSystemTime(now + 200)
      await enqueueUpload('session-3')

      const time = await getNextRetryTime()
      expect(time).toBe(now) // First item's nextRetryAt
    })
  })

  describe('queue deduplication', () => {
    it('should replace upload with later upload', async () => {
      const now = Date.now()
      vi.setSystemTime(now)
      await enqueueUpload('session-123')

      vi.setSystemTime(now + 5000)
      await enqueueUpload('session-123')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].queuedAt).toBe(now + 5000)
      expect(items[0].type).toBe('upload')
    })

    it('should replace delete with upload', async () => {
      await enqueueDelete('session-123')
      await enqueueUpload('session-123')

      const items = await getPendingItems()
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('upload')
    })

    it('should not deduplicate different sessions', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')
      await enqueueUpload('session-3')

      const items = await getPendingItems()
      expect(items).toHaveLength(3)
    })
  })

  describe('serialization lock', () => {
    it('should handle concurrent enqueue operations', async () => {
      // Enqueue multiple items concurrently
      await Promise.all([
        enqueueUpload('session-1'),
        enqueueUpload('session-2'),
        enqueueUpload('session-3'),
        enqueueUpload('session-4'),
        enqueueUpload('session-5'),
      ])

      const items = await getPendingItems()
      expect(items).toHaveLength(5)
    })

    it('should handle mixed enqueue and dequeue operations', async () => {
      await enqueueUpload('session-1')
      await enqueueUpload('session-2')

      const items = await getPendingItems()

      await Promise.all([
        markComplete(items[0].id),
        enqueueUpload('session-3'),
      ])

      const remaining = await getPendingItems()
      expect(remaining).toHaveLength(2)
    })
  })
})
