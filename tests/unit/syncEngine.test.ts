/**
 * Tests for sync engine orchestration
 *
 * Tests the cloud sync engine that coordinates all sync operations.
 * Uses heavy mocking of storage, gdrive, and encryption modules.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetMockChrome, setMockStorage } from '../mocks/chrome'
import {
  isConfigured,
  isEnabled,
  unlock,
  lock,
  isUnlocked,
  getSyncStatus,
  performFullSync,
  pushSession,
  deleteSessionFromCloud,
  processQueue,
} from '@/shared/cloudSync/syncEngine'
import * as gdrive from '@/shared/cloudSync/providers/gdrive'
import * as syncQueue from '@/shared/cloudSync/syncQueue'
import * as encryption from '@/shared/cloudSync/encryption'
import * as oauth from '@/shared/cloudSync/oauth'
import {
  cloudCredentialsStorage,
  encryptionKeyStorage,
  syncStateStorage,
  cloudSyncSettingsStorage,
  deviceIdStorage,
} from '@/shared/cloudSync/storage'
import { sessionsStorage } from '@/shared/storage'
import { CLOUD_SYNC_KEYS } from '@/shared/constants'
import type { CloudCredentials, EncryptionKeyData, CloudTokens, SyncManifest } from '@/shared/cloudSync/types'
import type { Session } from '@/shared/types'

// Mock modules
vi.mock('@/shared/cloudSync/providers/gdrive')
vi.mock('@/shared/cloudSync/syncQueue')
vi.mock('@/shared/cloudSync/oauth')

// Mock fetch for encryption tests
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('syncEngine', () => {
  beforeEach(() => {
    resetMockChrome()
    vi.clearAllMocks()
    // Reset cached state
    lock()
  })

  afterEach(() => {
    lock() // Ensure cleanup
  })

  describe('isConfigured', () => {
    it('should return false when no credentials exist', async () => {
      const result = await isConfigured()
      expect(result).toBe(false)
    })

    it('should return false when no encryption key exists', async () => {
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        connectedAt: Date.now(),
      })

      const result = await isConfigured()
      expect(result).toBe(false)
    })

    it('should return true when both credentials and key exist', async () => {
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        connectedAt: Date.now(),
      })
      await encryptionKeyStorage.save({
        salt: 'salt',
        verificationHash: 'hash',
      })

      const result = await isConfigured()
      expect(result).toBe(true)
    })
  })

  describe('isEnabled', () => {
    it('should return false by default', async () => {
      const result = await isEnabled()
      expect(result).toBe(false)
    })

    it('should return true when enabled in settings', async () => {
      await cloudSyncSettingsStorage.update({ enabled: true })

      const result = await isEnabled()
      expect(result).toBe(true)
    })
  })

  describe('unlock', () => {
    it('should return false when no encryption key exists', async () => {
      const result = await unlock('password')
      expect(result).toBe(false)
    })

    it('should return true and cache key when password is correct', async () => {
      // Setup encryption key data
      const { keyData } = await encryption.setupEncryption('correct-password')
      await encryptionKeyStorage.save(keyData)

      // Also need credentials for the unlock to verify
      const tokens: CloudTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        scope: 'scope',
      }

      // Create encrypted tokens using the same password
      const key = await encryption.deriveKey('correct-password', keyData.salt)
      const encryptedTokens = await encryption.encryptObject(tokens, key)

      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: JSON.stringify(encryptedTokens),
        connectedAt: Date.now(),
      })

      const result = await unlock('correct-password')
      expect(result).toBe(true)
      expect(isUnlocked()).toBe(true)
    })

    it('should return false for wrong password', async () => {
      const { keyData } = await encryption.setupEncryption('correct-password')
      await encryptionKeyStorage.save(keyData)

      const tokens: CloudTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        scope: 'scope',
      }

      const key = await encryption.deriveKey('correct-password', keyData.salt)
      const encryptedTokens = await encryption.encryptObject(tokens, key)

      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: JSON.stringify(encryptedTokens),
        connectedAt: Date.now(),
      })

      const result = await unlock('wrong-password')
      expect(result).toBe(false)
      expect(isUnlocked()).toBe(false)
    })
  })

  describe('lock', () => {
    it('should clear cached encryption key', async () => {
      const { keyData } = await encryption.setupEncryption('password')
      await encryptionKeyStorage.save(keyData)

      const tokens: CloudTokens = {
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: Date.now() + 3600000,
        scope: 'scope',
      }
      const key = await encryption.deriveKey('password', keyData.salt)
      const encryptedTokens = await encryption.encryptObject(tokens, key)

      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: JSON.stringify(encryptedTokens),
        connectedAt: Date.now(),
      })

      await unlock('password')
      expect(isUnlocked()).toBe(true)

      lock()
      expect(isUnlocked()).toBe(false)
    })
  })

  describe('isUnlocked', () => {
    it('should return false initially', () => {
      expect(isUnlocked()).toBe(false)
    })
  })

  describe('getSyncStatus', () => {
    it('should return correct status when not configured', async () => {
      const status = await getSyncStatus()

      expect(status.configured).toBe(false)
      expect(status.enabled).toBe(false)
      expect(status.unlocked).toBe(false)
      expect(status.syncing).toBe(false)
      expect(status.pendingCount).toBe(0)
    })

    it('should return sync state from storage', async () => {
      await syncStateStorage.update({
        syncing: true,
        lastSyncAt: 12345,
        lastError: 'Previous error',
        pendingCount: 3,
      })

      const status = await getSyncStatus()

      expect(status.syncing).toBe(true)
      expect(status.lastSyncAt).toBe(12345)
      expect(status.lastError).toBe('Previous error')
      expect(status.pendingCount).toBe(3)
    })

    it('should return email from credentials', async () => {
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        email: 'user@example.com',
        connectedAt: Date.now(),
      })

      const status = await getSyncStatus()
      expect(status.email).toBe('user@example.com')
    })
  })

  describe('pushSession', () => {
    it('should queue upload when not configured', async () => {
      await pushSession('session-123')

      expect(syncQueue.enqueueUpload).toHaveBeenCalledWith('session-123')
    })

    it('should queue upload when not unlocked', async () => {
      // Configure but don't unlock
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        connectedAt: Date.now(),
      })
      await encryptionKeyStorage.save({
        salt: 'salt',
        verificationHash: 'hash',
      })

      await pushSession('session-123')

      expect(syncQueue.enqueueUpload).toHaveBeenCalledWith('session-123')
    })
  })

  describe('deleteSessionFromCloud', () => {
    it('should queue delete when not configured', async () => {
      await deleteSessionFromCloud('session-123')

      expect(syncQueue.enqueueDelete).toHaveBeenCalledWith('session-123')
    })

    it('should queue delete when not unlocked', async () => {
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        connectedAt: Date.now(),
      })
      await encryptionKeyStorage.save({
        salt: 'salt',
        verificationHash: 'hash',
      })

      await deleteSessionFromCloud('session-123')

      expect(syncQueue.enqueueDelete).toHaveBeenCalledWith('session-123')
    })
  })

  describe('processQueue', () => {
    it('should do nothing when not configured', async () => {
      await processQueue()

      expect(syncQueue.getNextItem).not.toHaveBeenCalled()
    })

    it('should do nothing when not unlocked', async () => {
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: 'tokens',
        connectedAt: Date.now(),
      })
      await encryptionKeyStorage.save({
        salt: 'salt',
        verificationHash: 'hash',
      })

      await processQueue()

      expect(syncQueue.getNextItem).not.toHaveBeenCalled()
    })
  })

  describe('performFullSync', () => {
    // Integration tests for full sync are complex and would require
    // extensive mocking. Here we test basic error handling.

    it('should update sync state at start and end', async () => {
      // Not configured, should fail early but still update state
      const result = await performFullSync()

      expect(result.success).toBe(false)

      // Should have cleared syncing flag
      const state = await syncStateStorage.get()
      expect(state.syncing).toBe(false)
    })

    it('should return error result when not configured', async () => {
      const result = await performFullSync()

      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })
})

describe('syncEngine - integration scenarios', () => {
  // These tests use real encryption but mock gdrive

  let testKey: CryptoKey
  let testKeyData: EncryptionKeyData
  let testTokens: CloudTokens

  beforeEach(async () => {
    resetMockChrome()
    vi.clearAllMocks()
    lock()

    // Setup real encryption
    const setup = await encryption.setupEncryption('test-password')
    testKey = setup.key
    testKeyData = setup.keyData
    testTokens = {
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: Date.now() + 3600000,
      scope: 'https://www.googleapis.com/auth/drive.appdata',
    }

    // Encrypt and store tokens
    const encryptedTokens = await encryption.encryptObject(testTokens, testKey)
    await cloudCredentialsStorage.save({
      provider: 'gdrive',
      encryptedTokens: JSON.stringify(encryptedTokens),
      email: 'test@example.com',
      connectedAt: Date.now(),
    })
    await encryptionKeyStorage.save(testKeyData)
    await cloudSyncSettingsStorage.update({ enabled: true })

    // Mock oauth to return tokens without refresh
    vi.mocked(oauth.getValidTokens).mockResolvedValue(testTokens)
  })

  afterEach(() => {
    lock()
  })

  it('should unlock successfully with correct password', async () => {
    const result = await unlock('test-password')
    expect(result).toBe(true)
    expect(isUnlocked()).toBe(true)
  })

  it('should get configured status after setup', async () => {
    const status = await getSyncStatus()

    expect(status.configured).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.unlocked).toBe(false) // Not unlocked yet
    expect(status.email).toBe('test@example.com')
  })

  it('should unlock and show unlocked status', async () => {
    await unlock('test-password')

    const status = await getSyncStatus()
    expect(status.unlocked).toBe(true)
  })

  it('should migrate verification hash on unlock if it differs', async () => {
    // Tamper the stored hash to simulate a pre-migration (random IV) hash
    const storedKeyData = await encryptionKeyStorage.get()
    expect(storedKeyData).not.toBeNull()
    await encryptionKeyStorage.save({ ...storedKeyData!, verificationHash: 'old-random-iv-hash' })

    // Unlock should succeed (verification is by decrypting tokens) and migrate the hash
    const result = await unlock('test-password')
    expect(result).toBe(true)

    // Stored hash should now be updated to the deterministic value
    const updatedKeyData = await encryptionKeyStorage.get()
    expect(updatedKeyData!.verificationHash).not.toBe('old-random-iv-hash')
    expect(updatedKeyData!.verificationHash.length).toBe(32)
  })

  it('should not rewrite verification hash if already current', async () => {
    // First unlock migrates if needed
    await unlock('test-password')
    const afterFirst = await encryptionKeyStorage.get()

    lock()

    // Second unlock should not change the hash
    await unlock('test-password')
    const afterSecond = await encryptionKeyStorage.get()

    expect(afterSecond!.verificationHash).toBe(afterFirst!.verificationHash)
  })

  describe('pushSession - when unlocked', () => {
    beforeEach(async () => {
      await unlock('test-password')
    })

    it('should upload session and update manifest', async () => {
      const session: Session = {
        id: 'sess-1',
        name: 'Test Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Example' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      const existingManifest: SyncManifest = {
        version: 1,
        lastSync: Date.now() - 1000,
        deviceId: 'device-1',
        sessions: [],
        tombstones: [],
      }

      vi.mocked(gdrive.uploadSession).mockResolvedValue()
      vi.mocked(gdrive.downloadManifest).mockResolvedValue(existingManifest)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      await pushSession('sess-1')

      expect(gdrive.uploadSession).toHaveBeenCalledWith(
        testTokens.accessToken,
        'sess-1',
        expect.any(Object)
      )
      expect(gdrive.uploadManifest).toHaveBeenCalledWith(
        testTokens.accessToken,
        expect.objectContaining({
          sessions: expect.arrayContaining([
            expect.objectContaining({ id: 'sess-1', name: 'Test Session' }),
          ]),
        })
      )
    })

    it('should skip upload when session does not exist', async () => {
      vi.mocked(gdrive.uploadSession).mockResolvedValue()

      await pushSession('nonexistent')

      expect(gdrive.uploadSession).not.toHaveBeenCalled()
    })

    it('should queue upload on error', async () => {
      const session: Session = {
        id: 'sess-err',
        name: 'Error Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Example' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      vi.mocked(gdrive.uploadSession).mockRejectedValue(new Error('Network error'))

      await pushSession('sess-err')

      expect(syncQueue.enqueueUpload).toHaveBeenCalledWith('sess-err')
    })
  })

  describe('deleteSessionFromCloud - when unlocked', () => {
    beforeEach(async () => {
      await unlock('test-password')
    })

    it('should delete session and add tombstone to manifest', async () => {
      const existingManifest: SyncManifest = {
        version: 1,
        lastSync: Date.now() - 1000,
        deviceId: 'device-1',
        sessions: [{ id: 'sess-del', name: 'Delete Me', updatedAt: Date.now(), tabCount: 1, checksum: 'abc' }],
        tombstones: [],
      }

      vi.mocked(gdrive.deleteSession).mockResolvedValue()
      vi.mocked(gdrive.downloadManifest).mockResolvedValue(existingManifest)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      await deleteSessionFromCloud('sess-del')

      expect(gdrive.deleteSession).toHaveBeenCalledWith(testTokens.accessToken, 'sess-del')
      expect(gdrive.uploadManifest).toHaveBeenCalledWith(
        testTokens.accessToken,
        expect.objectContaining({
          sessions: [],
          tombstones: expect.arrayContaining([
            expect.objectContaining({ id: 'sess-del' }),
          ]),
        })
      )
    })

    it('should queue delete on error', async () => {
      vi.mocked(gdrive.deleteSession).mockRejectedValue(new Error('Network error'))

      await deleteSessionFromCloud('sess-fail')

      expect(syncQueue.enqueueDelete).toHaveBeenCalledWith('sess-fail')
    })
  })

  describe('performFullSync - when unlocked', () => {
    beforeEach(async () => {
      await unlock('test-password')
      vi.mocked(syncQueue.getNextItem).mockResolvedValue(null)
    })

    it('should upload local sessions to empty remote', async () => {
      const session: Session = {
        id: 'local-1',
        name: 'Local Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(null)
      vi.mocked(gdrive.uploadSession).mockResolvedValue()
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.success).toBe(true)
      expect(result.uploaded).toBe(1)
      expect(gdrive.uploadSession).toHaveBeenCalled()
      expect(gdrive.uploadManifest).toHaveBeenCalled()
    })

    it('should download remote sessions not present locally', async () => {
      const remoteSession: Session = {
        id: 'remote-1',
        name: 'Remote Session',
        windows: [{ tabs: [{ url: 'https://remote.com', title: 'Remote' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      const encryptedSession = await encryption.encryptObject(
        { session: remoteSession, deviceId: 'other-device', timestamp: Date.now() },
        testKey
      )

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [{ id: 'remote-1', name: 'Remote Session', updatedAt: Date.now(), tabCount: 1, checksum: 'abc' }],
        tombstones: [],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.downloadSession).mockResolvedValue(encryptedSession)
      vi.mocked(gdrive.deleteSession).mockResolvedValue()
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.downloaded).toBe(1)

      const saved = await sessionsStorage.get('remote-1')
      expect(saved).not.toBeNull()
      expect(saved!.name).toBe('Remote Session')
    })

    it('should handle sync errors gracefully', async () => {
      vi.mocked(gdrive.downloadManifest).mockRejectedValue(new Error('Drive unavailable'))

      const result = await performFullSync()

      expect(result.success).toBe(false)
      expect(result.errors).toContain('Drive unavailable')

      const state = await syncStateStorage.get()
      expect(state.syncing).toBe(false)
      expect(state.lastError).toBe('Drive unavailable')
    })
  })
})
