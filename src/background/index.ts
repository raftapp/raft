/**
 * Raft Background Service Worker
 *
 * MV3 service workers are terminated after ~30 seconds of inactivity.
 * This means:
 * - No persistent in-memory state
 * - Everything must be stored in chrome.storage
 * - Re-register alarms and listeners on every wake
 */

import { settingsStorage, tabActivityStorage, sessionsStorage, storage } from '@/shared/storage'
import {
  ALARM_NAMES,
  SUSPENSION_CHECK_INTERVAL_MINUTES,
  STORAGE_KEYS,
  CLOUD_SYNC_KEYS,
  DEV_TEST_WINDOWS_KEY,
  RECOVERY_CONFIG,
  EXPORT_REMINDER_CONFIG,
} from '@/shared/constants'
import {
  shouldRestoreFromSync,
  restoreFromSync,
  backupSession,
  getSyncStatus,
  clearSyncData,
} from '@/shared/syncBackup'
import {
  syncEngine,
  gdrive,
  cloudSyncSettingsStorage,
  cloudCredentialsStorage,
  encryptionKeyStorage,
  clearAllCloudSyncData,
  launchGoogleOAuth,
  setupEncryption,
  encryptObject,
  decryptObject,
  revokeAccess,
  deriveKey,
  deriveKeyFromRecovery,
  generateRecoveryKey,
  generateSalt,
  createVerificationHash,
} from '@/shared/cloudSync'
import type { CloudTokens, EncryptedPayload } from '@/shared/cloudSync'
import {
  checkLicense,
  openCheckoutPage,
  canUseCloudSync,
  activateLicense,
  getStoredLicense,
  clearLicense,
  isProUser,
} from '@/shared/licensing'
import {
  checkForInactiveTabs,
  suspendTab,
  suspendOtherTabs,
  suspendAllTabs,
  restoreAllTabs,
  getTabCounts,
  canSuspendTab,
} from './suspension'
import {
  captureRecoverySnapshot,
  debouncedCaptureSnapshot,
  getRecoverySnapshots,
  restoreFromSnapshot,
  deleteRecoverySnapshot,
  recoverySnapshotSync,
  recoverySnapshotsStorage,
} from './recovery'
import { computeBackupHealth } from '@/shared/backupHealth'
import {
  captureCurrentSession,
  captureWindow,
  restoreSession,
  restoreSessionPartial,
  saveSession,
  deleteSession,
  renameSession,
  getAllSessions,
  searchSessions,
  performAutoSave,
  getSessionStats,
} from './sessions'
import { getDuplicateCount, closeDuplicates } from './deduplication'

// ============================================================================
// State Tracking (persisted to survive service worker termination)
// ============================================================================

// Track previously active tab per window (for activity-on-leave tracking)
// When user switches away from a tab, we touch it to record the departure time
// NOTE: This is persisted to chrome.storage to survive service worker restarts
let previousActiveTab: Map<number, number> = new Map() // windowId → tabId

// Initialization promise - listeners wait on this before accessing state
let initReady: Promise<void>
let resolveInit: () => void
initReady = new Promise((resolve) => {
  resolveInit = resolve
})

/**
 * Load previousActiveTab from storage (call on init)
 */
async function loadPreviousActiveTabs(): Promise<void> {
  const stored = await storage.get<Record<string, number>>(STORAGE_KEYS.PREVIOUS_ACTIVE_TABS, {})
  previousActiveTab = new Map(
    Object.entries(stored).map(([windowId, tabId]) => [parseInt(windowId, 10), tabId])
  )
}

/**
 * Save previousActiveTab to storage (call on changes)
 */
async function savePreviousActiveTabs(): Promise<void> {
  const obj: Record<string, number> = {}
  for (const [windowId, tabId] of previousActiveTab) {
    obj[String(windowId)] = tabId
  }
  await storage.set(STORAGE_KEYS.PREVIOUS_ACTIVE_TABS, obj)
}

// ============================================================================
// Message Types
// ============================================================================

import type { MessageResponse, Settings } from '@/shared/types'

export type MessageType =
  | { type: 'SUSPEND_TAB'; tabId: number }
  | { type: 'SUSPEND_OTHER_TABS'; windowId?: number }
  | { type: 'SUSPEND_ALL_TABS' }
  | { type: 'RESTORE_ALL_TABS'; windowId?: number }
  | { type: 'GET_TAB_COUNTS' }
  | { type: 'GET_CURRENT_TAB_STATUS' }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<Settings> }
  // Session messages
  | { type: 'SAVE_SESSION'; name?: string }
  | { type: 'SAVE_WINDOW'; windowId: number; name?: string }
  | { type: 'RESTORE_SESSION'; sessionId: string; asSuspended?: boolean }
  | { type: 'GET_SESSIONS' }
  | { type: 'DELETE_SESSION'; sessionId: string }
  | { type: 'SEARCH_SESSIONS'; query: string }
  // Cloud sync messages
  | { type: 'CLOUD_CONNECT' }
  | { type: 'CLOUD_DISCONNECT'; deleteCloudData?: boolean }
  | { type: 'CLOUD_SETUP_ENCRYPTION'; password: string; tokens?: CloudTokens; email?: string }
  | { type: 'CLOUD_UNLOCK'; password: string; tokens?: CloudTokens; email?: string }
  | { type: 'CLOUD_REGENERATE_RECOVERY_KEY'; password: string }
  | { type: 'CLOUD_RECOVER_WITH_KEY'; recoveryKey: string; newPassword: string }
  | { type: 'CLOUD_LOCK' }
  | { type: 'CLOUD_SYNC' }
  | { type: 'CLOUD_GET_STATUS' }
  | { type: 'CLOUD_GET_SETTINGS' }
  | {
      type: 'CLOUD_UPDATE_SETTINGS'
      settings: Partial<import('@/shared/cloudSync').CloudSyncSettings>
    }
  | { type: 'CLOUD_GET_SYNCED_IDS' }
  // Pro licensing messages
  | { type: 'PRO_CHECK_STATUS' }
  | { type: 'PRO_OPEN_CHECKOUT' }
  | { type: 'PRO_ACTIVATE_LICENSE'; licenseKey: string }
  | { type: 'PRO_GET_LICENSE' }
  | { type: 'PRO_CLEAR_LICENSE' }
  // Browser sync status
  | { type: 'GET_SYNC_STATUS' }
  | { type: 'RESTORE_FROM_SYNC' }
  | { type: 'CLEAR_SYNC_DATA' }
  // Recovery snapshot messages
  | { type: 'GET_RECOVERY_SNAPSHOTS' }
  | { type: 'RESTORE_RECOVERY_SNAPSHOT'; snapshotId: string }
  | { type: 'DELETE_RECOVERY_SNAPSHOT'; snapshotId: string }
  // Export reminder messages
  | { type: 'GET_EXPORT_REMINDER_STATE' }
  | { type: 'DISMISS_EXPORT_REMINDER' }
  | { type: 'MARK_EXPORT_COMPLETE' }
  // Session rename
  | { type: 'RENAME_SESSION'; sessionId: string; name: string }
  // Tab deduplication messages
  | { type: 'GET_DUPLICATE_COUNT' }
  | { type: 'CLOSE_DUPLICATES' }
  // Partial session restore
  | {
      type: 'RESTORE_SESSION_PARTIAL'
      sessionId: string
      asSuspended?: boolean
      selection: import('@/shared/types').PartialRestoreSelection
    }
  // Backup health
  | { type: 'GET_BACKUP_HEALTH' }
  // Dev tools messages (dev mode only)
  | { type: 'DEV_CREATE_SCENARIO'; scenario: import('@/devtools/types').DevScenario }
  | { type: 'DEV_CLEANUP_TEST_WINDOWS' }
  | { type: 'DEV_GET_TEST_WINDOW_IDS' }

// Re-export for backwards compatibility
export type { MessageResponse }

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize tab activity tracking for all existing tabs
 * Only touches tabs that aren't already being tracked
 */
async function initializeTabActivity(): Promise<void> {
  const tabs = await chrome.tabs.query({})
  const activity = await tabActivityStorage.getAll()

  let initialized = 0
  for (const tab of tabs) {
    if (tab.id && activity[tab.id] === undefined) {
      await tabActivityStorage.touch(tab.id)
      initialized++
    }
  }

  if (initialized > 0) {
    console.log(`[Raft] Initialized activity tracking for ${initialized} existing tabs`)
  }
}

/**
 * Initialize the service worker
 * Called on install, update, and every wake from termination
 */
async function initialize(): Promise<void> {
  // Load settings (ensures defaults are set on first run)
  const settings = await settingsStorage.get()

  // Initialize activity tracking for any untracked tabs
  await initializeTabActivity()

  // Load previousActiveTab from storage (persisted across service worker restarts)
  await loadPreviousActiveTabs()

  // Populate initial active tabs per window (for activity-on-leave tracking)
  // This handles service worker restart after termination
  const windows = await chrome.windows.getAll({ populate: true })
  let needsSave = false
  for (const window of windows) {
    if (window.id !== undefined && window.tabs) {
      const activeTab = window.tabs.find((t) => t.active)
      if (activeTab?.id && !previousActiveTab.has(window.id)) {
        previousActiveTab.set(window.id, activeTab.id)
        needsSave = true
      }
    }
  }
  if (needsSave) {
    await savePreviousActiveTabs()
  }

  // Set up alarms for suspension checking
  if (settings.suspension.enabled) {
    await setupSuspensionAlarm()
  }

  // Set up auto-save alarm if enabled
  if (settings.autoSave.enabled) {
    await setupAutoSaveAlarm(settings.autoSave.intervalMinutes)
  }

  // Set up cloud sync alarm if enabled
  const cloudSyncSettings = await cloudSyncSettingsStorage.get()
  if (cloudSyncSettings.enabled && (await syncEngine.isConfigured())) {
    await setupCloudSyncAlarm(cloudSyncSettings.intervalMinutes)
  }

  // Set up recovery snapshot alarm (always enabled)
  await setupRecoverySnapshotAlarm()

  // Set up export reminder alarm if enabled
  if (settings.exportReminder.enabled) {
    await setupExportReminderAlarm()
  }

  // Set up context menus
  await setupContextMenus()

  // Update badge with current counts
  await updateBadge()

  resolveInit()
}

/**
 * Set up the suspension check alarm
 */
async function setupSuspensionAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.SUSPENSION_CHECK)
  await chrome.alarms.create(ALARM_NAMES.SUSPENSION_CHECK, {
    periodInMinutes: SUSPENSION_CHECK_INTERVAL_MINUTES,
  })
}

/**
 * Set up the auto-save alarm
 */
async function setupAutoSaveAlarm(intervalMinutes: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.AUTO_SAVE)
  await chrome.alarms.create(ALARM_NAMES.AUTO_SAVE, {
    periodInMinutes: intervalMinutes,
  })
}

/**
 * Set up the cloud sync alarm
 */
async function setupCloudSyncAlarm(intervalMinutes: number): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.CLOUD_SYNC)
  await chrome.alarms.create(ALARM_NAMES.CLOUD_SYNC, {
    periodInMinutes: intervalMinutes,
  })
}

/**
 * Set up the recovery snapshot alarm
 */
async function setupRecoverySnapshotAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.RECOVERY_SNAPSHOT)
  await chrome.alarms.create(ALARM_NAMES.RECOVERY_SNAPSHOT, {
    periodInMinutes: RECOVERY_CONFIG.INTERVAL_MINUTES,
  })
}

/**
 * Set up the export reminder alarm (runs daily to check if reminder is due)
 */
async function setupExportReminderAlarm(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAMES.EXPORT_REMINDER)
  await chrome.alarms.create(ALARM_NAMES.EXPORT_REMINDER, {
    periodInMinutes: 60 * 24, // Check once per day
    delayInMinutes: 60, // First check after 1 hour
  })
}

/**
 * Export reminder state stored in local storage
 */
interface ExportReminderState {
  /** Whether a reminder is currently pending (not dismissed) */
  pending: boolean
  /** Reason for the reminder */
  reason: 'time' | 'milestone'
  /** For time-based: days since last export */
  daysSinceExport?: number
  /** For milestone: the session count milestone reached */
  milestone?: number
  /** Timestamp when reminder was triggered */
  triggeredAt: number
}

/**
 * Check if an export reminder should be shown and update the reminder state
 */
async function checkExportReminder(): Promise<void> {
  const settings = await settingsStorage.get()

  // Skip if reminders are disabled
  if (!settings.exportReminder.enabled) {
    return
  }

  // Skip for Pro users (they have cloud backup)
  if (await isProUser()) {
    return
  }

  const sessions = await sessionsStorage.getAll()
  const sessionCount = sessions.length

  // Check for time-based reminder
  const lastExportDate = settings.exportReminder.lastExportDate
  if (lastExportDate) {
    const daysSinceExport = Math.floor((Date.now() - lastExportDate) / (1000 * 60 * 60 * 24))
    if (daysSinceExport >= settings.exportReminder.intervalDays) {
      // Time-based reminder is due
      const state: ExportReminderState = {
        pending: true,
        reason: 'time',
        daysSinceExport,
        triggeredAt: Date.now(),
      }
      await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, state)
      return
    }
  } else if (sessionCount > 0) {
    // No export ever done - set initial lastExportDate to now so we don't nag immediately
    // The reminder will trigger after intervalDays from now
    await settingsStorage.update({
      exportReminder: { ...settings.exportReminder, lastExportDate: Date.now() },
    })
  }

  // Check for milestone-based reminder
  const lastMilestone = settings.exportReminder.lastMilestoneReached ?? 0
  for (const milestone of EXPORT_REMINDER_CONFIG.MILESTONES) {
    if (sessionCount >= milestone && milestone > lastMilestone) {
      // New milestone reached!
      const state: ExportReminderState = {
        pending: true,
        reason: 'milestone',
        milestone,
        triggeredAt: Date.now(),
      }
      await storage.set(STORAGE_KEYS.EXPORT_REMINDER_STATE, state)
      // Update the last milestone so we don't trigger again for the same milestone
      await settingsStorage.update({
        exportReminder: { ...settings.exportReminder, lastMilestoneReached: milestone },
      })
      return
    }
  }
}

/**
 * Set up context menus for right-click actions
 */
async function setupContextMenus(): Promise<void> {
  // Remove existing menus first
  await chrome.contextMenus.removeAll()

  // Add "Suspend this tab" menu item
  try {
    chrome.contextMenus.create(
      {
        id: 'suspend-tab',
        title: 'Suspend this tab',
        contexts: ['page'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Raft] Failed to create suspend-tab menu:', chrome.runtime.lastError)
        }
      }
    )
  } catch (err) {
    console.warn('[Raft] Failed to create suspend-tab menu:', err)
  }

  // Add "Suspend other tabs" menu item
  try {
    chrome.contextMenus.create(
      {
        id: 'suspend-other-tabs',
        title: 'Suspend other tabs in window',
        contexts: ['page'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Raft] Failed to create suspend-other-tabs menu:', chrome.runtime.lastError)
        }
      }
    )
  } catch (err) {
    console.warn('[Raft] Failed to create suspend-other-tabs menu:', err)
  }
}

/**
 * Update the extension badge with suspended tab count
 */
async function updateBadge(): Promise<void> {
  const settings = await settingsStorage.get()

  if (!settings.ui.showBadge) {
    await chrome.action.setBadgeText({ text: '' })
    return
  }

  const counts = await getTabCounts()
  const text = counts.suspended > 0 ? counts.suspended.toString() : ''

  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color: '#c07a42' }) // raft-500
}

// ============================================================================
// Event Listeners
// ============================================================================

/**
 * Handle alarm events
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  switch (alarm.name) {
    case ALARM_NAMES.SUSPENSION_CHECK: {
      await checkForInactiveTabs()
      await updateBadge()

      // Periodically clean up orphaned tab activity records
      const tabs = await chrome.tabs.query({})
      const tabIds = new Set(tabs.map((t) => t.id).filter((id): id is number => id !== undefined))
      await tabActivityStorage.cleanup(tabIds)
      break
    }

    case ALARM_NAMES.AUTO_SAVE:
      await performAutoSave()
      break

    case ALARM_NAMES.CLOUD_SYNC:
      if ((await syncEngine.isConfigured()) && syncEngine.isUnlocked()) {
        await syncEngine.performFullSync()
      }
      break

    case ALARM_NAMES.RECOVERY_SNAPSHOT:
      await captureRecoverySnapshot()
      break

    case ALARM_NAMES.EXPORT_REMINDER:
      await checkExportReminder()
      break
  }
})

/**
 * Track tab activity for suspension timing
 *
 * Key insight: We track when the user LEAVES a tab, not when they arrive.
 * This ensures tabs aren't suspended until X minutes after departure.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await initReady

  // Touch the PREVIOUS active tab (the one user just left)
  const prevTabId = previousActiveTab.get(activeInfo.windowId)
  if (prevTabId !== undefined) {
    await tabActivityStorage.touch(prevTabId)
  }

  // Store the new active tab for next time and persist to storage
  previousActiveTab.set(activeInfo.windowId, activeInfo.tabId)
  await savePreviousActiveTabs()

  await updateBadge()
})

/**
 * Track tab updates (URL changes, discard state changes, etc.)
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  // When a tab loads, mark it as active
  if (changeInfo.status === 'complete') {
    await tabActivityStorage.touch(tabId)
  }

  // Update badge and trigger recovery snapshot when discard state changes
  if (changeInfo.discarded !== undefined) {
    await updateBadge()
    // Debounced capture of recovery snapshot
    debouncedCaptureSnapshot()
  }

  // Update badge when URL changes (for tab restore)
  if (changeInfo.url !== undefined) {
    await updateBadge()
  }
})

/**
 * Clean up activity tracking when tabs are closed
 */
chrome.tabs.onRemoved.addListener(async (tabId) => {
  await tabActivityStorage.remove(tabId)
  await updateBadge()
})

/**
 * Clean up previousActiveTab tracking when windows are closed
 */
chrome.windows.onRemoved.addListener(async (windowId) => {
  await initReady
  previousActiveTab.delete(windowId)
  await savePreviousActiveTabs()
})

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  switch (info.menuItemId) {
    case 'suspend-tab':
      await suspendTab(tab.id)
      await updateBadge()
      break

    case 'suspend-other-tabs':
      await suspendOtherTabs(tab.windowId)
      await updateBadge()
      break
  }
})

/**
 * Handle messages from popup and other extension pages
 */
chrome.runtime.onMessage.addListener((message: MessageType, sender, sendResponse) => {
  // Only accept messages from our own extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized sender' })
    return true
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Raft] Message handler error:', err)
      sendResponse({ success: false, error: String(err) })
    })
  return true // Keep channel open for async response
})

// ============================================================================
// Dev Tools Functions (only used in development)
// ============================================================================

/**
 * Get the list of test window IDs
 */
async function getTestWindowIds(): Promise<number[]> {
  const windowIds = await storage.get<number[]>(DEV_TEST_WINDOWS_KEY, [])
  // Filter out any windows that no longer exist
  const existingWindows = await chrome.windows.getAll()
  const existingIds = new Set(existingWindows.map((w) => w.id))
  const validIds = windowIds.filter((id) => existingIds.has(id))
  // Update storage if some windows were closed
  if (validIds.length !== windowIds.length) {
    await storage.set(DEV_TEST_WINDOWS_KEY, validIds)
  }
  return validIds
}

/**
 * Add a window ID to the test windows list
 */
async function addTestWindowId(windowId: number): Promise<void> {
  const windowIds = await getTestWindowIds()
  if (!windowIds.includes(windowId)) {
    windowIds.push(windowId)
    await storage.set(DEV_TEST_WINDOWS_KEY, windowIds)
  }
}

/**
 * Create a dev test scenario
 */
async function createDevScenario(
  scenario: import('@/devtools/types').DevScenario
): Promise<{ windowCount: number; tabCount: number }> {
  let totalTabs = 0

  for (const windowSpec of scenario.windows) {
    // Create window with about:blank
    const createdWindow = await chrome.windows.create({
      url: 'about:blank',
      focused: windowSpec.focused ?? false,
    })

    const windowId = createdWindow?.id
    if (windowId === undefined) continue
    await addTestWindowId(windowId)

    // Get the initial blank tab to remove later
    const initialTabs = await chrome.tabs.query({ windowId })
    const blankTabId = initialTabs[0]?.id

    // Create ungrouped tabs
    if (windowSpec.tabs) {
      for (const tabSpec of windowSpec.tabs) {
        await chrome.tabs.create({
          windowId,
          url: tabSpec.url,
          pinned: tabSpec.pinned ?? false,
          active: tabSpec.active ?? false,
        })
        totalTabs++
      }
    }

    // Create grouped tabs
    if (windowSpec.groups) {
      for (const groupSpec of windowSpec.groups) {
        const tabIds: number[] = []

        // Create tabs for this group
        for (const tabSpec of groupSpec.tabs) {
          const tab = await chrome.tabs.create({
            windowId,
            url: tabSpec.url,
            pinned: tabSpec.pinned ?? false,
            active: tabSpec.active ?? false,
          })
          if (tab.id) {
            tabIds.push(tab.id)
            totalTabs++
          }
        }

        // Group the tabs (requires at least one tab)
        if (tabIds.length > 0) {
          // Cast to the required tuple type
          const tabIdsForGroup = tabIds as [number, ...number[]]
          const groupId = await chrome.tabs.group({
            tabIds: tabIdsForGroup,
            createProperties: { windowId },
          })

          // Update group properties
          await chrome.tabGroups.update(groupId, {
            title: groupSpec.title,
            color: groupSpec.color as chrome.tabGroups.Color,
            collapsed: groupSpec.collapsed ?? false,
          })
        }
      }
    }

    // Remove the initial blank tab
    if (blankTabId) {
      try {
        await chrome.tabs.remove(blankTabId)
      } catch {
        // Tab may already be closed
      }
    }
  }

  return { windowCount: scenario.windows.length, tabCount: totalTabs }
}

/**
 * Clean up all test windows
 */
async function cleanupTestWindows(): Promise<{ closedCount: number }> {
  const windowIds = await getTestWindowIds()
  let closedCount = 0

  for (const windowId of windowIds) {
    try {
      await chrome.windows.remove(windowId)
      closedCount++
    } catch {
      // Window may already be closed
    }
  }

  // Clear the list
  await storage.set(DEV_TEST_WINDOWS_KEY, [])

  return { closedCount }
}

/**
 * Process incoming messages
 */
async function handleMessage(message: MessageType): Promise<MessageResponse> {
  try {
    switch (message.type) {
      case 'SUSPEND_TAB': {
        const suspended = await suspendTab(message.tabId)
        await updateBadge()
        if (suspended) {
          return { success: true, data: { suspended: true } }
        }
        return { success: false, error: 'Tab could not be suspended' }
      }

      case 'SUSPEND_OTHER_TABS': {
        const count = await suspendOtherTabs(message.windowId)
        await updateBadge()
        return { success: true, data: { suspended: count } }
      }

      case 'SUSPEND_ALL_TABS': {
        const count = await suspendAllTabs()
        await updateBadge()
        return { success: true, data: { suspended: count } }
      }

      case 'RESTORE_ALL_TABS': {
        const count = await restoreAllTabs(message.windowId)
        await updateBadge()
        return { success: true, data: { restored: count } }
      }

      case 'GET_TAB_COUNTS': {
        const counts = await getTabCounts()
        return { success: true, data: counts }
      }

      case 'GET_CURRENT_TAB_STATUS': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tab) {
          return { success: false, error: 'No active tab' }
        }
        const check = await canSuspendTab(tab)
        const suspended = tab.discarded ?? false
        return {
          success: true,
          data: {
            tab: {
              id: tab.id,
              title: tab.title,
              url: tab.url,
              suspended,
              pinned: tab.pinned,
              audible: tab.audible,
            },
            canSuspend: check.canSuspend,
            reason: check.reason,
          },
        }
      }

      case 'GET_SETTINGS': {
        const settings = await settingsStorage.get()
        return { success: true, data: settings }
      }

      case 'UPDATE_SETTINGS': {
        const settings = await settingsStorage.update(message.settings)

        // Re-setup alarms based on new settings
        if (settings.suspension.enabled) {
          await setupSuspensionAlarm()
        } else {
          await chrome.alarms.clear(ALARM_NAMES.SUSPENSION_CHECK)
        }

        if (settings.autoSave.enabled) {
          await setupAutoSaveAlarm(settings.autoSave.intervalMinutes)
        } else {
          await chrome.alarms.clear(ALARM_NAMES.AUTO_SAVE)
        }

        if (settings.exportReminder.enabled) {
          await setupExportReminderAlarm()
        } else {
          await chrome.alarms.clear(ALARM_NAMES.EXPORT_REMINDER)
        }

        await updateBadge()
        return { success: true, data: settings }
      }

      // ========== Session Messages ==========

      case 'SAVE_SESSION': {
        const session = await captureCurrentSession(message.name, 'manual')
        await saveSession(session)
        return { success: true, data: { session, stats: getSessionStats(session) } }
      }

      case 'SAVE_WINDOW': {
        const session = await captureWindow(message.windowId, message.name)
        await saveSession(session)
        return { success: true, data: { session, stats: getSessionStats(session) } }
      }

      case 'RESTORE_SESSION': {
        const result = await restoreSession(message.sessionId, {
          asSuspended: message.asSuspended,
        })
        return { success: true, data: result }
      }

      case 'GET_SESSIONS': {
        const sessions = await getAllSessions()
        const sessionsWithStats = sessions.map((s) => ({
          ...s,
          stats: getSessionStats(s),
        }))
        // Sort by most recent first
        sessionsWithStats.sort((a, b) => b.createdAt - a.createdAt)
        return { success: true, data: sessionsWithStats }
      }

      case 'DELETE_SESSION': {
        await deleteSession(message.sessionId)
        return { success: true }
      }

      case 'RENAME_SESSION': {
        await renameSession(message.sessionId, message.name)
        return { success: true }
      }

      case 'SEARCH_SESSIONS': {
        const sessions = await searchSessions(message.query)
        const sessionsWithStats = sessions.map((s) => ({
          ...s,
          stats: getSessionStats(s),
        }))
        sessionsWithStats.sort((a, b) => b.createdAt - a.createdAt)
        return { success: true, data: sessionsWithStats }
      }

      // ========== Cloud Sync Messages ==========

      case 'CLOUD_CONNECT': {
        // Check Pro status first
        if (!(await canUseCloudSync())) {
          return { success: false, error: 'Cloud sync requires Pro. Please upgrade.' }
        }

        // Launch OAuth flow and get tokens
        const result = await launchGoogleOAuth()

        // Tier 1: Check if encryption key data exists locally
        const existingKeyData = await encryptionKeyStorage.get()
        if (existingKeyData) {
          return {
            success: true,
            data: {
              needsUnlock: true,
              email: result.email,
              tokens: result.tokens,
            },
          }
        }

        // Tier 2: No local data — check Drive for key data from a previous install
        try {
          const driveKeyData = await gdrive.downloadKeyData(result.tokens.accessToken)
          if (driveKeyData) {
            // Restore key data locally so unlock flow works
            await encryptionKeyStorage.save({
              salt: driveKeyData.salt,
              verificationHash: driveKeyData.verificationHash,
            })
            return {
              success: true,
              data: {
                needsUnlock: true,
                email: result.email,
                tokens: result.tokens,
              },
            }
          }
        } catch (err) {
          // Drive failure is non-fatal — fall through to new setup
          console.warn('[Raft] Failed to check Drive for existing key data:', err)
        }

        // Tier 3: No data anywhere — truly new user
        return {
          success: true,
          data: {
            needsEncryptionSetup: true,
            email: result.email,
            tokens: result.tokens,
          },
        }
      }

      case 'CLOUD_SETUP_ENCRYPTION': {
        // Set up encryption with user's password
        const { keyData, recoveryKey, key } = await setupEncryption(message.password)

        // Get tokens from message parameter (passed directly from UI, never stored in plaintext)
        const pendingTokens = message.tokens
        const pendingEmail = message.email
        if (!pendingTokens || !pendingEmail) {
          return { success: false, error: 'No pending connection. Please reconnect.' }
        }

        // Encrypt and save tokens
        const encryptedTokens = await encryptObject(pendingTokens, key)
        await cloudCredentialsStorage.save({
          provider: 'gdrive',
          encryptedTokens: JSON.stringify(encryptedTokens),
          email: pendingEmail,
          connectedAt: Date.now(),
        })

        // Also encrypt tokens with recovery key for actual recovery support
        const recoveryDerivedKey = await deriveKeyFromRecovery(recoveryKey, keyData.salt)
        const recoveryEncrypted = await encryptObject(pendingTokens, recoveryDerivedKey)
        keyData.recoveryPayload = JSON.stringify(recoveryEncrypted)

        // Save key data (includes recovery payload)
        await encryptionKeyStorage.save(keyData)

        // Upload key data to Drive for future reinstall detection (non-fatal)
        try {
          await gdrive.uploadKeyData(pendingTokens.accessToken, {
            salt: keyData.salt,
            verificationHash: keyData.verificationHash,
          })
        } catch (err) {
          console.warn('[Raft] Failed to upload key data to Drive:', err)
        }

        // Enable cloud sync
        await cloudSyncSettingsStorage.update({ enabled: true })

        // Set up sync alarm
        const syncSettings = await cloudSyncSettingsStorage.get()
        await setupCloudSyncAlarm(syncSettings.intervalMinutes)

        return {
          success: true,
          data: { recoveryKey },
        }
      }

      case 'CLOUD_UNLOCK': {
        const unlocked = await syncEngine.unlock(message.password)
        if (!unlocked) {
          return { success: false, error: 'Incorrect password' }
        }

        // If tokens were passed (from a new connect flow), encrypt and save them
        if (message.tokens && message.email) {
          const unlockKey = syncEngine.getEncryptionKeyForSetup()
          if (unlockKey) {
            const encryptedTokens = await encryptObject(message.tokens, unlockKey)
            await cloudCredentialsStorage.save({
              provider: 'gdrive',
              encryptedTokens: JSON.stringify(encryptedTokens),
              email: message.email,
              connectedAt: Date.now(),
            })

            // Enable cloud sync
            await cloudSyncSettingsStorage.update({ enabled: true })
            const syncSettings = await cloudSyncSettingsStorage.get()
            await setupCloudSyncAlarm(syncSettings.intervalMinutes)
          }
        }

        // Process any pending queue items
        await syncEngine.processQueue()

        return { success: true }
      }

      case 'CLOUD_LOCK': {
        syncEngine.lock()
        return { success: true }
      }

      case 'CLOUD_REGENERATE_RECOVERY_KEY': {
        const keyData = await encryptionKeyStorage.get()
        if (!keyData) {
          return { success: false, error: 'Encryption not set up' }
        }

        // Verify password
        const key = await deriveKey(message.password, keyData.salt)
        const hash = await createVerificationHash(key, keyData.salt)
        if (hash !== keyData.verificationHash) {
          return { success: false, error: 'Incorrect password' }
        }

        // Decrypt tokens with password key
        const credentials = await cloudCredentialsStorage.get()
        if (!credentials) {
          return { success: false, error: 'No cloud credentials found' }
        }
        const payload = JSON.parse(credentials.encryptedTokens)
        const tokens = await decryptObject(payload, key)

        // Generate new recovery key and encrypt tokens with it
        const newRecoveryKey = generateRecoveryKey()
        const recoveryDerivedKey = await deriveKeyFromRecovery(newRecoveryKey, keyData.salt)
        const recoveryEncrypted = await encryptObject(tokens, recoveryDerivedKey)

        // Save updated key data with new recovery payload
        await encryptionKeyStorage.save({
          ...keyData,
          recoveryPayload: JSON.stringify(recoveryEncrypted),
        })

        return { success: true, data: { recoveryKey: newRecoveryKey } }
      }

      case 'CLOUD_RECOVER_WITH_KEY': {
        // Recovery flow: verify identity via recovery key, set new password, wipe & re-sync
        const keyData = await encryptionKeyStorage.get()
        if (!keyData || !keyData.recoveryPayload) {
          return { success: false, error: 'No recovery data available' }
        }

        // Step 1: Validate recovery key by decrypting the recovery payload
        let tokens: CloudTokens
        try {
          const recoveryDerivedKey = await deriveKeyFromRecovery(message.recoveryKey, keyData.salt)
          const recoveryPayload = JSON.parse(keyData.recoveryPayload) as EncryptedPayload
          tokens = await decryptObject<CloudTokens>(recoveryPayload, recoveryDerivedKey)
        } catch {
          return { success: false, error: 'Invalid recovery key' }
        }

        // Step 2: Derive new encryption key from new password with a fresh salt
        const newSalt = generateSalt()
        const newKey = await deriveKey(message.newPassword, newSalt)
        const newVerificationHash = await createVerificationHash(newKey, newSalt)

        // Step 3: Encrypt tokens with the new key
        const newEncryptedTokens = await encryptObject(tokens, newKey)

        // Step 4: Generate new recovery key + recovery payload
        const newRecoveryKey = generateRecoveryKey()
        const newRecoveryDerivedKey = await deriveKeyFromRecovery(newRecoveryKey, newSalt)
        const newRecoveryEncrypted = await encryptObject(tokens, newRecoveryDerivedKey)

        // Step 5: Save updated encryption key data
        await encryptionKeyStorage.save({
          salt: newSalt,
          verificationHash: newVerificationHash,
          recoveryPayload: JSON.stringify(newRecoveryEncrypted),
        })

        // Step 6: Save re-encrypted credentials
        const credentials = await cloudCredentialsStorage.get()
        if (credentials) {
          await cloudCredentialsStorage.save({
            ...credentials,
            encryptedTokens: JSON.stringify(newEncryptedTokens),
          })
        }

        // Step 7: Unlock sync engine with new key
        syncEngine.setEncryptionKey(newKey)

        // Step 8: Wipe old encrypted data from Drive & upload new key metadata
        try {
          await gdrive.clearAllData(tokens.accessToken)
          await gdrive.uploadKeyData(tokens.accessToken, {
            salt: newSalt,
            verificationHash: newVerificationHash,
          })
        } catch (err) {
          console.warn('[Raft] Recovery: failed to reset Drive data:', err)
        }

        // Step 9: Re-upload all local sessions with new encryption (fire-and-forget)
        syncEngine.performFullSync().catch((err: unknown) => {
          console.error('[Raft] Recovery: post-recovery sync failed:', err)
        })

        return { success: true, data: { recoveryKey: newRecoveryKey } }
      }

      case 'CLOUD_DISCONNECT': {
        // If unlocked, we can revoke tokens and optionally delete cloud data
        if (syncEngine.isUnlocked()) {
          try {
            const tokens = await syncEngine.getValidTokensForDisconnect()
            if (tokens) {
              // Delete cloud data if requested
              if (message.deleteCloudData) {
                await gdrive.clearAllData(tokens.accessToken)
              }
              // Revoke OAuth access (best-effort)
              try {
                await revokeAccess(tokens.accessToken)
              } catch {
                // User might have already revoked in Google settings
              }
            }
          } catch {
            // Don't block disconnect on cleanup errors
          }
        }

        // Clear all local cloud sync data
        await clearAllCloudSyncData()

        // Cancel sync alarm
        await chrome.alarms.clear(ALARM_NAMES.CLOUD_SYNC)

        return { success: true }
      }

      case 'CLOUD_SYNC': {
        if (!(await syncEngine.isConfigured())) {
          return { success: false, error: 'Cloud sync not configured' }
        }
        if (!syncEngine.isUnlocked()) {
          return { success: false, error: 'Cloud sync is locked' }
        }

        const result = await syncEngine.performFullSync()
        if (result.success) {
          return { success: true, data: result }
        } else {
          return { success: false, error: result.errors[0] || 'Sync failed' }
        }
      }

      case 'CLOUD_GET_STATUS': {
        const status = await syncEngine.getSyncStatus()
        return { success: true, data: status }
      }

      case 'CLOUD_GET_SETTINGS': {
        const settings = await cloudSyncSettingsStorage.get()
        return { success: true, data: settings }
      }

      case 'CLOUD_UPDATE_SETTINGS': {
        const settings = await cloudSyncSettingsStorage.update(message.settings)

        // Update sync alarm if interval changed
        if (settings.enabled) {
          await setupCloudSyncAlarm(settings.intervalMinutes)
        } else {
          await chrome.alarms.clear(ALARM_NAMES.CLOUD_SYNC)
        }

        return { success: true, data: settings }
      }

      case 'CLOUD_GET_SYNCED_IDS': {
        const result = await chrome.storage.local.get(CLOUD_SYNC_KEYS.SYNCED_IDS)
        const ids = (result[CLOUD_SYNC_KEYS.SYNCED_IDS] as string[] | undefined) ?? []
        return { success: true, data: ids }
      }

      // ========== Pro Licensing Messages ==========

      case 'PRO_CHECK_STATUS': {
        const isPro = await isProUser()
        const { email } = isPro ? await checkLicense() : { email: undefined }
        return { success: true, data: { isPro, email } }
      }

      case 'PRO_OPEN_CHECKOUT': {
        openCheckoutPage()
        return { success: true }
      }

      case 'PRO_ACTIVATE_LICENSE': {
        const license = await activateLicense(message.licenseKey)
        if (license && license.status === 'active') {
          return { success: true, data: { license } }
        }
        return { success: false, error: 'Invalid or inactive license key' }
      }

      case 'PRO_GET_LICENSE': {
        const license = await getStoredLicense()
        return { success: true, data: { license } }
      }

      case 'PRO_CLEAR_LICENSE': {
        await clearLicense()
        return { success: true }
      }

      // ========== Browser Sync Status ==========

      case 'GET_SYNC_STATUS': {
        const status = await getSyncStatus()
        return { success: true, data: status }
      }

      case 'RESTORE_FROM_SYNC': {
        const restoredSessions = await restoreFromSync()
        for (const session of restoredSessions) {
          await sessionsStorage.save(session)
        }
        return { success: true, data: { count: restoredSessions.length } }
      }

      case 'CLEAR_SYNC_DATA': {
        await clearSyncData()
        return { success: true }
      }

      // ========== Recovery Snapshots ==========

      case 'GET_RECOVERY_SNAPSHOTS': {
        const snapshots = await getRecoverySnapshots()
        return { success: true, data: snapshots }
      }

      case 'RESTORE_RECOVERY_SNAPSHOT': {
        const result = await restoreFromSnapshot(message.snapshotId)
        if (result) {
          return { success: true, data: result }
        }
        return { success: false, error: 'Failed to restore from snapshot' }
      }

      case 'DELETE_RECOVERY_SNAPSHOT': {
        const deleted = await deleteRecoverySnapshot(message.snapshotId)
        if (deleted) {
          return { success: true }
        }
        return { success: false, error: 'Failed to delete snapshot' }
      }

      // ========== Export Reminder Messages ==========

      case 'GET_EXPORT_REMINDER_STATE': {
        const state = await storage.get<ExportReminderState | null>(
          STORAGE_KEYS.EXPORT_REMINDER_STATE,
          null
        )
        return { success: true, data: state }
      }

      case 'DISMISS_EXPORT_REMINDER': {
        // Clear the pending reminder
        await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)
        return { success: true }
      }

      case 'MARK_EXPORT_COMPLETE': {
        // Update lastExportDate and clear any pending reminder
        const settings = await settingsStorage.get()
        await settingsStorage.update({
          exportReminder: { ...settings.exportReminder, lastExportDate: Date.now() },
        })
        await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)
        return { success: true }
      }

      // ========== Tab Deduplication Messages ==========

      case 'GET_DUPLICATE_COUNT': {
        const count = await getDuplicateCount()
        return { success: true, data: { count } }
      }

      case 'CLOSE_DUPLICATES': {
        const result = await closeDuplicates()
        await updateBadge()
        return { success: true, data: result }
      }

      // ========== Partial Session Restore ==========

      case 'RESTORE_SESSION_PARTIAL': {
        const result = await restoreSessionPartial(message.sessionId, {
          asSuspended: message.asSuspended,
          selection: message.selection,
        })
        return { success: true, data: result }
      }

      // ========== Backup Health ==========

      case 'GET_BACKUP_HEALTH': {
        const [allSessions, healthSettings, browserSyncStatus, cloudStatus, snapshots, isPro] =
          await Promise.all([
            getAllSessions(),
            settingsStorage.get(),
            getSyncStatus(),
            syncEngine.getSyncStatus(),
            getRecoverySnapshots(),
            isProUser(),
          ])

        // Derive lastAutoSaveAt from most recent auto-save session
        const autoSaves = allSessions
          .filter((s) => s.source === 'auto')
          .sort((a, b) => b.createdAt - a.createdAt)
        const lastAutoSaveAt = autoSaves.length > 0 ? autoSaves[0].createdAt : undefined

        const healthInput = {
          totalSessions: allSessions.length,
          autoSaveEnabled: healthSettings.autoSave.enabled,
          lastAutoSaveAt,
          recoverySnapshotCount: snapshots.length,
          lastRecoveryAt: snapshots.length > 0 ? snapshots[0].timestamp : undefined,
          browserSync: {
            sessionCount: browserSyncStatus.sessionCount,
            totalBytes: browserSyncStatus.totalBytes,
            maxBytes: browserSyncStatus.maxBytes,
            percentUsed: browserSyncStatus.percentUsed,
          },
          cloudSync: {
            configured: cloudStatus.configured,
            enabled: cloudStatus.enabled,
            unlocked: cloudStatus.unlocked,
            lastSyncAt: cloudStatus.lastSyncAt,
            lastError: cloudStatus.lastError,
            syncing: cloudStatus.syncing,
          },
          isPro,
          exportReminderLastExport: healthSettings.exportReminder.lastExportDate,
        }

        const health = computeBackupHealth(healthInput)
        return { success: true, data: health }
      }

      // ========== Dev Tools Messages (dev mode only) ==========

      case 'DEV_CREATE_SCENARIO': {
        if (!import.meta.env.DEV) {
          return { success: false, error: 'Dev tools are only available in development mode' }
        }
        const result = await createDevScenario(message.scenario)
        return { success: true, data: result }
      }

      case 'DEV_CLEANUP_TEST_WINDOWS': {
        if (!import.meta.env.DEV) {
          return { success: false, error: 'Dev tools are only available in development mode' }
        }
        const result = await cleanupTestWindows()
        return { success: true, data: result }
      }

      case 'DEV_GET_TEST_WINDOW_IDS': {
        if (!import.meta.env.DEV) {
          return { success: false, error: 'Dev tools are only available in development mode' }
        }
        const windowIds = await getTestWindowIds()
        return { success: true, data: { windowIds } }
      }

      default:
        return { success: false, error: 'Unknown message type' }
    }
  } catch (error) {
    console.error('[Raft] Message handler error:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Raft] Extension installed/updated:', details.reason)

  if (details.reason === 'install') {
    // Check if we should restore sessions from sync (cross-device scenario)
    // Note: This works when installing on a new device with the same Chrome profile.
    // Sync storage does NOT survive uninstall, so this won't restore after reinstall.
    const localSessions = await sessionsStorage.getAll()
    if (await shouldRestoreFromSync(localSessions.length)) {
      console.log('[Raft] Found sync backup from another device, restoring sessions...')
      const restoredSessions = await restoreFromSync()

      // Save restored sessions to local storage
      for (const session of restoredSessions) {
        await sessionsStorage.save(session)
      }

      console.log(`[Raft] Restored ${restoredSessions.length} sessions from sync backup`)
    }

    // Check if we should restore recovery snapshot from sync (cross-device scenario)
    const localSnapshots = await recoverySnapshotsStorage.getAll()
    if (localSnapshots.length === 0) {
      const syncedSnapshot = await recoverySnapshotSync.get()
      if (syncedSnapshot) {
        await recoverySnapshotsStorage.save(syncedSnapshot)
        console.log(
          `[Raft] Restored recovery snapshot from sync (${syncedSnapshot.stats.tabCount} tabs)`
        )
      }
    }

    // Open onboarding page for new users
    const onboardingUrl = chrome.runtime.getURL('src/onboarding/index.html')
    chrome.tabs.create({ url: onboardingUrl })
  } else if (details.reason === 'update') {
    console.log('[Raft] Updated from version:', details.previousVersion)

    // Migration: Remove old live backup session (replaced by recovery snapshots)
    try {
      await sessionsStorage.delete('raft:live-backup')
      console.log('[Raft] Migrated: removed old live backup session')
    } catch {
      // Ignore if doesn't exist
    }

    // On update, ensure existing sessions are backed up to sync
    // This helps users who upgrade from before sync was added
    const sessions = await sessionsStorage.getAll()
    const manualSessions = sessions.filter((s) => s.source !== 'auto' && s.source !== 'backup')

    // Backup up to 10 most recent manual sessions (to not overwhelm sync)
    const toBackup = manualSessions.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)

    for (const session of toBackup) {
      await backupSession(session)
    }
  }
  // Don't call initialize() here - it runs at the bottom of the script
})

/**
 * Handle service worker startup (wake from termination)
 */
chrome.runtime.onStartup.addListener(() => {
  // Don't call initialize() here - it runs at the bottom of the script
})

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'suspend-current-tab': {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await suspendTab(tab.id)
        await updateBadge()
      }
      break
    }

    case 'suspend-other-tabs': {
      const window = await chrome.windows.getCurrent()
      await suspendOtherTabs(window.id)
      await updateBadge()
      break
    }

    case 'close-duplicates': {
      await closeDuplicates()
      await updateBadge()
      break
    }

    case 'save-session': {
      const session = await captureCurrentSession(undefined, 'manual')
      await saveSession(session)
      break
    }
  }
})

// Initialize on load (handles both fresh start and wake from termination)
initialize()
