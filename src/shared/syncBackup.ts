/**
 * Sync Backup Module
 *
 * Provides automatic backup of sessions to chrome.storage.sync.
 * This allows sessions to survive extension reinstalls and sync across devices.
 *
 * Strategy:
 * - Store sessions individually (max 8KB each)
 * - Keep a manifest tracking what's synced
 * - Prioritize most recent sessions
 * - Strip non-essential data to fit more sessions
 * - Use LZ-String compression to maximize storage capacity
 * - Auto-restore on fresh install when local storage is empty
 */

import type { Session, TabGroup } from './types'
import { SYNC_STORAGE_KEYS, SYNC_LIMITS, SYNC_CHUNK_CONFIG } from './constants'
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

/**
 * Compress an object to a UTF-16 string for storage
 */
function compressObject<T>(obj: T): string {
  const json = JSON.stringify(obj)
  return compressToUTF16(json)
}

/**
 * Decompress a UTF-16 string back to an object.
 * Falls back to parsing as raw JSON for backwards compatibility with uncompressed data.
 */
function decompressObject<T>(data: string | T): T | null {
  // If it's already an object (old uncompressed format), return as-is
  if (typeof data === 'object' && data !== null) {
    return data as T
  }

  // Try to decompress (new compressed format)
  if (typeof data === 'string') {
    const decompressed = decompressFromUTF16(data)
    if (decompressed) {
      try {
        return JSON.parse(decompressed) as T
      } catch {
        // Decompression succeeded but JSON parse failed
        return null
      }
    }

    // Decompression returned null - might be raw JSON (old format)
    try {
      return JSON.parse(data) as T
    } catch {
      return null
    }
  }

  return null
}

/**
 * Calculate byte size of a compressed string in UTF-8.
 * Chrome measures QUOTA_BYTES_PER_ITEM in UTF-8 bytes, and lz-string's
 * compressToUTF16() output is mostly U+0800+ chars (3 bytes each in UTF-8).
 */
function getCompressedByteSize(compressed: string): number {
  return new globalThis.TextEncoder().encode(compressed).length
}

/**
 * Serialization lock for sync backup operations.
 * Prevents concurrent backupSession calls from corrupting the manifest.
 */
let _syncLock: Promise<void> = Promise.resolve()

function withSyncLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _syncLock.then(fn, fn)
  _syncLock = result.then(
    () => {},
    () => {}
  )
  return result
}

/**
 * Manifest entry for a synced session
 */
interface SyncedSessionMeta {
  id: string
  name: string
  createdAt: number
  tabCount: number
  /** Approximate size in bytes */
  size: number
}

/**
 * Sync manifest stored in chrome.storage.sync
 */
interface SyncManifest {
  /** Version for future migrations */
  version: number
  /** When the manifest was last updated */
  updatedAt: number
  /** List of synced sessions (most recent first) */
  sessions: SyncedSessionMeta[]
  /** Total bytes used (approximate) */
  totalBytes: number
}

/**
 * Compressed session format for sync storage
 * Strips non-essential data to fit within 8KB limit
 */
interface CompressedSession {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  source?: string
  tags?: string[]
  windows: CompressedWindow[]
}

interface CompressedWindow {
  id: string
  tabs: CompressedTab[]
  tabGroups: TabGroup[]
  focused?: boolean
}

interface CompressedTab {
  id: string
  url: string
  title: string
  index: number
  pinned: boolean
  groupId?: string
  // Stripped: favIconUrl, discarded, lastAccessed
}

/**
 * Compress a session by removing non-essential data
 */
function compressSession(session: Session): CompressedSession {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    source: session.source,
    tags: session.tags,
    windows: session.windows.map((w) => ({
      id: w.id,
      tabs: w.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        index: t.index,
        pinned: t.pinned,
        groupId: t.groupId,
      })),
      tabGroups: w.tabGroups,
      focused: w.focused,
    })),
  }
}

/**
 * Decompress a session back to full format
 */
function decompressSession(compressed: CompressedSession): Session {
  return {
    id: compressed.id,
    name: compressed.name,
    createdAt: compressed.createdAt,
    updatedAt: compressed.updatedAt,
    source: compressed.source as Session['source'],
    tags: compressed.tags,
    windows: compressed.windows.map((w) => ({
      id: w.id,
      tabs: w.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: t.title,
        index: t.index,
        pinned: t.pinned,
        groupId: t.groupId,
      })),
      tabGroups: w.tabGroups,
      focused: w.focused,
    })),
  }
}

/**
 * Calculate approximate JSON byte size
 */
function getByteSize(obj: unknown): number {
  return new globalThis.TextEncoder().encode(JSON.stringify(obj)).length
}

/**
 * Get the sync storage key for a session
 */
function getSessionKey(sessionId: string): string {
  return `${SYNC_STORAGE_KEYS.SESSION_PREFIX}${sessionId}`
}

/**
 * Load the sync manifest
 */
async function getManifest(): Promise<SyncManifest> {
  const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.MANIFEST)
  const manifest = result[SYNC_STORAGE_KEYS.MANIFEST] as SyncManifest | undefined
  return (
    manifest ?? {
      version: 1,
      updatedAt: Date.now(),
      sessions: [],
      totalBytes: 0,
    }
  )
}

/**
 * Save the sync manifest
 */
async function saveManifest(manifest: SyncManifest): Promise<void> {
  manifest.updatedAt = Date.now()
  await chrome.storage.sync.set({ [SYNC_STORAGE_KEYS.MANIFEST]: manifest })
}

/**
 * Backup a session to sync storage
 *
 * @returns true if backed up successfully, false if couldn't fit
 */
export function backupSession(session: Session): Promise<boolean> {
  return withSyncLock(async () => {
    try {
      // First minify (strip non-essential fields), then LZ-String compress
      const minified = compressSession(session)
      const compressed = compressObject(minified)
      const sessionSize = getCompressedByteSize(compressed)

      // Check if session is too large for a single item
      if (sessionSize > SYNC_LIMITS.QUOTA_BYTES_PER_ITEM) {
        console.log(
          `[Raft Sync] Session "${session.name}" too large to sync (${sessionSize} bytes > ${SYNC_LIMITS.QUOTA_BYTES_PER_ITEM})`
        )
        return false
      }

      const manifest = await getManifest()

      // Estimate manifest size growth: adding a new meta entry (~150 bytes for typical names)
      const tabCount = session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const projectedMeta: SyncedSessionMeta = {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        tabCount,
        size: sessionSize,
      }
      const projectedManifest = {
        ...manifest,
        sessions: [projectedMeta, ...manifest.sessions.filter((s) => s.id !== session.id)],
      }
      const projectedManifestSize = getByteSize(projectedManifest)

      // Check if we need to free up space
      const maxUsable = SYNC_LIMITS.QUOTA_BYTES * SYNC_LIMITS.QUOTA_SAFETY_MARGIN
      let available = maxUsable - manifest.totalBytes - projectedManifestSize

      // Remove this session from calculations if it's already synced (we're updating)
      const existingIndex = manifest.sessions.findIndex((s) => s.id === session.id)
      if (existingIndex >= 0) {
        available += manifest.sessions[existingIndex].size
      }

      // If not enough space, remove oldest sessions until we have room
      while (available < sessionSize && manifest.sessions.length > 0) {
        // Find oldest session that isn't the one we're trying to save
        let oldestIndex = -1
        let oldestTime = Infinity

        for (let i = 0; i < manifest.sessions.length; i++) {
          if (
            manifest.sessions[i].id !== session.id &&
            manifest.sessions[i].createdAt < oldestTime
          ) {
            oldestTime = manifest.sessions[i].createdAt
            oldestIndex = i
          }
        }

        if (oldestIndex === -1) {
          // Can't remove anything else
          break
        }

        // Remove oldest session
        const removed = manifest.sessions.splice(oldestIndex, 1)[0]
        await chrome.storage.sync.remove(getSessionKey(removed.id))
        manifest.totalBytes -= removed.size
        available += removed.size
      }

      // Final check - do we have space now?
      if (available < sessionSize) {
        console.log(`[Raft Sync] Not enough sync space for "${session.name}"`)
        return false
      }

      // Save the compressed session
      const sessionKey = getSessionKey(session.id)
      await chrome.storage.sync.set({ [sessionKey]: compressed })

      // Update manifest (tabCount already computed above for projectedMeta)
      const meta: SyncedSessionMeta = {
        id: session.id,
        name: session.name,
        createdAt: session.createdAt,
        tabCount,
        size: sessionSize,
      }

      // Remove existing entry if updating
      if (existingIndex >= 0) {
        manifest.sessions.splice(existingIndex, 1)
      }

      // Add new entry at the beginning (most recent)
      manifest.sessions.unshift(meta)

      // Recalculate total bytes
      manifest.totalBytes = manifest.sessions.reduce((sum, s) => sum + s.size, 0)

      await saveManifest(manifest)

      return true
    } catch (error) {
      console.error('[Raft Sync] Backup failed:', error)
      return false
    }
  })
}

/**
 * Remove a session from sync storage
 */
export async function removeSessionFromSync(sessionId: string): Promise<void> {
  try {
    const manifest = await getManifest()
    const index = manifest.sessions.findIndex((s) => s.id === sessionId)

    if (index >= 0) {
      const removed = manifest.sessions.splice(index, 1)[0]
      manifest.totalBytes -= removed.size
      await chrome.storage.sync.remove(getSessionKey(sessionId))
      await saveManifest(manifest)
    }
  } catch (error) {
    console.error('[Raft Sync] Remove failed:', error)
  }
}

/**
 * Restore all sessions from sync storage
 *
 * @returns Array of restored sessions
 */
export async function restoreFromSync(): Promise<Session[]> {
  try {
    const manifest = await getManifest()

    if (manifest.sessions.length === 0) {
      return []
    }

    const sessions: Session[] = []
    const sessionKeys = manifest.sessions.map((s) => getSessionKey(s.id))

    const result = await chrome.storage.sync.get(sessionKeys)

    for (const meta of manifest.sessions) {
      const key = getSessionKey(meta.id)
      const stored = result[key] as string | CompressedSession | undefined

      if (stored) {
        // Decompress (handles both new compressed format and old raw format)
        const minified = decompressObject<CompressedSession>(stored)
        if (minified) {
          const session = decompressSession(minified)
          sessions.push(session)
        }
      }
    }

    console.log(`[Raft Sync] Restored ${sessions.length} sessions from sync`)
    return sessions
  } catch (error) {
    console.error('[Raft Sync] Restore failed:', error)
    return []
  }
}

/**
 * Get sync backup status with detailed storage breakdown
 */
export async function getSyncStatus(): Promise<{
  sessionCount: number
  totalBytes: number
  maxBytes: number
  percentUsed: number
  sessions: SyncedSessionMeta[]
  // Detailed breakdown
  manifestBytes: number
  sessionsBytes: number
  itemCount: number
  maxItems: number
  maxBytesPerItem: number
  compressionEnabled: boolean
  // Recovery snapshot info
  recoverySnapshot: {
    exists: boolean
    bytes: number
    timestamp: number | null
    tabCount: number | null
  }
}> {
  const manifest = await getManifest()
  const maxBytes = SYNC_LIMITS.QUOTA_BYTES
  const manifestBytes = getByteSize(manifest)
  const sessionsBytes = manifest.totalBytes

  // Get recovery snapshot info (supports both chunked and legacy formats)
  let recoverySnapshotBytes = 0
  let recoveryTimestamp: number | null = null
  let recoveryTabCount: number | null = null

  try {
    // Check for new chunked format first
    const metaResult = await chrome.storage.sync.get(SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY)
    const meta = metaResult[SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY] as
      | { chunkCount: number; timestamp: number; tabCount: number }
      | undefined

    if (meta && meta.chunkCount > 0) {
      // Chunked format - calculate size from all chunks
      const chunkKeys = Array.from(
        { length: meta.chunkCount },
        (_, i) => `${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`
      )
      const chunksResult = await chrome.storage.sync.get(chunkKeys)

      const encoder = new globalThis.TextEncoder()
      for (let i = 0; i < meta.chunkCount; i++) {
        const chunk = chunksResult[`${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`]
        if (chunk && typeof chunk === 'string') {
          recoverySnapshotBytes += encoder.encode(chunk).length
        }
      }
      recoverySnapshotBytes += getByteSize(meta) // Add metadata size
      recoveryTimestamp = meta.timestamp
      recoveryTabCount = meta.tabCount
    } else {
      // Fall back to legacy single-item format
      const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT)
      const stored = result[SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT]
      if (stored) {
        if (typeof stored === 'string') {
          recoverySnapshotBytes = new globalThis.TextEncoder().encode(stored).length
          // Try to decompress to get metadata
          const decompressed = decompressFromUTF16(stored)
          if (decompressed) {
            const parsed = JSON.parse(decompressed)
            recoveryTimestamp = parsed.timestamp ?? null
            recoveryTabCount = parsed.stats?.tabCount ?? null
          }
        } else if (typeof stored === 'object') {
          recoverySnapshotBytes = getByteSize(stored)
          recoveryTimestamp = (stored as { timestamp?: number }).timestamp ?? null
          recoveryTabCount = (stored as { stats?: { tabCount?: number } }).stats?.tabCount ?? null
        }
      }
    }
  } catch {
    // Ignore errors reading recovery snapshot
  }

  const totalBytes = manifestBytes + sessionsBytes + recoverySnapshotBytes
  const itemCount = 1 + manifest.sessions.length + (recoverySnapshotBytes > 0 ? 1 : 0)

  return {
    sessionCount: manifest.sessions.length,
    totalBytes,
    maxBytes,
    percentUsed: (totalBytes / maxBytes) * 100,
    sessions: manifest.sessions,
    // Detailed breakdown
    manifestBytes,
    sessionsBytes,
    itemCount,
    maxItems: SYNC_LIMITS.MAX_ITEMS,
    maxBytesPerItem: SYNC_LIMITS.QUOTA_BYTES_PER_ITEM,
    compressionEnabled: true,
    // Recovery snapshot info
    recoverySnapshot: {
      exists: recoverySnapshotBytes > 0,
      bytes: recoverySnapshotBytes,
      timestamp: recoveryTimestamp,
      tabCount: recoveryTabCount,
    },
  }
}

/**
 * Check if this is a fresh install with no local data but sync data available
 */
export async function shouldRestoreFromSync(localSessionCount: number): Promise<boolean> {
  if (localSessionCount > 0) {
    return false
  }

  const manifest = await getManifest()
  return manifest.sessions.length > 0
}

/**
 * Clear all sync data (for testing/debugging)
 */
export async function clearSyncData(): Promise<void> {
  const manifest = await getManifest()
  const keys = [SYNC_STORAGE_KEYS.MANIFEST, ...manifest.sessions.map((s) => getSessionKey(s.id))]
  await chrome.storage.sync.remove(keys)
}
