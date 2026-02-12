/**
 * Tab Deduplication Service
 *
 * Finds and closes duplicate tabs across all windows.
 * Keeps the "best" tab from each group of duplicates based on priority:
 * active > non-discarded > most recently accessed.
 * Respects protection rules (pinned, audible, protected URLs).
 */

import { settingsStorage } from '@/shared/storage'
import { PROTECTED_URL_PATTERNS } from '@/shared/constants'
import { normalizeUrlForDedup } from '@/shared/utils'

export interface DuplicateResult {
  /** Total duplicate tabs found (including the one kept) */
  duplicatesFound: number
  /** Tabs actually closed */
  tabsClosed: number
  /** Tabs skipped due to protection rules */
  protected: number
}

/**
 * Check if a tab is protected from closure during dedup.
 */
async function isProtected(tab: chrome.tabs.Tab): Promise<boolean> {
  // Protected URL patterns (chrome://, etc.)
  if (tab.url && PROTECTED_URL_PATTERNS.some((pattern) => tab.url!.startsWith(pattern))) {
    return true
  }

  const settings = await settingsStorage.get()

  // Pinned tab protection
  if (tab.pinned && settings.suspension.neverSuspendPinned) {
    return true
  }

  // Audible tab protection
  if (tab.audible && settings.suspension.neverSuspendAudio) {
    return true
  }

  return false
}

/**
 * Score a tab for keep priority (higher = more likely to keep).
 */
function tabKeepScore(tab: chrome.tabs.Tab): number {
  let score = 0
  if (tab.active) score += 1000
  if (!tab.discarded) score += 100
  if (tab.lastAccessed) score += tab.lastAccessed / 1e10 // Normalize to small range
  return score
}

/**
 * Find all duplicate tab groups.
 * Returns a map of normalized URL → array of tabs with that URL.
 * Only includes groups with 2+ tabs.
 */
async function findDuplicateGroups(): Promise<Map<string, chrome.tabs.Tab[]>> {
  const allTabs = await chrome.tabs.query({})
  const groups = new Map<string, chrome.tabs.Tab[]>()

  for (const tab of allTabs) {
    if (!tab.url || !tab.id) continue

    // Skip protected URLs entirely
    if (PROTECTED_URL_PATTERNS.some((pattern) => tab.url!.startsWith(pattern))) {
      continue
    }

    const normalized = normalizeUrlForDedup(tab.url)
    const existing = groups.get(normalized)
    if (existing) {
      existing.push(tab)
    } else {
      groups.set(normalized, [tab])
    }
  }

  // Filter to only groups with duplicates
  const duplicates = new Map<string, chrome.tabs.Tab[]>()
  for (const [url, tabs] of groups) {
    if (tabs.length >= 2) {
      duplicates.set(url, tabs)
    }
  }

  return duplicates
}

/**
 * Get the count of closeable duplicate tabs.
 */
export async function getDuplicateCount(): Promise<number> {
  const groups = await findDuplicateGroups()
  let count = 0

  for (const tabs of groups.values()) {
    // For each group, we keep one and could close the rest
    // But some may be protected, so count conservatively
    count += tabs.length - 1
  }

  return count
}

/**
 * Close duplicate tabs, keeping the best tab from each group.
 */
export async function closeDuplicates(): Promise<DuplicateResult> {
  const groups = await findDuplicateGroups()
  let duplicatesFound = 0
  let tabsClosed = 0
  let protectedCount = 0

  const tabIdsToClose: number[] = []

  for (const tabs of groups.values()) {
    if (tabs.length < 2) continue
    duplicatesFound += tabs.length

    // Sort by keep priority (highest first)
    const sorted = [...tabs].sort((a, b) => tabKeepScore(b) - tabKeepScore(a))

    // Keep the first one, close the rest (respecting protection)
    for (let i = 1; i < sorted.length; i++) {
      const tab = sorted[i]
      if (!tab.id) continue

      if (await isProtected(tab)) {
        protectedCount++
        continue
      }

      tabIdsToClose.push(tab.id)
    }
  }

  // Close tabs in batch, falling back to individual on error
  if (tabIdsToClose.length > 0) {
    try {
      await chrome.tabs.remove(tabIdsToClose)
      tabsClosed = tabIdsToClose.length
    } catch {
      // Batch failed, try individually
      for (const tabId of tabIdsToClose) {
        try {
          await chrome.tabs.remove(tabId)
          tabsClosed++
        } catch {
          // Tab may have already been closed
        }
      }
    }
  }

  return { duplicatesFound, tabsClosed, protected: protectedCount }
}
