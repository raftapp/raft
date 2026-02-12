/**
 * Recovery Snapshot Service
 *
 * Provides crash recovery by periodically capturing the complete browser state.
 * Unlike the old live backup that only saved discarded tabs, this captures ALL tabs
 * to provide a true safety net for crash recovery.
 *
 * Features:
 * - Captures all tabs (not just discarded)
 * - Rotating snapshots (keeps last 5 in local storage)
 * - Mirrors most recent snapshot to sync storage (syncs across devices with same Chrome profile)
 * - Chunked sync storage supports 1,000+ tabs
 * - Debounced updates to avoid excessive writes
 * - Periodic snapshots via alarm
 *
 * Note: Browser sync storage does NOT survive extension uninstall. For persistent
 * backup, use the Cloud Sync (Pro) feature or export sessions regularly.
 */

import { storage } from '@/shared/storage'
import {
  STORAGE_KEYS,
  PROTECTED_URL_PATTERNS,
  RECOVERY_CONFIG,
  SYNC_STORAGE_KEYS,
  SYNC_CHUNK_CONFIG,
  SYNC_LIMITS,
} from '@/shared/constants'
import type { RecoverySnapshot, Window, Tab, TabGroup } from '@/shared/types'
import { nanoid } from 'nanoid'
import { compressToUTF16, decompressFromUTF16 } from 'lz-string'

/**
 * Check if a URL is protected (should not be included in snapshots)
 */
function isProtectedUrl(url: string): boolean {
  return PROTECTED_URL_PATTERNS.some((pattern) => url.startsWith(pattern))
}

/**
 * Storage helper for recovery snapshots
 */
export const recoverySnapshotsStorage = {
  /**
   * Get all recovery snapshots, sorted by timestamp (newest first)
   */
  async getAll(): Promise<RecoverySnapshot[]> {
    const snapshots = await storage.get<RecoverySnapshot[]>(STORAGE_KEYS.RECOVERY_SNAPSHOTS, [])
    return snapshots.sort((a, b) => b.timestamp - a.timestamp)
  },

  /**
   * Get a snapshot by ID
   */
  async get(id: string): Promise<RecoverySnapshot | undefined> {
    const snapshots = await this.getAll()
    return snapshots.find((s) => s.id === id)
  },

  /**
   * Save a snapshot with rotation (keeps only MAX_SNAPSHOTS)
   */
  async save(snapshot: RecoverySnapshot): Promise<void> {
    const snapshots = await this.getAll()

    // Add new snapshot at the beginning
    snapshots.unshift(snapshot)

    // Keep only the most recent MAX_SNAPSHOTS
    const trimmed = snapshots.slice(0, RECOVERY_CONFIG.MAX_SNAPSHOTS)

    await storage.set(STORAGE_KEYS.RECOVERY_SNAPSHOTS, trimmed)
  },

  /**
   * Delete a snapshot by ID
   */
  async delete(id: string): Promise<void> {
    const snapshots = await this.getAll()
    const filtered = snapshots.filter((s) => s.id !== id)
    await storage.set(STORAGE_KEYS.RECOVERY_SNAPSHOTS, filtered)
  },

  /**
   * Clear all snapshots
   */
  async clear(): Promise<void> {
    await storage.set(STORAGE_KEYS.RECOVERY_SNAPSHOTS, [])
  },
}

/**
 * Compressed snapshot format for sync storage
 * Strips favIconUrl to save space
 */
interface CompressedSnapshot {
  id: string
  timestamp: number
  windows: Array<{
    id: string
    tabs: Array<{
      id: string
      url: string
      title: string
      index: number
      pinned: boolean
      groupId?: string
    }>
    tabGroups: TabGroup[]
    focused?: boolean
    state?: string
  }>
  stats: {
    windowCount: number
    tabCount: number
    groupCount: number
  }
}

/**
 * Compress a snapshot for sync storage (strips favIconUrl, lastAccessed, discarded)
 */
function compressSnapshot(snapshot: RecoverySnapshot): CompressedSnapshot {
  return {
    id: snapshot.id,
    timestamp: snapshot.timestamp,
    windows: snapshot.windows.map((w) => ({
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
      state: w.state,
    })),
    stats: snapshot.stats,
  }
}

/**
 * Decompress a snapshot from sync storage
 */
function decompressSnapshot(compressed: CompressedSnapshot): RecoverySnapshot {
  return {
    id: compressed.id,
    timestamp: compressed.timestamp,
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
      state: w.state as Window['state'],
    })),
    stats: compressed.stats,
  }
}

/**
 * Split a string into chunks that each fit within a UTF-8 byte budget.
 * lz-string's compressToUTF16() output is mostly U+0800+ chars (3 bytes in UTF-8),
 * but Chrome measures QUOTA_BYTES_PER_ITEM in UTF-8 bytes.
 */
function splitByByteLimit(str: string, byteBudget: number): string[] {
  const chunks: string[] = []
  let chunkStart = 0

  while (chunkStart < str.length) {
    let byteCount = 0
    let i = chunkStart

    while (i < str.length) {
      const code = str.codePointAt(i)!
      let charBytes: number
      if (code <= 0x7f) charBytes = 1
      else if (code <= 0x7ff) charBytes = 2
      else if (code <= 0xffff) charBytes = 3
      else charBytes = 4

      if (byteCount + charBytes > byteBudget) break
      byteCount += charBytes
      // Surrogate pair takes 2 JS chars
      i += code > 0xffff ? 2 : 1
    }

    // Safety: ensure progress even if a single char exceeds the budget
    if (i === chunkStart) i += 1

    chunks.push(str.slice(chunkStart, i))
    chunkStart = i
  }

  return chunks
}

/**
 * Chunked sync storage helper for recovery snapshot
 *
 * Uses chunking to support snapshots larger than the 8KB per-item limit.
 * With ~20 chunks × 8KB = ~160KB budget for recovery data.
 */
export const recoverySnapshotSync = {
  /**
   * Save the most recent snapshot to sync storage using chunking
   * Returns true if saved, false if too large even with chunking
   */
  async save(snapshot: RecoverySnapshot): Promise<boolean> {
    try {
      const compressed = compressSnapshot(snapshot)
      const json = JSON.stringify(compressed)
      const lzCompressed = compressToUTF16(json)

      // Budget per chunk: QUOTA_BYTES_PER_ITEM minus overhead for key + JSON quotes
      // The stored value is JSON.stringify(chunk), adding 2 quote bytes.
      // Key bytes: "raft_recovery_" + digits ≤ 20 bytes
      const keyOverhead = 20
      const jsonQuoteOverhead = 2
      const byteBudget = SYNC_LIMITS.QUOTA_BYTES_PER_ITEM - keyOverhead - jsonQuoteOverhead

      const chunks = splitByByteLimit(lzCompressed, byteBudget)

      // Check if it fits within our chunk limit
      if (chunks.length > SYNC_CHUNK_CONFIG.MAX_CHUNKS) {
        console.log(
          `[Raft] Recovery snapshot too large even with chunking (${chunks.length} chunks needed, max ${SYNC_CHUNK_CONFIG.MAX_CHUNKS})`
        )
        return false
      }

      // First, clear any existing chunks
      await this.clear()

      // Save chunks
      const updates: Record<
        string,
        string | { chunkCount: number; timestamp: number; tabCount: number }
      > = {}

      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = `${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`
        updates[chunkKey] = chunks[i]
      }

      // Save metadata about the chunks
      updates[SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY] = {
        chunkCount: chunks.length,
        timestamp: snapshot.timestamp,
        tabCount: snapshot.stats.tabCount,
      }

      await chrome.storage.sync.set(updates)
      return true
    } catch (error) {
      console.error('[Raft] Failed to sync recovery snapshot:', error)
      return false
    }
  },

  /**
   * Get the recovery snapshot from sync storage (reassembles chunks)
   */
  async get(): Promise<RecoverySnapshot | null> {
    try {
      // First check for chunked format
      const metaResult = await chrome.storage.sync.get(SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY)
      const meta = metaResult[SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY] as
        | { chunkCount: number }
        | undefined

      if (meta && meta.chunkCount > 0) {
        // Read all chunks
        const chunkKeys = Array.from(
          { length: meta.chunkCount },
          (_, i) => `${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`
        )
        const chunksResult = await chrome.storage.sync.get(chunkKeys)

        // Reassemble the compressed string
        let lzCompressed = ''
        for (let i = 0; i < meta.chunkCount; i++) {
          const chunk = chunksResult[`${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`]
          if (!chunk) {
            console.error(`[Raft] Missing chunk ${i} in recovery snapshot`)
            return null
          }
          lzCompressed += chunk
        }

        // Decompress and parse
        const decompressed = decompressFromUTF16(lzCompressed)
        if (!decompressed) {
          console.error('[Raft] Failed to decompress recovery snapshot')
          return null
        }

        const compressed = JSON.parse(decompressed) as CompressedSnapshot
        return decompressSnapshot(compressed)
      }

      // Fall back to legacy single-item format for backwards compatibility
      const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT)
      const stored = result[SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT]

      if (!stored) {
        return null
      }

      // Handle both compressed string and legacy object format
      let compressed: CompressedSnapshot | null = null

      if (typeof stored === 'string') {
        const decompressed = decompressFromUTF16(stored)
        if (decompressed) {
          compressed = JSON.parse(decompressed)
        }
      } else if (typeof stored === 'object') {
        // Legacy uncompressed format
        compressed = stored as CompressedSnapshot
      }

      if (!compressed) {
        return null
      }

      return decompressSnapshot(compressed)
    } catch (error) {
      console.error('[Raft] Failed to get recovery snapshot from sync:', error)
      return null
    }
  },

  /**
   * Get the size of the synced recovery snapshot (sum of all chunks)
   */
  async getSize(): Promise<number> {
    try {
      // Check for chunked format first
      const metaResult = await chrome.storage.sync.get(SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY)
      const meta = metaResult[SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY] as
        | { chunkCount: number }
        | undefined

      if (meta && meta.chunkCount > 0) {
        const chunkKeys = Array.from(
          { length: meta.chunkCount },
          (_, i) => `${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`
        )
        const chunksResult = await chrome.storage.sync.get(chunkKeys)

        const encoder = new TextEncoder()
        let totalSize = 0
        for (let i = 0; i < meta.chunkCount; i++) {
          const chunk = chunksResult[`${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`]
          if (chunk && typeof chunk === 'string') {
            totalSize += encoder.encode(chunk).length
          }
        }
        // Add metadata size
        totalSize += new TextEncoder().encode(JSON.stringify(meta)).length
        return totalSize
      }

      // Fall back to legacy single-item format
      const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT)
      const stored = result[SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT]
      if (!stored) return 0
      if (typeof stored === 'string') {
        return new TextEncoder().encode(stored).length
      }
      return new TextEncoder().encode(JSON.stringify(stored)).length
    } catch {
      return 0
    }
  },

  /**
   * Get metadata about the synced recovery snapshot (without loading full data)
   */
  async getMetadata(): Promise<{ timestamp: number; tabCount: number; chunkCount: number } | null> {
    try {
      const metaResult = await chrome.storage.sync.get(SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY)
      const meta = metaResult[SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY] as
        | { chunkCount: number; timestamp: number; tabCount: number }
        | undefined

      if (meta) {
        return meta
      }

      // Fall back to legacy format - need to load and parse
      const result = await chrome.storage.sync.get(SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT)
      const stored = result[SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT]

      if (!stored) return null

      if (typeof stored === 'string') {
        const decompressed = decompressFromUTF16(stored)
        if (decompressed) {
          const parsed = JSON.parse(decompressed)
          return {
            timestamp: parsed.timestamp,
            tabCount: parsed.stats?.tabCount ?? 0,
            chunkCount: 1,
          }
        }
      } else if (typeof stored === 'object') {
        const obj = stored as { timestamp?: number; stats?: { tabCount?: number } }
        return {
          timestamp: obj.timestamp ?? 0,
          tabCount: obj.stats?.tabCount ?? 0,
          chunkCount: 1,
        }
      }

      return null
    } catch {
      return null
    }
  },

  /**
   * Clear the recovery snapshot from sync storage (both chunked and legacy formats)
   */
  async clear(): Promise<void> {
    try {
      const keysToRemove: string[] = [
        SYNC_STORAGE_KEYS.RECOVERY_SNAPSHOT, // Legacy key
        SYNC_CHUNK_CONFIG.CHUNK_COUNT_KEY, // Metadata key
      ]

      // Add all possible chunk keys (use MAX_CHUNKS to ensure we clean up everything)
      for (let i = 0; i < SYNC_CHUNK_CONFIG.MAX_CHUNKS; i++) {
        keysToRemove.push(`${SYNC_CHUNK_CONFIG.CHUNK_PREFIX}${i}`)
      }

      await chrome.storage.sync.remove(keysToRemove)
    } catch (error) {
      console.error('[Raft] Failed to clear recovery snapshot from sync:', error)
    }
  },
}

/**
 * Capture the current browser state as a recovery snapshot.
 * Captures ALL tabs (not just discarded) to provide complete crash recovery.
 */
export async function captureRecoverySnapshot(): Promise<RecoverySnapshot | null> {
  try {
    const chromeWindows = await chrome.windows.getAll({ populate: true })
    const now = Date.now()

    const windows: Window[] = []
    let totalTabs = 0
    let totalGroups = 0

    for (const win of chromeWindows) {
      if (!win.id || win.type !== 'normal') continue

      // Get tab groups for this window
      const chromeGroups = await chrome.tabGroups.query({ windowId: win.id })
      const groupIdMap = new Map<number, string>()

      const tabGroups: TabGroup[] = chromeGroups.map((group) => {
        const id = nanoid()
        groupIdMap.set(group.id, id)
        return {
          id,
          title: group.title || '',
          color: group.color as chrome.tabGroups.Color,
          collapsed: group.collapsed,
        }
      })

      totalGroups += tabGroups.length

      // Capture all tabs (not just discarded)
      const tabs: Tab[] = []
      for (const tab of win.tabs || []) {
        // Skip protected URLs (chrome://, extensions, etc.)
        if (!tab.url || isProtectedUrl(tab.url)) continue

        tabs.push({
          id: nanoid(),
          url: tab.url,
          title: tab.title || 'Untitled',
          favIconUrl: tab.favIconUrl,
          index: tab.index,
          groupId:
            tab.groupId !== undefined && tab.groupId !== -1
              ? groupIdMap.get(tab.groupId)
              : undefined,
          pinned: tab.pinned || false,
          discarded: tab.discarded,
          lastAccessed: tab.lastAccessed,
        })
      }

      if (tabs.length === 0) continue

      totalTabs += tabs.length

      windows.push({
        id: nanoid(),
        tabs,
        tabGroups,
        focused: win.focused,
        state: win.state as chrome.windows.WindowState,
      })
    }

    // Don't create empty snapshots
    if (windows.length === 0 || totalTabs === 0) {
      return null
    }

    const snapshot: RecoverySnapshot = {
      id: `recovery:${now}`,
      timestamp: now,
      windows,
      stats: {
        windowCount: windows.length,
        tabCount: totalTabs,
        groupCount: totalGroups,
      },
    }

    await recoverySnapshotsStorage.save(snapshot)

    // Also sync to sync storage (for cross-device access with same Chrome profile)
    // Note: Does NOT survive extension uninstall - use Cloud Sync (Pro) or export for that
    // This is fire-and-forget - don't block on it
    recoverySnapshotSync.save(snapshot).catch((err) => {
      console.warn('[Raft] Failed to sync recovery snapshot:', err)
    })

    return snapshot
  } catch (error) {
    console.error('[Raft] Failed to capture recovery snapshot:', error)
    return null
  }
}

/**
 * Debounce timer for snapshot updates
 */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null
let lastSnapshotTime = 0

/**
 * Debounced version of captureRecoverySnapshot.
 * Ensures minimum DEBOUNCE_MS between captures to avoid excessive writes.
 */
export function debouncedCaptureSnapshot(): void {
  const now = Date.now()
  const timeSinceLastSnapshot = now - lastSnapshotTime

  // Clear any pending timer
  if (snapshotTimer) {
    clearTimeout(snapshotTimer)
    snapshotTimer = null
  }

  // If enough time has passed, capture immediately
  if (timeSinceLastSnapshot >= RECOVERY_CONFIG.DEBOUNCE_MS) {
    lastSnapshotTime = now
    captureRecoverySnapshot()
    return
  }

  // Otherwise, schedule for later
  const delay = RECOVERY_CONFIG.DEBOUNCE_MS - timeSinceLastSnapshot
  snapshotTimer = setTimeout(() => {
    lastSnapshotTime = Date.now()
    captureRecoverySnapshot()
    snapshotTimer = null
  }, delay)
}

/**
 * Get all recovery snapshots for display
 */
export async function getRecoverySnapshots(): Promise<RecoverySnapshot[]> {
  return recoverySnapshotsStorage.getAll()
}

/**
 * Restore tabs from a recovery snapshot.
 * Creates new windows with the tabs from the snapshot.
 */
export async function restoreFromSnapshot(
  snapshotId: string
): Promise<{ windowsCreated: number; tabsCreated: number } | null> {
  const snapshot = await recoverySnapshotsStorage.get(snapshotId)
  if (!snapshot) {
    console.error('[Raft] Snapshot not found:', snapshotId)
    return null
  }

  let windowsCreated = 0
  let tabsCreated = 0

  try {
    for (const window of snapshot.windows) {
      // Get the URLs for the initial window creation
      const urls = window.tabs.map((t) => t.url)
      if (urls.length === 0) continue

      // Create window with all tabs
      const createdWindow = await chrome.windows.create({
        url: urls,
        focused: window.focused,
        state: window.state,
      })

      if (!createdWindow?.id) continue
      windowsCreated++

      // Get the created tabs to set up groups and pinned state
      const createdTabs = await chrome.tabs.query({ windowId: createdWindow.id })
      tabsCreated += createdTabs.length

      // Map our group IDs to Chrome group IDs
      const groupIdMap = new Map<string, number>()

      // Create tab groups
      for (const group of window.tabGroups) {
        // Find tabs that belong to this group
        const groupTabIndices = window.tabs
          .filter((t) => t.groupId === group.id)
          .map((t) => t.index)

        // Find the corresponding created tabs
        const groupTabIds: number[] = []
        for (const tab of createdTabs) {
          if (tab.id && groupTabIndices.includes(tab.index)) {
            groupTabIds.push(tab.id)
          }
        }

        if (groupTabIds.length > 0) {
          try {
            const chromeGroupId = await chrome.tabs.group({
              tabIds: groupTabIds as [number, ...number[]],
              createProperties: { windowId: createdWindow.id },
            })
            groupIdMap.set(group.id, chromeGroupId)

            // Update group properties
            await chrome.tabGroups.update(chromeGroupId, {
              title: group.title,
              color: group.color,
              collapsed: group.collapsed,
            })
          } catch (err) {
            console.warn('[Raft] Failed to create tab group:', err)
          }
        }
      }

      // Set pinned state for tabs
      for (const tab of window.tabs) {
        if (tab.pinned) {
          const createdTab = createdTabs.find((ct) => ct.index === tab.index)
          if (createdTab?.id) {
            try {
              await chrome.tabs.update(createdTab.id, { pinned: true })
            } catch (err) {
              console.warn('[Raft] Failed to pin tab:', err)
            }
          }
        }
      }
    }

    console.log(`[Raft] Restored from snapshot: ${tabsCreated} tabs in ${windowsCreated} windows`)
    return { windowsCreated, tabsCreated }
  } catch (error) {
    console.error('[Raft] Failed to restore from snapshot:', error)
    return null
  }
}

/**
 * Delete a recovery snapshot
 */
export async function deleteRecoverySnapshot(snapshotId: string): Promise<boolean> {
  try {
    await recoverySnapshotsStorage.delete(snapshotId)
    return true
  } catch (error) {
    console.error('[Raft] Failed to delete recovery snapshot:', error)
    return false
  }
}
