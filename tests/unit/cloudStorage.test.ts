/**
 * Tests for cloud sync storage helpers
 *
 * Tests the type-safe storage wrappers for cloud sync functionality.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resetMockChrome, getMockStorage } from '../mocks/chrome'
import {
  cloudCredentialsStorage,
  encryptionKeyStorage,
  syncQueueStorage,
  syncStateStorage,
  cloudSyncSettingsStorage,
  deviceIdStorage,
  clearAllCloudSyncData,
} from '@/shared/cloudSync/storage'
import { CLOUD_SYNC_KEYS } from '@/shared/constants'
import type {
  CloudCredentials,
  EncryptionKeyData,
  SyncQueueItem,
  SyncState,
  CloudSyncSettings,
} from '@/shared/cloudSync/types'
import { DEFAULT_CLOUD_SYNC_SETTINGS } from '@/shared/cloudSync/types'

describe('cloudCredentialsStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('get', () => {
    it('should return null when no credentials exist', async () => {
      const result = await cloudCredentialsStorage.get()
      expect(result).toBeNull()
    })

    it('should return stored credentials', async () => {
      const credentials: CloudCredentials = {
        provider: 'gdrive',
        encryptedTokens: 'encrypted-tokens-data',
        email: 'user@example.com',
        connectedAt: Date.now(),
      }
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.CREDENTIALS]: credentials })

      const result = await cloudCredentialsStorage.get()
      expect(result).toEqual(credentials)
    })
  })

  describe('save', () => {
    it('should save credentials', async () => {
      const credentials: CloudCredentials = {
        provider: 'gdrive',
        encryptedTokens: 'encrypted-tokens-data',
        email: 'user@example.com',
        connectedAt: Date.now(),
      }

      await cloudCredentialsStorage.save(credentials)

      const stored = getMockStorage()[CLOUD_SYNC_KEYS.CREDENTIALS]
      expect(stored).toEqual(credentials)
    })
  })

  describe('clear', () => {
    it('should remove credentials', async () => {
      const credentials: CloudCredentials = {
        provider: 'gdrive',
        encryptedTokens: 'test',
        connectedAt: Date.now(),
      }
      await cloudCredentialsStorage.save(credentials)

      await cloudCredentialsStorage.clear()

      const result = await cloudCredentialsStorage.get()
      expect(result).toBeNull()
    })
  })
})

describe('encryptionKeyStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('get', () => {
    it('should return null when no key data exists', async () => {
      const result = await encryptionKeyStorage.get()
      expect(result).toBeNull()
    })

    it('should return stored key data', async () => {
      const keyData: EncryptionKeyData = {
        salt: 'base64-salt',
        verificationHash: 'hash-value',
        recoveryKey: 'recovery-key-format',
      }
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.ENCRYPTION_KEY]: keyData })

      const result = await encryptionKeyStorage.get()
      expect(result).toEqual(keyData)
    })
  })

  describe('save', () => {
    it('should save key data', async () => {
      const keyData: EncryptionKeyData = {
        salt: 'base64-salt',
        verificationHash: 'hash-value',
      }

      await encryptionKeyStorage.save(keyData)

      const stored = getMockStorage()[CLOUD_SYNC_KEYS.ENCRYPTION_KEY]
      expect(stored).toEqual(keyData)
    })
  })

  describe('clear', () => {
    it('should remove key data', async () => {
      await encryptionKeyStorage.save({
        salt: 'test',
        verificationHash: 'test',
      })

      await encryptionKeyStorage.clear()

      const result = await encryptionKeyStorage.get()
      expect(result).toBeNull()
    })
  })
})

describe('syncQueueStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('getAll', () => {
    it('should return empty array when no items exist', async () => {
      const result = await syncQueueStorage.getAll()
      expect(result).toEqual([])
    })

    it('should return all queued items', async () => {
      const items: SyncQueueItem[] = [
        {
          id: 'item-1',
          type: 'upload',
          sessionId: 'session-1',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: Date.now(),
        },
        {
          id: 'item-2',
          type: 'delete',
          sessionId: 'session-2',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: Date.now(),
        },
      ]
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.SYNC_QUEUE]: items })

      const result = await syncQueueStorage.getAll()
      expect(result).toEqual(items)
    })
  })

  describe('enqueue', () => {
    it('should add item to queue', async () => {
      const item = await syncQueueStorage.enqueue('upload', 'session-123')

      expect(item.type).toBe('upload')
      expect(item.sessionId).toBe('session-123')
      expect(item.id).toBeDefined()
      expect(item.retryCount).toBe(0)
    })

    it('should generate unique IDs', async () => {
      const item1 = await syncQueueStorage.enqueue('upload', 'session-1')
      const item2 = await syncQueueStorage.enqueue('upload', 'session-2')

      expect(item1.id).not.toBe(item2.id)
    })

    it('should replace existing item for same session', async () => {
      await syncQueueStorage.enqueue('upload', 'session-123')
      await syncQueueStorage.enqueue('delete', 'session-123')

      const items = await syncQueueStorage.getAll()
      expect(items).toHaveLength(1)
      expect(items[0].type).toBe('delete')
    })

    it('should set queuedAt and nextRetryAt to current time', async () => {
      const before = Date.now()
      const item = await syncQueueStorage.enqueue('upload', 'session-123')
      const after = Date.now()

      expect(item.queuedAt).toBeGreaterThanOrEqual(before)
      expect(item.queuedAt).toBeLessThanOrEqual(after)
      expect(item.nextRetryAt).toEqual(item.queuedAt)
    })
  })

  describe('dequeue', () => {
    it('should remove item from queue', async () => {
      const item = await syncQueueStorage.enqueue('upload', 'session-123')
      await syncQueueStorage.dequeue(item.id)

      const items = await syncQueueStorage.getAll()
      expect(items).toHaveLength(0)
    })

    it('should only remove specified item', async () => {
      const item1 = await syncQueueStorage.enqueue('upload', 'session-1')
      await syncQueueStorage.enqueue('upload', 'session-2')

      await syncQueueStorage.dequeue(item1.id)

      const items = await syncQueueStorage.getAll()
      expect(items).toHaveLength(1)
      expect(items[0].sessionId).toBe('session-2')
    })
  })

  describe('update', () => {
    it('should update item properties', async () => {
      const item = await syncQueueStorage.enqueue('upload', 'session-123')

      await syncQueueStorage.update(item.id, {
        retryCount: 3,
        lastError: 'Network error',
        nextRetryAt: Date.now() + 10000,
      })

      const items = await syncQueueStorage.getAll()
      expect(items[0].retryCount).toBe(3)
      expect(items[0].lastError).toBe('Network error')
    })

    it('should preserve other properties', async () => {
      const item = await syncQueueStorage.enqueue('upload', 'session-123')
      const originalQueuedAt = item.queuedAt

      await syncQueueStorage.update(item.id, { retryCount: 1 })

      const items = await syncQueueStorage.getAll()
      expect(items[0].queuedAt).toBe(originalQueuedAt)
      expect(items[0].type).toBe('upload')
      expect(items[0].sessionId).toBe('session-123')
    })

    it('should do nothing for non-existent item', async () => {
      await syncQueueStorage.update('non-existent', { retryCount: 5 })
      // Should not throw
    })
  })

  describe('getNext', () => {
    it('should return null when queue is empty', async () => {
      const result = await syncQueueStorage.getNext()
      expect(result).toBeNull()
    })

    it('should return item ready for processing', async () => {
      await syncQueueStorage.enqueue('upload', 'session-123')

      const item = await syncQueueStorage.getNext()
      expect(item).not.toBeNull()
      expect(item!.sessionId).toBe('session-123')
    })

    it('should not return items scheduled for future', async () => {
      const item = await syncQueueStorage.enqueue('upload', 'session-123')
      await syncQueueStorage.update(item.id, {
        nextRetryAt: Date.now() + 60000, // 1 minute in future
      })

      const result = await syncQueueStorage.getNext()
      expect(result).toBeNull()
    })

    it('should return oldest item first', async () => {
      const item1 = await syncQueueStorage.enqueue('upload', 'session-1')
      await new Promise(resolve => setTimeout(resolve, 10))
      await syncQueueStorage.enqueue('upload', 'session-2')

      const next = await syncQueueStorage.getNext()
      expect(next!.id).toBe(item1.id)
    })
  })

  describe('clear', () => {
    it('should remove all items from queue', async () => {
      await syncQueueStorage.enqueue('upload', 'session-1')
      await syncQueueStorage.enqueue('upload', 'session-2')
      await syncQueueStorage.enqueue('delete', 'session-3')

      await syncQueueStorage.clear()

      const items = await syncQueueStorage.getAll()
      expect(items).toHaveLength(0)
    })
  })
})

describe('syncStateStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('get', () => {
    it('should return default state when none exists', async () => {
      const state = await syncStateStorage.get()

      expect(state.syncing).toBe(false)
      expect(state.pendingCount).toBe(0)
    })

    it('should return stored state', async () => {
      const storedState: SyncState = {
        syncing: true,
        lastSyncAt: Date.now(),
        lastError: 'Previous error',
        pendingCount: 5,
        currentOperation: 'Uploading...',
      }
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.SYNC_STATE]: storedState })

      const state = await syncStateStorage.get()
      expect(state).toEqual(storedState)
    })
  })

  describe('update', () => {
    it('should merge updates with existing state', async () => {
      await syncStateStorage.update({ syncing: true })
      await syncStateStorage.update({ pendingCount: 3 })

      const state = await syncStateStorage.get()
      expect(state.syncing).toBe(true)
      expect(state.pendingCount).toBe(3)
    })

    it('should preserve existing properties', async () => {
      await syncStateStorage.update({
        syncing: false,
        lastSyncAt: 12345,
        pendingCount: 0,
      })

      await syncStateStorage.update({ syncing: true })

      const state = await syncStateStorage.get()
      expect(state.lastSyncAt).toBe(12345)
    })
  })

  describe('clear', () => {
    it('should reset to default state', async () => {
      await syncStateStorage.update({
        syncing: true,
        lastSyncAt: Date.now(),
        lastError: 'Error',
        pendingCount: 10,
      })

      await syncStateStorage.clear()

      const state = await syncStateStorage.get()
      expect(state.syncing).toBe(false)
      expect(state.pendingCount).toBe(0)
      expect(state.lastSyncAt).toBeUndefined()
      expect(state.lastError).toBeUndefined()
    })
  })
})

describe('cloudSyncSettingsStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('get', () => {
    it('should return default settings when none exist', async () => {
      const settings = await cloudSyncSettingsStorage.get()

      expect(settings).toEqual(DEFAULT_CLOUD_SYNC_SETTINGS)
      expect(settings.enabled).toBe(false)
      expect(settings.intervalMinutes).toBe(15)
      expect(settings.syncOnSave).toBe(true)
    })

    it('should merge stored settings with defaults', async () => {
      await chrome.storage.local.set({
        [CLOUD_SYNC_KEYS.SYNC_SETTINGS]: { enabled: true },
      })

      const settings = await cloudSyncSettingsStorage.get()
      expect(settings.enabled).toBe(true)
      expect(settings.intervalMinutes).toBe(15) // From default
      expect(settings.syncOnSave).toBe(true) // From default
    })
  })

  describe('save', () => {
    it('should save settings', async () => {
      const settings: CloudSyncSettings = {
        enabled: true,
        intervalMinutes: 30,
        syncOnSave: false,
      }

      await cloudSyncSettingsStorage.save(settings)

      const stored = getMockStorage()[CLOUD_SYNC_KEYS.SYNC_SETTINGS]
      expect(stored).toEqual(settings)
    })
  })

  describe('update', () => {
    it('should update specific settings', async () => {
      const updated = await cloudSyncSettingsStorage.update({ enabled: true })

      expect(updated.enabled).toBe(true)
      expect(updated.intervalMinutes).toBe(15) // Default preserved
    })

    it('should return the updated settings', async () => {
      const result = await cloudSyncSettingsStorage.update({
        intervalMinutes: 60,
      })

      expect(result.intervalMinutes).toBe(60)
    })
  })
})

describe('deviceIdStorage', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  describe('get', () => {
    it('should generate a new device ID on first access', async () => {
      const deviceId = await deviceIdStorage.get()

      expect(typeof deviceId).toBe('string')
      expect(deviceId.length).toBeGreaterThan(0)
    })

    it('should return the same device ID on subsequent accesses', async () => {
      const id1 = await deviceIdStorage.get()
      const id2 = await deviceIdStorage.get()

      expect(id1).toBe(id2)
    })

    it('should persist device ID to storage', async () => {
      const deviceId = await deviceIdStorage.get()

      const stored = getMockStorage()[CLOUD_SYNC_KEYS.DEVICE_ID]
      expect(stored).toBe(deviceId)
    })

    it('should return stored device ID if exists', async () => {
      const existingId = 'existing-device-id-123'
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.DEVICE_ID]: existingId })

      const deviceId = await deviceIdStorage.get()
      expect(deviceId).toBe(existingId)
    })
  })
})

describe('clearAllCloudSyncData', () => {
  beforeEach(() => {
    resetMockChrome()
  })

  it('should clear all cloud sync related data', async () => {
    // Set up various data
    await cloudCredentialsStorage.save({
      provider: 'gdrive',
      encryptedTokens: 'tokens',
      connectedAt: Date.now(),
    })
    await encryptionKeyStorage.save({
      salt: 'salt',
      verificationHash: 'hash',
    })
    await syncQueueStorage.enqueue('upload', 'session-1')
    await syncStateStorage.update({ syncing: true, pendingCount: 5 })
    await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.CACHED_KEY]: 'cached' })

    await clearAllCloudSyncData()

    expect(await cloudCredentialsStorage.get()).toBeNull()
    expect(await encryptionKeyStorage.get()).toBeNull()
    expect(await syncQueueStorage.getAll()).toEqual([])
    const state = await syncStateStorage.get()
    expect(state.syncing).toBe(false)
    expect(state.pendingCount).toBe(0)
  })

  it('should not affect other storage keys', async () => {
    await chrome.storage.local.set({ 'other:key': 'value' })

    await clearAllCloudSyncData()

    const stored = getMockStorage()
    expect(stored['other:key']).toBe('value')
  })
})
