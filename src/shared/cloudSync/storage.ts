/**
 * Cloud sync storage helpers
 *
 * Provides type-safe access to cloud sync related storage
 */

import { storage } from '../storage'
import { CLOUD_SYNC_KEYS } from '../constants'
import { nanoid } from 'nanoid'
import type {
  CloudCredentials,
  EncryptionKeyData,
  SyncQueueItem,
  SyncState,
  CloudSyncSettings,
} from './types'
import { DEFAULT_CLOUD_SYNC_SETTINGS } from './types'

/**
 * Cloud credentials storage
 */
export const cloudCredentialsStorage = {
  async get(): Promise<CloudCredentials | null> {
    return storage.get<CloudCredentials | null>(CLOUD_SYNC_KEYS.CREDENTIALS, null)
  },

  async save(credentials: CloudCredentials): Promise<void> {
    await storage.set(CLOUD_SYNC_KEYS.CREDENTIALS, credentials)
  },

  async clear(): Promise<void> {
    await storage.remove(CLOUD_SYNC_KEYS.CREDENTIALS)
  },
}

/**
 * Encryption key data storage
 */
export const encryptionKeyStorage = {
  async get(): Promise<EncryptionKeyData | null> {
    return storage.get<EncryptionKeyData | null>(CLOUD_SYNC_KEYS.ENCRYPTION_KEY, null)
  },

  async save(keyData: EncryptionKeyData): Promise<void> {
    await storage.set(CLOUD_SYNC_KEYS.ENCRYPTION_KEY, keyData)
  },

  async clear(): Promise<void> {
    await storage.remove(CLOUD_SYNC_KEYS.ENCRYPTION_KEY)
  },
}

/**
 * Sync queue storage with serialized access
 */
let _syncQueueLock: Promise<void> = Promise.resolve()

function withSyncQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _syncQueueLock.then(fn, fn)
  _syncQueueLock = result.then(
    () => {},
    () => {}
  )
  return result
}

export const syncQueueStorage = {
  async getAll(): Promise<SyncQueueItem[]> {
    return storage.get<SyncQueueItem[]>(CLOUD_SYNC_KEYS.SYNC_QUEUE, [])
  },

  /**
   * Add an item to the queue (serialized)
   */
  enqueue(type: 'upload' | 'delete', sessionId: string): Promise<SyncQueueItem> {
    return withSyncQueueLock(async () => {
      const queue = await this.getAll()

      // Remove any existing item for this session (we'll replace it)
      const filtered = queue.filter((item) => item.sessionId !== sessionId)

      const item: SyncQueueItem = {
        id: nanoid(),
        type,
        sessionId,
        queuedAt: Date.now(),
        retryCount: 0,
        nextRetryAt: Date.now(),
      }

      filtered.push(item)
      await storage.set(CLOUD_SYNC_KEYS.SYNC_QUEUE, filtered)
      return item
    })
  },

  /**
   * Remove an item from the queue (serialized)
   */
  dequeue(itemId: string): Promise<void> {
    return withSyncQueueLock(async () => {
      const queue = await this.getAll()
      const filtered = queue.filter((item) => item.id !== itemId)
      await storage.set(CLOUD_SYNC_KEYS.SYNC_QUEUE, filtered)
    })
  },

  /**
   * Update an item in the queue (for retry tracking)
   */
  update(itemId: string, updates: Partial<SyncQueueItem>): Promise<void> {
    return withSyncQueueLock(async () => {
      const queue = await this.getAll()
      const index = queue.findIndex((item) => item.id === itemId)
      if (index >= 0) {
        queue[index] = { ...queue[index], ...updates }
        await storage.set(CLOUD_SYNC_KEYS.SYNC_QUEUE, queue)
      }
    })
  },

  /**
   * Get the next item ready to be processed
   */
  async getNext(): Promise<SyncQueueItem | null> {
    const queue = await this.getAll()
    const now = Date.now()

    // Find items ready for retry, sorted by queue time
    const ready = queue
      .filter((item) => item.nextRetryAt <= now)
      .sort((a, b) => a.queuedAt - b.queuedAt)

    return ready[0] || null
  },

  /**
   * Clear all items from the queue
   */
  async clear(): Promise<void> {
    await storage.set(CLOUD_SYNC_KEYS.SYNC_QUEUE, [])
  },
}

/**
 * Sync state storage
 */
export const syncStateStorage = {
  async get(): Promise<SyncState> {
    return storage.get<SyncState>(CLOUD_SYNC_KEYS.SYNC_STATE, {
      syncing: false,
      pendingCount: 0,
    })
  },

  async update(updates: Partial<SyncState>): Promise<void> {
    const current = await this.get()
    await storage.set(CLOUD_SYNC_KEYS.SYNC_STATE, { ...current, ...updates })
  },

  async clear(): Promise<void> {
    await storage.set(CLOUD_SYNC_KEYS.SYNC_STATE, {
      syncing: false,
      pendingCount: 0,
    })
  },
}

/**
 * Cloud sync settings storage
 */
export const cloudSyncSettingsStorage = {
  async get(): Promise<CloudSyncSettings> {
    const stored = await storage.get<Partial<CloudSyncSettings>>(CLOUD_SYNC_KEYS.SYNC_SETTINGS, {})
    return { ...DEFAULT_CLOUD_SYNC_SETTINGS, ...stored }
  },

  async save(settings: CloudSyncSettings): Promise<void> {
    await storage.set(CLOUD_SYNC_KEYS.SYNC_SETTINGS, settings)
  },

  async update(updates: Partial<CloudSyncSettings>): Promise<CloudSyncSettings> {
    const current = await this.get()
    const updated = { ...current, ...updates }
    await this.save(updated)
    return updated
  },
}

/**
 * Device ID storage (unique identifier for this browser/device)
 */
export const deviceIdStorage = {
  async get(): Promise<string> {
    let deviceId = await storage.get<string | null>(CLOUD_SYNC_KEYS.DEVICE_ID, null)
    if (!deviceId) {
      deviceId = nanoid()
      await storage.set(CLOUD_SYNC_KEYS.DEVICE_ID, deviceId)
    }
    return deviceId
  },
}

/**
 * Clear all cloud sync data (for disconnect)
 */
export async function clearAllCloudSyncData(): Promise<void> {
  await Promise.all([
    cloudCredentialsStorage.clear(),
    encryptionKeyStorage.clear(),
    syncQueueStorage.clear(),
    syncStateStorage.clear(),
    storage.remove(CLOUD_SYNC_KEYS.CACHED_KEY),
    storage.remove(CLOUD_SYNC_KEYS.SYNCED_IDS),
  ])
}
