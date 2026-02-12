/**
 * Sync engine - orchestrates cloud synchronization
 *
 * Handles:
 * - Full sync (push all local changes, pull all remote changes)
 * - Incremental sync (process queue items one at a time)
 * - Conflict resolution (last-write-wins with tombstones)
 */

import type {
  CloudTokens,
  CloudSessionData,
  EncryptedPayload,
  SyncResult,
  SyncSessionMeta,
} from './types'
import {
  cloudCredentialsStorage,
  encryptionKeyStorage,
  syncStateStorage,
  deviceIdStorage,
  cloudSyncSettingsStorage,
} from './storage'
import {
  deriveKey,
  encryptObject,
  decryptObject,
  computeChecksum,
  decrypt,
  createVerificationHash,
} from './encryption'
import { getValidTokens } from './oauth'
import * as gdrive from './providers/gdrive'
import * as syncQueue from './syncQueue'
import { sessionsStorage } from '../storage'
import { TOMBSTONE_RETENTION_MS, CLOUD_SYNC_KEYS } from '../constants'

/** Cached encryption key (in memory only, cleared on service worker termination) */
let cachedEncryptionKey: CryptoKey | null = null

/** Cached decrypted tokens (in memory only) */
let cachedTokens: CloudTokens | null = null

/** Token refresh mutex to prevent concurrent refreshes */
let _tokenRefreshLock: Promise<void> = Promise.resolve()

function withTokenRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _tokenRefreshLock.then(fn, fn)
  _tokenRefreshLock = result.then(
    () => {},
    () => {}
  )
  return result
}

/** Manifest read-modify-write mutex to prevent interleaved updates */
let _manifestLock: Promise<void> = Promise.resolve()

function withManifestLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _manifestLock.then(fn, fn)
  _manifestLock = result.then(
    () => {},
    () => {}
  )
  return result
}

/** Save the set of cloud-synced session IDs to local storage */
async function saveSyncedIds(ids: string[]): Promise<void> {
  await chrome.storage.local.set({ [CLOUD_SYNC_KEYS.SYNCED_IDS]: ids })
}

/** Add a session ID to the cached cloud-synced set */
async function addSyncedId(id: string): Promise<void> {
  const result = await chrome.storage.local.get(CLOUD_SYNC_KEYS.SYNCED_IDS)
  const ids = (result[CLOUD_SYNC_KEYS.SYNCED_IDS] as string[] | undefined) ?? []
  if (!ids.includes(id)) {
    ids.push(id)
    await saveSyncedIds(ids)
  }
}

/** Remove a session ID from the cached cloud-synced set */
async function removeSyncedId(id: string): Promise<void> {
  const result = await chrome.storage.local.get(CLOUD_SYNC_KEYS.SYNCED_IDS)
  const ids = (result[CLOUD_SYNC_KEYS.SYNCED_IDS] as string[] | undefined) ?? []
  const filtered = ids.filter((i) => i !== id)
  await saveSyncedIds(filtered)
}

/**
 * Check if cloud sync is configured and ready
 */
export async function isConfigured(): Promise<boolean> {
  const credentials = await cloudCredentialsStorage.get()
  const keyData = await encryptionKeyStorage.get()
  return credentials !== null && keyData !== null
}

/**
 * Check if sync is enabled in settings
 */
export async function isEnabled(): Promise<boolean> {
  const settings = await cloudSyncSettingsStorage.get()
  return settings.enabled
}

/**
 * Set the encryption password (unlocks sync)
 * Returns true if password is correct
 */
export async function unlock(password: string): Promise<boolean> {
  const keyData = await encryptionKeyStorage.get()
  if (!keyData) {
    return false
  }

  try {
    const key = await deriveKey(password, keyData.salt)

    // Verify password correctness
    const credentials = await cloudCredentialsStorage.get()
    if (credentials) {
      // Primary: try to decrypt stored tokens
      const payload = JSON.parse(credentials.encryptedTokens) as EncryptedPayload
      await decrypt(payload, key)
    } else {
      // Fallback (e.g. reconnect after reinstall): check verification hash
      const hash = await createVerificationHash(key, keyData.salt)
      if (hash !== keyData.verificationHash) {
        return false
      }
    }

    cachedEncryptionKey = key

    // Migrate verification hash to deterministic format if needed
    const currentHash = await createVerificationHash(key, keyData.salt)
    if (currentHash !== keyData.verificationHash) {
      await encryptionKeyStorage.save({ ...keyData, verificationHash: currentHash })
    }

    return true
  } catch {
    return false
  }
}

/**
 * Lock sync (clear cached key)
 */
export function lock(): void {
  cachedEncryptionKey = null
  cachedTokens = null
}

/**
 * Check if sync is unlocked
 */
export function isUnlocked(): boolean {
  return cachedEncryptionKey !== null
}

/**
 * Get the encryption key (must be unlocked first)
 */
function getEncryptionKey(): CryptoKey {
  if (!cachedEncryptionKey) {
    throw new Error('Sync is locked. Please enter your password.')
  }
  return cachedEncryptionKey
}

/**
 * Get the encryption key for setup purposes (e.g., saving new tokens after unlock)
 * Returns null if not unlocked.
 */
export function getEncryptionKeyForSetup(): CryptoKey | null {
  return cachedEncryptionKey
}

/**
 * Set the encryption key directly (used by recovery flow after deriving a new key)
 */
export function setEncryptionKey(key: CryptoKey): void {
  cachedEncryptionKey = key
  cachedTokens = null
}

/**
 * Get valid OAuth tokens (refreshes if needed)
 * Uses a mutex to prevent concurrent refresh attempts from invalidating tokens
 */
async function getTokens(): Promise<CloudTokens> {
  return withTokenRefreshLock(async () => {
    const credentials = await cloudCredentialsStorage.get()
    if (!credentials) {
      throw new Error('Not connected to cloud storage')
    }

    // Decrypt tokens
    if (!cachedTokens) {
      const key = getEncryptionKey()
      const payload = JSON.parse(credentials.encryptedTokens) as EncryptedPayload
      cachedTokens = await decryptObject<CloudTokens>(payload, key)
    }

    // Refresh if needed
    const validTokens = await getValidTokens(cachedTokens)

    if (validTokens !== cachedTokens) {
      // Tokens were refreshed, save them
      cachedTokens = validTokens
      const key = getEncryptionKey()
      const encrypted = await encryptObject(validTokens, key)
      await cloudCredentialsStorage.save({
        ...credentials,
        encryptedTokens: JSON.stringify(encrypted),
      })
    }

    return validTokens
  })
}

/**
 * Get valid tokens for the disconnect flow (revoke + optional cloud data deletion).
 * Returns null if tokens cannot be obtained.
 */
export async function getValidTokensForDisconnect(): Promise<CloudTokens | null> {
  try {
    return await getTokens()
  } catch {
    return null
  }
}

/**
 * Perform a full sync (push + pull)
 */
export async function performFullSync(): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    uploaded: 0,
    downloaded: 0,
    deleted: 0,
    errors: [],
  }

  await syncStateStorage.update({ syncing: true, currentOperation: 'Starting sync...' })

  try {
    await withManifestLock(async () => {
      const tokens = await getTokens()
      const key = getEncryptionKey()
      const deviceId = await deviceIdStorage.get()

      // 1. Download remote manifest
      await syncStateStorage.update({ currentOperation: 'Fetching remote state...' })
      let remoteManifest = await gdrive.downloadManifest(tokens.accessToken)

      // 2. Get local sessions
      const localSessions = await sessionsStorage.getAll()
      const localSessionMap = new Map(localSessions.map((s) => [s.id, s]))

      // 3. Create new manifest if none exists
      if (!remoteManifest) {
        remoteManifest = {
          version: 1,
          lastSync: Date.now(),
          deviceId,
          sessions: [],
          tombstones: [],
        }
      }

      // Clean up old tombstones
      const tombstoneCutoff = Date.now() - TOMBSTONE_RETENTION_MS
      remoteManifest.tombstones = remoteManifest.tombstones.filter(
        (t) => t.deletedAt > tombstoneCutoff
      )

      const remoteSessionMap = new Map(remoteManifest.sessions.map((s) => [s.id, s]))
      const tombstoneSet = new Set(remoteManifest.tombstones.map((t) => t.id))

      // 4. Push local changes
      await syncStateStorage.update({ currentOperation: 'Uploading sessions...' })

      for (const session of localSessions) {
        // Skip if session was deleted remotely
        if (tombstoneSet.has(session.id)) {
          // Delete locally to honor remote deletion
          await sessionsStorage.delete(session.id)
          result.deleted++
          continue
        }

        const remoteMeta = remoteSessionMap.get(session.id)

        // Upload if:
        // - Session doesn't exist remotely
        // - Local version is newer
        const shouldUpload = !remoteMeta || session.updatedAt > remoteMeta.updatedAt

        if (shouldUpload) {
          try {
            const sessionData: CloudSessionData = {
              session,
              deviceId,
              timestamp: Date.now(),
            }
            const serializedData = JSON.stringify(sessionData)
            const encrypted = await encryptObject(sessionData, key)
            await gdrive.uploadSession(tokens.accessToken, session.id, encrypted)

            // Update manifest
            const meta: SyncSessionMeta = {
              id: session.id,
              name: session.name,
              updatedAt: session.updatedAt,
              tabCount: session.windows.reduce((sum, w) => sum + w.tabs.length, 0),
              checksum: await computeChecksum(serializedData),
            }
            remoteSessionMap.set(session.id, meta)
            result.uploaded++
          } catch (error) {
            result.errors.push(`Failed to upload ${session.name}: ${error}`)
          }
        }
      }

      // 5. Pull remote changes
      await syncStateStorage.update({ currentOperation: 'Downloading sessions...' })

      for (const [sessionId, remoteMeta] of remoteSessionMap) {
        // Skip if we already have this version
        const localSession = localSessionMap.get(sessionId)
        if (localSession && localSession.updatedAt >= remoteMeta.updatedAt) {
          continue
        }

        // Download and decrypt
        try {
          const encrypted = await gdrive.downloadSession(tokens.accessToken, sessionId)
          if (!encrypted) continue

          const sessionData = await decryptObject<CloudSessionData>(encrypted, key)
          await sessionsStorage.save(sessionData.session)
          result.downloaded++
        } catch (error) {
          result.errors.push(`Failed to download ${remoteMeta.name}: ${error}`)
        }
      }

      // 6. Handle local deletions (sessions previously synced to this device but no longer local)
      const syncedIdsResult = await chrome.storage.local.get(CLOUD_SYNC_KEYS.SYNCED_IDS)
      const previouslySyncedIds = new Set(
        (syncedIdsResult[CLOUD_SYNC_KEYS.SYNCED_IDS] as string[] | undefined) ?? []
      )
      const localIds = new Set(localSessions.map((s) => s.id))

      for (const [sessionId] of remoteSessionMap) {
        if (
          previouslySyncedIds.has(sessionId) &&
          !localIds.has(sessionId) &&
          !tombstoneSet.has(sessionId)
        ) {
          // Session was previously synced to this device but deleted locally
          try {
            await gdrive.deleteSession(tokens.accessToken, sessionId)
            remoteManifest.tombstones.push({ id: sessionId, deletedAt: Date.now() })
            remoteSessionMap.delete(sessionId)
            result.deleted++
          } catch (error) {
            result.errors.push(`Failed to delete session ${sessionId}: ${error}`)
          }
        }
      }

      // 7. Final manifest save (ensure lastSync timestamp is up-to-date)
      remoteManifest.sessions = Array.from(remoteSessionMap.values())
      remoteManifest.lastSync = Date.now()
      remoteManifest.deviceId = deviceId
      await gdrive.uploadManifest(tokens.accessToken, remoteManifest)

      // 8. Cache cloud-synced session IDs locally for UI badges
      await saveSyncedIds(remoteManifest.sessions.map((s) => s.id))
    })

    // 8. Process any pending queue items
    await processQueue()

    await syncStateStorage.update({
      syncing: false,
      lastSyncAt: Date.now(),
      lastError: result.errors.length > 0 ? result.errors[0] : undefined,
      currentOperation: undefined,
    })

    result.success = result.errors.length === 0
  } catch (error) {
    result.success = false
    // Use the error message directly (DriveApiError already has user-friendly messages)
    const errorMessage = error instanceof Error ? error.message : String(error)
    result.errors.push(errorMessage)
    await syncStateStorage.update({
      syncing: false,
      lastError: errorMessage,
      currentOperation: undefined,
    })
  }

  return result
}

/**
 * Push a single session to cloud (for immediate sync after save)
 */
export async function pushSession(sessionId: string): Promise<void> {
  if (!(await isConfigured()) || !isUnlocked()) {
    // Queue for later
    await syncQueue.enqueueUpload(sessionId)
    return
  }

  try {
    await withManifestLock(async () => {
      const tokens = await getTokens()
      const key = getEncryptionKey()
      const deviceId = await deviceIdStorage.get()

      const session = await sessionsStorage.get(sessionId)
      if (!session) {
        return
      }

      const sessionData: CloudSessionData = {
        session,
        deviceId,
        timestamp: Date.now(),
      }

      const serializedData = JSON.stringify(sessionData)
      const encrypted = await encryptObject(sessionData, key)
      await gdrive.uploadSession(tokens.accessToken, sessionId, encrypted)

      // Update manifest
      const manifest = await gdrive.downloadManifest(tokens.accessToken)
      if (manifest) {
        const meta: SyncSessionMeta = {
          id: session.id,
          name: session.name,
          updatedAt: session.updatedAt,
          tabCount: session.windows.reduce((sum, w) => sum + w.tabs.length, 0),
          checksum: await computeChecksum(serializedData),
        }

        const index = manifest.sessions.findIndex((s) => s.id === sessionId)
        if (index >= 0) {
          manifest.sessions[index] = meta
        } else {
          manifest.sessions.push(meta)
        }

        manifest.lastSync = Date.now()
        manifest.deviceId = deviceId
        await gdrive.uploadManifest(tokens.accessToken, manifest)
      }

      // Cache the synced ID locally for UI badges
      await addSyncedId(sessionId)
    })
  } catch (error) {
    console.error('[Raft Sync] Failed to push session:', error)
    await syncQueue.enqueueUpload(sessionId)
  }
}

/**
 * Delete a session from cloud
 */
export async function deleteSessionFromCloud(sessionId: string): Promise<void> {
  if (!(await isConfigured()) || !isUnlocked()) {
    await syncQueue.enqueueDelete(sessionId)
    return
  }

  try {
    await withManifestLock(async () => {
      const tokens = await getTokens()
      const deviceId = await deviceIdStorage.get()

      await gdrive.deleteSession(tokens.accessToken, sessionId)

      // Update manifest with tombstone
      const manifest = await gdrive.downloadManifest(tokens.accessToken)
      if (manifest) {
        manifest.sessions = manifest.sessions.filter((s) => s.id !== sessionId)
        manifest.tombstones.push({
          id: sessionId,
          deletedAt: Date.now(),
        })
        manifest.lastSync = Date.now()
        manifest.deviceId = deviceId
        await gdrive.uploadManifest(tokens.accessToken, manifest)
      }

      // Remove the synced ID from local cache
      await removeSyncedId(sessionId)
    })
  } catch (error) {
    console.error('[Raft Sync] Failed to delete session from cloud:', error)
    await syncQueue.enqueueDelete(sessionId)
  }
}

/**
 * Process pending queue items
 */
export async function processQueue(): Promise<void> {
  if (!(await isConfigured()) || !isUnlocked()) {
    return
  }

  let item = await syncQueue.getNextItem()

  while (item) {
    try {
      if (item.type === 'upload') {
        const session = await sessionsStorage.get(item.sessionId)
        if (session) {
          const tokens = await getTokens()
          const key = getEncryptionKey()
          const deviceId = await deviceIdStorage.get()

          const sessionData: CloudSessionData = {
            session,
            deviceId,
            timestamp: Date.now(),
          }

          const encrypted = await encryptObject(sessionData, key)
          await gdrive.uploadSession(tokens.accessToken, item.sessionId, encrypted)
        }
      } else if (item.type === 'delete') {
        const tokens = await getTokens()
        await gdrive.deleteSession(tokens.accessToken, item.sessionId)
      }

      await syncQueue.markComplete(item.id)
    } catch (error) {
      await syncQueue.markFailed(item.id, String(error))
    }

    item = await syncQueue.getNextItem()
  }
}

/**
 * Get current sync status for UI display
 */
export async function getSyncStatus(): Promise<{
  configured: boolean
  enabled: boolean
  unlocked: boolean
  syncing: boolean
  lastSyncAt?: number
  lastError?: string
  pendingCount: number
  email?: string
}> {
  const configured = await isConfigured()
  const enabled = await isEnabled()
  const state = await syncStateStorage.get()
  const credentials = await cloudCredentialsStorage.get()

  return {
    configured,
    enabled,
    unlocked: isUnlocked(),
    syncing: state.syncing,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError,
    pendingCount: state.pendingCount,
    email: credentials?.email,
  }
}
