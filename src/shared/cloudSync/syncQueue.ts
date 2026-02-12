/**
 * Persistent sync queue with exponential backoff
 *
 * The queue persists to chrome.storage to survive service worker termination.
 * Failed operations are retried with exponential backoff.
 */

import { SYNC_RETRY } from '../constants'
import { syncQueueStorage, syncStateStorage } from './storage'
import type { SyncQueueItem } from './types'

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetry(retryCount: number): number {
  const delay = Math.min(
    SYNC_RETRY.INITIAL_DELAY_MS * Math.pow(SYNC_RETRY.BACKOFF_MULTIPLIER, retryCount),
    SYNC_RETRY.MAX_DELAY_MS
  )
  // Add some jitter (±10%)
  const jitter = delay * (0.9 + Math.random() * 0.2)
  return Date.now() + jitter
}

/**
 * Enqueue a session for upload
 */
export async function enqueueUpload(sessionId: string): Promise<void> {
  await syncQueueStorage.enqueue('upload', sessionId)
  await updatePendingCount()
}

/**
 * Enqueue a session for deletion
 */
export async function enqueueDelete(sessionId: string): Promise<void> {
  await syncQueueStorage.enqueue('delete', sessionId)
  await updatePendingCount()
}

/**
 * Mark an item as successfully processed
 */
export async function markComplete(itemId: string): Promise<void> {
  await syncQueueStorage.dequeue(itemId)
  await updatePendingCount()
}

/**
 * Mark an item as failed, schedule retry
 */
export async function markFailed(itemId: string, error: string): Promise<boolean> {
  const queue = await syncQueueStorage.getAll()
  const item = queue.find((i) => i.id === itemId)

  if (!item) {
    return false
  }

  const newRetryCount = item.retryCount + 1

  if (newRetryCount >= SYNC_RETRY.MAX_RETRIES) {
    // Give up after max retries
    await syncQueueStorage.dequeue(itemId)
    await updatePendingCount()
    console.error(
      `[Raft Sync] Gave up on ${item.type} for session ${item.sessionId} after ${newRetryCount} retries`
    )
    return false
  }

  // Schedule retry
  await syncQueueStorage.update(itemId, {
    retryCount: newRetryCount,
    nextRetryAt: calculateNextRetry(newRetryCount),
    lastError: error,
  })

  return true
}

/**
 * Get next item ready for processing
 */
export async function getNextItem(): Promise<SyncQueueItem | null> {
  return syncQueueStorage.getNext()
}

/**
 * Get all pending items
 */
export async function getPendingItems(): Promise<SyncQueueItem[]> {
  return syncQueueStorage.getAll()
}

/**
 * Clear the entire queue
 */
export async function clearQueue(): Promise<void> {
  await syncQueueStorage.clear()
  await updatePendingCount()
}

/**
 * Update the pending count in sync state
 */
async function updatePendingCount(): Promise<void> {
  const queue = await syncQueueStorage.getAll()
  await syncStateStorage.update({ pendingCount: queue.length })
}

/**
 * Check if there are any pending items
 */
export async function hasPendingItems(): Promise<boolean> {
  const queue = await syncQueueStorage.getAll()
  return queue.length > 0
}

/**
 * Get time until next item is ready (for scheduling)
 */
export async function getNextRetryTime(): Promise<number | null> {
  const queue = await syncQueueStorage.getAll()
  if (queue.length === 0) {
    return null
  }

  const nextTimes = queue.map((item) => item.nextRetryAt)
  return Math.min(...nextTimes)
}
