/**
 * Tab Suspension Service
 *
 * Handles all suspension logic including:
 * - Protection rules (pinned, audio, whitelist)
 * - Manual and auto-suspension using Chrome's native tabs.discard() API
 *
 * Uses Chrome's native tab discarding - discarded tabs preserve scroll position,
 * form data, and restore automatically when clicked.
 */

import { settingsStorage, tabActivityStorage } from '@/shared/storage'
import { PROTECTED_URL_PATTERNS } from '@/shared/constants'
import type { Settings } from '@/shared/types'

/**
 * Result of checking if a tab can be suspended
 */
export interface SuspensionCheck {
  canSuspend: boolean
  reason?: string
}

/**
 * Check if a URL is protected from suspension
 */
function isProtectedUrl(url: string): boolean {
  return PROTECTED_URL_PATTERNS.some((pattern) => url.startsWith(pattern))
}

/**
 * Escape special regex characters except asterisk (which we convert to .*)
 */
function escapeRegexExceptWildcard(str: string): string {
  return str.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

/** Maximum length for a single whitelist pattern to prevent ReDoS */
const MAX_WHITELIST_PATTERN_LENGTH = 500

/**
 * Check if a URL matches any whitelist pattern
 * Patterns support * as wildcard (matches any characters)
 */
function matchesWhitelist(url: string, whitelist: string[]): boolean {
  return whitelist.some((pattern) => {
    if (pattern.length > MAX_WHITELIST_PATTERN_LENGTH) {
      console.warn('[Raft] Whitelist pattern too long, skipping:', pattern.slice(0, 50) + '...')
      return false
    }
    const escaped = escapeRegexExceptWildcard(pattern)
    const regexPattern = '^' + escaped.replace(/\*/g, '.*') + '$'
    try {
      const regex = new RegExp(regexPattern, 'i')
      return regex.test(url)
    } catch {
      console.warn('[Raft] Invalid whitelist pattern:', pattern)
      return false
    }
  })
}

/**
 * Check if a tab can be suspended based on protection rules
 */
export async function canSuspendTab(
  tab: chrome.tabs.Tab,
  settings?: Settings
): Promise<SuspensionCheck> {
  const s = settings ?? (await settingsStorage.get())

  // No URL (new tab, etc.)
  if (!tab.url) {
    return { canSuspend: false, reason: 'No URL' }
  }

  // Already discarded
  if (tab.discarded) {
    return { canSuspend: false, reason: 'Already discarded' }
  }

  // Protected URLs (chrome://, extensions, etc.)
  if (isProtectedUrl(tab.url)) {
    return { canSuspend: false, reason: 'Protected URL' }
  }

  // Pinned tabs (if setting enabled)
  if (s.suspension.neverSuspendPinned && tab.pinned) {
    return { canSuspend: false, reason: 'Pinned tab' }
  }

  // Tabs playing audio (if setting enabled)
  if (s.suspension.neverSuspendAudio && tab.audible) {
    return { canSuspend: false, reason: 'Playing audio' }
  }

  // Whitelist check
  if (matchesWhitelist(tab.url, s.suspension.whitelist)) {
    return { canSuspend: false, reason: 'Whitelisted' }
  }

  return { canSuspend: true }
}

/**
 * Suspend a single tab using Chrome's native discard API.
 * Returns true if suspension was successful.
 */
export async function suspendTab(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId)
    const check = await canSuspendTab(tab)

    if (!check.canSuspend) {
      return false
    }

    // Use native discard API
    const discardedTab = await chrome.tabs.discard(tabId)

    if (discardedTab?.discarded) {
      return true
    }
    return false
  } catch (error) {
    console.error(`[Raft] Failed to discard tab ${tabId}:`, error)
    return false
  }
}

/**
 * Suspend all other tabs in the current window
 */
export async function suspendOtherTabs(windowId?: number): Promise<number> {
  const targetWindowId = windowId ?? (await chrome.windows.getCurrent()).id
  const tabs = await chrome.tabs.query({ windowId: targetWindowId })
  const settings = await settingsStorage.get()

  let suspended = 0
  for (const tab of tabs) {
    if (tab.id && !tab.active) {
      const check = await canSuspendTab(tab, settings)
      if (check.canSuspend) {
        const success = await suspendTab(tab.id)
        if (success) suspended++
      }
    }
  }

  return suspended
}

/**
 * Suspend all tabs across all windows (including active tabs when possible)
 */
export async function suspendAllTabs(): Promise<number> {
  const windows = await chrome.windows.getAll({ populate: true })
  const settings = await settingsStorage.get()

  let suspended = 0

  for (const win of windows) {
    if (!win.id || !win.tabs) continue

    const activeTab = win.tabs.find((t) => t.active)
    const otherTabs = win.tabs.filter((t) => !t.active)

    // First, suspend all non-active tabs
    for (const tab of otherTabs) {
      if (tab.id) {
        const check = await canSuspendTab(tab, settings)
        if (check.canSuspend) {
          const success = await suspendTab(tab.id)
          if (success) suspended++
        }
      }
    }

    // Now handle the active tab if it's suspendable
    if (activeTab?.id) {
      const check = await canSuspendTab(activeTab, settings)
      if (check.canSuspend) {
        // Find a tab to switch to (prefer already-discarded tabs)
        const switchTarget = win.tabs.find((t) => t.id !== activeTab.id && t.id !== undefined)
        if (switchTarget?.id) {
          // Activate another tab first, then suspend the previously active one
          await chrome.tabs.update(switchTarget.id, { active: true })
          const success = await suspendTab(activeTab.id)
          if (success) suspended++
        }
      }
    }
  }

  return suspended
}

/**
 * Check for tabs that should be auto-suspended based on inactivity
 */
export async function checkForInactiveTabs(): Promise<number> {
  const settings = await settingsStorage.get()

  if (!settings.suspension.enabled) {
    return 0
  }

  const inactivityMs = settings.suspension.inactivityMinutes * 60 * 1000
  const now = Date.now()
  const cutoff = now - inactivityMs

  const activity = await tabActivityStorage.getAll()
  const tabs = await chrome.tabs.query({})

  let suspended = 0
  for (const tab of tabs) {
    if (!tab.id) continue

    // Skip active tabs for auto-suspend
    if (tab.active) continue

    // Get last activity time, default to now if not tracked
    const lastActive = activity[tab.id] ?? now

    // Skip if recently active
    if (lastActive > cutoff) continue

    // Check protection rules and suspend if allowed
    const check = await canSuspendTab(tab, settings)
    if (check.canSuspend) {
      const success = await suspendTab(tab.id)
      if (success) {
        suspended++
      }
    }
  }

  return suspended
}

/**
 * Get suspension status for all tabs in a window
 */
export async function getWindowTabsStatus(
  windowId?: number
): Promise<Array<{ tab: chrome.tabs.Tab; canSuspend: boolean; reason?: string }>> {
  const targetWindowId = windowId ?? (await chrome.windows.getCurrent()).id
  const tabs = await chrome.tabs.query({ windowId: targetWindowId })
  const settings = await settingsStorage.get()

  const results = []
  for (const tab of tabs) {
    const check = await canSuspendTab(tab, settings)
    results.push({
      tab,
      canSuspend: check.canSuspend,
      reason: check.reason,
    })
  }

  return results
}

/**
 * Get counts of suspended and suspendable tabs
 */
export async function getTabCounts(): Promise<{
  total: number
  suspended: number
  suspendable: number
}> {
  const tabs = await chrome.tabs.query({})
  const settings = await settingsStorage.get()

  let suspended = 0
  let suspendable = 0

  for (const tab of tabs) {
    if (tab.discarded) {
      suspended++
    } else {
      const check = await canSuspendTab(tab, settings)
      if (check.canSuspend) {
        suspendable++
      }
    }
  }

  return {
    total: tabs.length,
    suspended,
    suspendable,
  }
}

/**
 * Restore all suspended tabs in a window by reloading them
 */
export async function restoreAllTabs(windowId?: number): Promise<number> {
  const targetWindowId = windowId ?? (await chrome.windows.getCurrent()).id
  const tabs = await chrome.tabs.query({ windowId: targetWindowId, discarded: true })

  let restored = 0
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await chrome.tabs.reload(tab.id)
        restored++
      } catch (error) {
        console.warn(`[Raft] Failed to reload tab ${tab.id}:`, error)
      }
    }
  }

  return restored
}
