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
  getValidTokensForDisconnect,
  getEncryptionKeyForSetup,
  setEncryptionKey,
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
import type { CloudCredentials, EncryptionKeyData, CloudTokens, SyncManifest, SyncSessionMeta } from '@/shared/cloudSync/types'
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

    it('should delete local session when remote has tombstone for it', async () => {
      const session: Session = {
        id: 'tomb-1',
        name: 'Tombstoned Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [],
        tombstones: [{ id: 'tomb-1', deletedAt: Date.now() }],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.deleted).toBe(1)
      const saved = await sessionsStorage.get('tomb-1')
      expect(saved).toBeUndefined()
    })

    it('should clean up expired tombstones (>30 days old)', async () => {
      const oldTombstoneDate = Date.now() - 31 * 24 * 60 * 60 * 1000
      const recentTombstoneDate = Date.now() - 1000

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [],
        tombstones: [
          { id: 'old-tomb', deletedAt: oldTombstoneDate },
          { id: 'recent-tomb', deletedAt: recentTombstoneDate },
        ],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      await performFullSync()

      // Verify the uploaded manifest only has the recent tombstone
      const uploadedManifest = vi.mocked(gdrive.uploadManifest).mock.calls[0][1]
      expect(uploadedManifest.tombstones).toHaveLength(1)
      expect(uploadedManifest.tombstones[0].id).toBe('recent-tomb')
    })

    it('should propagate local deletions to cloud', async () => {
      // Mark a session as previously synced
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.SYNCED_IDS]: ['deleted-locally'] })

      // Remote still has it, but local doesn't
      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [
          { id: 'deleted-locally', name: 'Gone Locally', updatedAt: Date.now() - 5000, tabCount: 1, checksum: 'abc' },
        ],
        tombstones: [],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.deleteSession).mockResolvedValue()
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.deleted).toBe(1)
      expect(gdrive.deleteSession).toHaveBeenCalledWith(testTokens.accessToken, 'deleted-locally')
    })

    it('should handle local deletion propagation error', async () => {
      // Create a session locally, sync it, then delete locally to set up the scenario
      const session: Session = {
        id: 'fail-delete',
        name: 'Fail Delete',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      // Mark as previously synced but DON'T store the session locally (simulates local delete)
      await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.SYNCED_IDS]: ['fail-delete'] })

      // Remote manifest has the session with an old updatedAt so step 5 won't try to download
      // (local would be "newer" but session doesn't exist, so step 5 skip is based on localSessionMap)
      // Actually step 5 WILL try to download since the session is not local.
      // We need to provide valid encrypted data so the download succeeds,
      // then in step 6 the local deletion propagation should try to delete it.
      // But wait - if download succeeds, the session will be stored locally, breaking the test.
      // The key insight: step 5 downloads it (now it IS local), so step 6 won't delete it
      // because localIds is computed before step 5 runs (at line 360).
      // Actually localIds IS computed from localSessions which was fetched at the start.
      // So even though download added it to storage, localIds won't have it.
      // Let's just provide valid encrypted data for the download.
      const encryptedSession = await encryption.encryptObject(
        { session, deviceId: 'other-device', timestamp: Date.now() },
        testKey
      )

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [
          { id: 'fail-delete', name: 'Fail Delete', updatedAt: Date.now(), tabCount: 1, checksum: 'abc' },
        ],
        tombstones: [],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.downloadSession).mockResolvedValue(encryptedSession)
      vi.mocked(gdrive.deleteSession).mockRejectedValue(new Error('Delete failed'))
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Failed to delete session')])
      )
    })

    it('should continue uploading when one session fails', async () => {
      const session1: Session = {
        id: 'up-ok',
        name: 'Good Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      const session2: Session = {
        id: 'up-fail',
        name: 'Bad Session',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session1)
      await sessionsStorage.save(session2)

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(null)
      vi.mocked(gdrive.uploadSession).mockImplementation(async (_token, sessionId) => {
        if (sessionId === 'up-fail') throw new Error('Upload failed')
      })
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.uploaded).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Bad Session')
    })

    it('should skip download when gdrive returns null', async () => {
      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [{ id: 'null-dl', name: 'Null Download', updatedAt: Date.now(), tabCount: 1, checksum: 'abc' }],
        tombstones: [],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.downloadSession).mockResolvedValue(null)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.downloaded).toBe(0)
      const saved = await sessionsStorage.get('null-dl')
      expect(saved).toBeUndefined()
    })

    it('should continue downloading when one session fails to decrypt', async () => {
      const goodSession: Session = {
        id: 'dl-good',
        name: 'Good Download',
        windows: [{ tabs: [{ url: 'https://good.com', title: 'Good' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      const goodEncrypted = await encryption.encryptObject(
        { session: goodSession, deviceId: 'other-device', timestamp: Date.now() },
        testKey
      )

      const manifest: SyncManifest = {
        version: 1,
        lastSync: Date.now(),
        deviceId: 'other-device',
        sessions: [
          { id: 'dl-bad', name: 'Bad Download', updatedAt: Date.now(), tabCount: 1, checksum: 'abc' },
          { id: 'dl-good', name: 'Good Download', updatedAt: Date.now(), tabCount: 1, checksum: 'def' },
        ],
        tombstones: [],
      }

      vi.mocked(gdrive.downloadManifest).mockResolvedValue(manifest)
      vi.mocked(gdrive.downloadSession)
        .mockResolvedValueOnce({ v: 1, iv: 'bad', ct: 'bad' }) // corrupt
        .mockResolvedValueOnce(goodEncrypted) // good
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      const result = await performFullSync()

      expect(result.downloaded).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain('Bad Download')
      const saved = await sessionsStorage.get('dl-good')
      expect(saved).not.toBeNull()
    })
  })

  describe('pushSession - update existing session in manifest', () => {
    beforeEach(async () => {
      await unlock('test-password')
    })

    it('should update existing session entry in manifest (splice path)', async () => {
      const session: Session = {
        id: 'sess-update',
        name: 'Updated Session',
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
        sessions: [
          { id: 'sess-update', name: 'Old Name', updatedAt: Date.now() - 5000, tabCount: 1, checksum: 'old' },
          { id: 'other-sess', name: 'Other', updatedAt: Date.now(), tabCount: 2, checksum: 'other' },
        ],
        tombstones: [],
      }

      vi.mocked(gdrive.uploadSession).mockResolvedValue()
      vi.mocked(gdrive.downloadManifest).mockResolvedValue(existingManifest)
      vi.mocked(gdrive.uploadManifest).mockResolvedValue()

      await pushSession('sess-update')

      const uploadedManifest = vi.mocked(gdrive.uploadManifest).mock.calls[0][1]
      // Should still have exactly 2 sessions (updated in-place, not duplicated)
      expect(uploadedManifest.sessions).toHaveLength(2)
      const updated = uploadedManifest.sessions.find((s: SyncSessionMeta) => s.id === 'sess-update')
      expect(updated).toBeDefined()
      expect(updated!.name).toBe('Updated Session')
    })
  })

  describe('processQueue - when unlocked', () => {
    beforeEach(async () => {
      await unlock('test-password')
    })

    it('should process upload item from queue', async () => {
      const session: Session = {
        id: 'queued-up',
        name: 'Queued Upload',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      vi.mocked(syncQueue.getNextItem)
        .mockResolvedValueOnce({
          id: 'q-1',
          type: 'upload',
          sessionId: 'queued-up',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce(null) // stop loop

      vi.mocked(gdrive.uploadSession).mockResolvedValue()

      await processQueue()

      expect(gdrive.uploadSession).toHaveBeenCalledWith(
        testTokens.accessToken,
        'queued-up',
        expect.any(Object)
      )
      expect(syncQueue.markComplete).toHaveBeenCalledWith('q-1')
    })

    it('should skip upload when queued session no longer exists', async () => {
      vi.mocked(syncQueue.getNextItem)
        .mockResolvedValueOnce({
          id: 'q-2',
          type: 'upload',
          sessionId: 'nonexistent',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce(null)

      await processQueue()

      expect(gdrive.uploadSession).not.toHaveBeenCalled()
      expect(syncQueue.markComplete).toHaveBeenCalledWith('q-2')
    })

    it('should process delete item from queue', async () => {
      vi.mocked(syncQueue.getNextItem)
        .mockResolvedValueOnce({
          id: 'q-3',
          type: 'delete',
          sessionId: 'del-sess',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce(null)

      vi.mocked(gdrive.deleteSession).mockResolvedValue()

      await processQueue()

      expect(gdrive.deleteSession).toHaveBeenCalledWith(testTokens.accessToken, 'del-sess')
      expect(syncQueue.markComplete).toHaveBeenCalledWith('q-3')
    })

    it('should mark failed items on error', async () => {
      vi.mocked(syncQueue.getNextItem)
        .mockResolvedValueOnce({
          id: 'q-4',
          type: 'delete',
          sessionId: 'fail-sess',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce(null)

      vi.mocked(gdrive.deleteSession).mockRejectedValue(new Error('Network error'))

      await processQueue()

      expect(syncQueue.markFailed).toHaveBeenCalledWith('q-4', expect.stringContaining('Network error'))
    })

    it('should process multiple items sequentially', async () => {
      const session: Session = {
        id: 'multi-1',
        name: 'Multi Upload',
        windows: [{ tabs: [{ url: 'https://example.com', title: 'Ex' }], tabGroups: [] }],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: 'manual',
      }
      await sessionsStorage.save(session)

      vi.mocked(syncQueue.getNextItem)
        .mockResolvedValueOnce({
          id: 'q-5',
          type: 'upload',
          sessionId: 'multi-1',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce({
          id: 'q-6',
          type: 'delete',
          sessionId: 'multi-del',
          queuedAt: Date.now(),
          retryCount: 0,
          nextRetryAt: 0,
        })
        .mockResolvedValueOnce(null)

      vi.mocked(gdrive.uploadSession).mockResolvedValue()
      vi.mocked(gdrive.deleteSession).mockResolvedValue()

      await processQueue()

      expect(syncQueue.markComplete).toHaveBeenCalledTimes(2)
      expect(syncQueue.markComplete).toHaveBeenCalledWith('q-5')
      expect(syncQueue.markComplete).toHaveBeenCalledWith('q-6')
    })
  })

  describe('unlock - verification hash fallback', () => {
    it('should verify via hash when no credentials exist (correct password)', async () => {
      // Remove credentials but keep encryption key data
      const storedKeyData = await encryptionKeyStorage.get()
      expect(storedKeyData).not.toBeNull()

      // Re-derive the correct verification hash
      const key = await encryption.deriveKey('test-password', storedKeyData!.salt)
      const correctHash = await encryption.createVerificationHash(key, storedKeyData!.salt)
      await encryptionKeyStorage.save({ ...storedKeyData!, verificationHash: correctHash })

      // Remove credentials so the fallback path is used
      await chrome.storage.local.remove(CLOUD_SYNC_KEYS.CREDENTIALS)

      const result = await unlock('test-password')
      expect(result).toBe(true)
      expect(isUnlocked()).toBe(true)
    })

    it('should verify via hash when no credentials exist (wrong password)', async () => {
      const storedKeyData = await encryptionKeyStorage.get()
      expect(storedKeyData).not.toBeNull()

      // Remove credentials so the fallback path is used
      await chrome.storage.local.remove(CLOUD_SYNC_KEYS.CREDENTIALS)

      const result = await unlock('wrong-password')
      expect(result).toBe(false)
      expect(isUnlocked()).toBe(false)
    })
  })

  describe('getValidTokensForDisconnect', () => {
    it('should return tokens when unlocked', async () => {
      await unlock('test-password')

      const tokens = await getValidTokensForDisconnect()
      expect(tokens).not.toBeNull()
      expect(tokens!.accessToken).toBe(testTokens.accessToken)
    })

    it('should return null when locked', async () => {
      // Don't unlock - getTokens will throw because sync is locked
      const tokens = await getValidTokensForDisconnect()
      expect(tokens).toBeNull()
    })
  })

  describe('getEncryptionKeyForSetup', () => {
    it('should return null when locked', () => {
      expect(getEncryptionKeyForSetup()).toBeNull()
    })

    it('should return key when unlocked', async () => {
      await unlock('test-password')
      const key = getEncryptionKeyForSetup()
      expect(key).not.toBeNull()
      expect(key).toBeInstanceOf(CryptoKey)
    })
  })

  describe('setEncryptionKey', () => {
    it('should set key and mark as unlocked', async () => {
      expect(isUnlocked()).toBe(false)

      const { key } = await encryption.setupEncryption('another-password')
      setEncryptionKey(key)

      expect(isUnlocked()).toBe(true)
      expect(getEncryptionKeyForSetup()).toBe(key)
    })
  })
})
