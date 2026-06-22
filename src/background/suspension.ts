/**
 * Tab Suspension Service
 *
 * Handles all suspension logic including:
 * - Protection rules (pinned, audio, whitelist, regex auto-suspend exceptions)
 * - Manual and auto-suspension using Chrome's native tabs.discard() API
 *
 * Uses Chrome's native tab discarding - discarded tabs preserve scroll position,
 * form data, and restore automatically when clicked.
 */

import { settingsStorage, tabActivityStorage } from '@/shared/storage'
import { PROTECTED_URL_PATTERNS } from '@/shared/constants'
import type { AutoSuspendRule, Settings } from '@/shared/types'
import { browser } from '@/shared/browser'

/**
 * Reason why a tab is being checked for suspension.
 * - 'auto': automatic suspension (inactivity, startup hibernation).
 * - 'manual': user-triggered suspension (popup, context menu, keyboard shortcut).
 */
export type SuspensionReason = 'auto' | 'manual'

/**
 * Options for suspendTab / suspendOtherTabs / suspendAllTabs
 */
export interface SuspendOptions {
  /** Suspension trigger context; defaults to 'manual' */
  reason?: SuspensionReason
  /** If true, auto-suspend regex exceptions are ignored (used by shortcut/context menu) */
  ignoreRegex?: boolean
}

/**
 * Options for canSuspendTab
 */
export interface CanSuspendOptions {
  /** Suspension trigger context; defaults to 'manual' */
  reason?: SuspensionReason
}

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

/** Maximum length for a single auto-suspend regex pattern to prevent ReDoS */
const MAX_AUTO_SUSPEND_REGEX_LENGTH = 500

/**
 * Check if a tab matches any auto-suspend exception rule.
 * - For URL rules, the pattern is tested case-insensitively against the full tab URL.
 * - For tab group name rules, the pattern is tested case-insensitively against the
 *   native tab group title. If the tab has no group, it cannot match.
 * Invalid or too-long patterns are ignored.
 */
async function matchesAutoSuspendRule(
  tab: browser.tabs.Tab,
  rule: AutoSuspendRule
): Promise<boolean> {
  const pattern = rule.pattern
  if (!pattern.trim()) return false
  if (pattern.length > MAX_AUTO_SUSPEND_REGEX_LENGTH) {
    console.warn('[Raft] Auto-suspend regex too long, skipping:', pattern.slice(0, 50) + '...')
    return false
  }
  try {
    const regex = new RegExp(pattern, 'i')
    if (rule.target === 'tabGroupName') {
      if (!tab.groupId || tab.groupId === -1) return false
      const groups = await browser.tabGroups.query({})
      const group = groups.find((g) => g.id === tab.groupId)
      if (!group) return false
      return regex.test(group.title ?? '')
    }
    return regex.test(tab.url ?? '')
  } catch {
    console.warn('[Raft] Invalid auto-suspend regex:', pattern)
    return false
  }
}

/**
 * Check if a tab matches any auto-suspend exception rule.
 */
async function matchesAutoSuspendRules(
  tab: browser.tabs.Tab,
  rules: AutoSuspendRule[]
): Promise<boolean> {
  for (const rule of rules) {
    if (await matchesAutoSuspendRule(tab, rule)) {
      return true
    }
  }
  return false
}

/**
 * Check if a tab can be suspended based on protection rules
 */
export async function canSuspendTab(
  tab: browser.tabs.Tab,
  settings?: Settings,
  options: CanSuspendOptions = {}
): Promise<SuspensionCheck> {
  const { reason = 'manual' } = options
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

  // Whitelist check (applies to both auto and manual)
  if (matchesWhitelist(tab.url, s.suspension.whitelist)) {
    return { canSuspend: false, reason: 'Whitelisted' }
  }

  // Auto-suspend exception rules only apply to automatic suspension.
  if (reason === 'auto' && (await matchesAutoSuspendRules(tab, s.suspension.autoSuspendRules))) {
    return { canSuspend: false, reason: 'Auto-suspend exception' }
  }

  return { canSuspend: true }
}

/**
 * Suspend a single tab using Chrome's native discard API.
 * Returns true if suspension was successful.
 */
export async function suspendTab(tabId: number, options: SuspendOptions = {}): Promise<boolean> {
  const { reason = 'manual', ignoreRegex = false } = options
  try {
    const tab = await browser.tabs.get(tabId)

    // Regex exceptions block manual suspend unless explicitly ignored.
    // Bulk actions like "Suspend All Tabs" pass ignoreRegex=false (default);
    // shortcut/context menu actions pass ignoreRegex=true.
    if (
      !ignoreRegex &&
      tab.url &&
      (await matchesAutoSuspendRules(tab, (await settingsStorage.get()).suspension.autoSuspendRules))
    ) {
      return false
    }

    const check = await canSuspendTab(tab, undefined, { reason })

    if (!check.canSuspend) {
      return false
    }

    // Use native discard API
    const discardedTab = await browser.tabs.discard(tabId)

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
export async function suspendOtherTabs(
  windowId?: number,
  options: SuspendOptions = {}
): Promise<number> {
  const { reason = 'manual', ignoreRegex = false } = options
  const targetWindowId = windowId ?? (await browser.windows.getCurrent()).id
  const tabs = await browser.tabs.query({ windowId: targetWindowId })
  const settings = await settingsStorage.get()

  let suspended = 0
  for (const tab of tabs) {
    if (tab.id && !tab.active) {
      const check = await canSuspendTab(tab, settings, { reason })
      if (check.canSuspend) {
        const success = await suspendTab(tab.id, { reason, ignoreRegex })
        if (success) suspended++
      }
    }
  }

  return suspended
}

/**
 * Suspend all non-active tabs across all windows.
 * Active tabs are skipped because browser.tabs.discard() cannot discard the active tab.
 * For startup hibernation (which needs to suspend active tabs too), the onStartup
 * handler opens a Raft page as the active tab first, then uses suspendOtherTabs().
 */
export async function suspendAllTabs(options: SuspendOptions = {}): Promise<number> {
  const { reason = 'manual', ignoreRegex = false } = options
  const windows = await browser.windows.getAll({ populate: true })
  const settings = await settingsStorage.get()
  let suspended = 0

  for (const win of windows) {
    if (!win.id || !win.tabs) continue
    for (const tab of win.tabs) {
      if (tab.id && !tab.active) {
        const check = await canSuspendTab(tab, settings, { reason })
        if (check.canSuspend) {
          const success = await suspendTab(tab.id, { reason, ignoreRegex })
          if (success) suspended++
        }
      }
    }
  }

  console.log(`[Raft] Suspended ${suspended} tabs across all windows`)
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
  const tabs = await browser.tabs.query({})

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
    const check = await canSuspendTab(tab, settings, { reason: 'auto' })
    if (check.canSuspend) {
      const success = await suspendTab(tab.id, { reason: 'auto' })
      if (success) {
        suspended++
      }
    }
  }

  return suspended
}

/**
 * Find currently open tabs matching any of the given auto-suspend rules.
 * Used by the settings UI to preview matching tabs.
 *
 * For URL rules, individual tabs are returned. For tab group name rules,
 * every tab belonging to a group whose title matches the rule is returned.
 */
export async function findMatchingTabs(
  rules: AutoSuspendRule[]
): Promise<
  Array<{ id: number; title?: string; url: string; windowId?: number; groupName?: string }>
> {
  if (!rules.some((r) => r.pattern.trim())) {
    return []
  }

  const tabs = await browser.tabs.query({})
  const groups = await browser.tabGroups.query({})
  const groupById = new Map(groups.map((g) => [g.id, g]))

  const matchingIds = new Set<number>()
  const groupNames = new Map<number, string>()

  for (const rule of rules) {
    if (!rule.pattern.trim()) continue
    try {
      const regex = new RegExp(rule.pattern, 'i')
      if (rule.target === 'tabGroupName') {
        for (const group of groups) {
          if (regex.test(group.title ?? '')) {
            for (const tab of tabs) {
              if (tab.groupId === group.id && tab.id !== undefined) {
                matchingIds.add(tab.id)
                groupNames.set(tab.id, group.title ?? '')
              }
            }
          }
        }
      } else {
        for (const tab of tabs) {
          if (tab.id !== undefined && regex.test(tab.url ?? '')) {
            matchingIds.add(tab.id)
          }
        }
      }
    } catch {
      // Ignore invalid patterns
    }
  }

  return tabs
    .filter((tab) => tab.id !== undefined && matchingIds.has(tab.id))
    .map((tab) => {
      const group = tab.groupId !== undefined ? groupById.get(tab.groupId) : undefined
      return {
        id: tab.id ?? 0,
        title: tab.title,
        url: tab.url ?? '',
        windowId: tab.windowId,
        groupName: groupNames.get(tab.id ?? 0) ?? group?.title,
      }
    })
}

/**
 * Get suspension status for all tabs in a window
 */
export async function getWindowTabsStatus(
  windowId?: number
): Promise<Array<{ tab: browser.tabs.Tab; canSuspend: boolean; reason?: string }>> {
  const targetWindowId = windowId ?? (await browser.windows.getCurrent()).id
  const tabs = await browser.tabs.query({ windowId: targetWindowId })
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
  const tabs = await browser.tabs.query({})
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
  const targetWindowId = windowId ?? (await browser.windows.getCurrent()).id
  const tabs = await browser.tabs.query({ windowId: targetWindowId, discarded: true })

  let restored = 0
  for (const tab of tabs) {
    if (tab.id) {
      try {
        await browser.tabs.reload(tab.id)
        restored++
      } catch (error) {
        console.warn(`[Raft] Failed to reload tab ${tab.id}:`, error)
      }
    }
  }

  return restored
}
