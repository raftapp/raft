/**
 * Raft Background Service Worker
 *
 * MV3 service workers are terminated after ~30 seconds of inactivity.
 * This means:
 * - No persistent in-memory state
 * - Everything must be stored in browser.storage
 * - Re-register alarms and listeners on every wake
 *
 * Listener registration MUST stay synchronous at the top of this module so
 * that wake-up events fired during the cold-start gap are caught. Listener
 * BODIES (in ./listeners) await initReady before touching state that
 * initialize() populates from storage.
 */

import { browser } from '@/shared/browser'
import { settingsStorage, tabActivityStorage } from '@/shared/storage'
import { syncEngine, cloudSyncSettingsStorage } from '@/shared/cloudSync'
import {
  initReady,
  markInitReady,
  loadPreviousActiveTabs,
  savePreviousActiveTabs,
  previousActiveTab,
} from './state'
import { updateBadge } from './badge'
import { setupContextMenus } from './contextMenus'
import {
  setupSuspensionAlarm,
  setupAutoSaveAlarm,
  setupCloudSyncAlarm,
  setupRecoverySnapshotAlarm,
  setupExportReminderAlarm,
} from './alarms'
import { handleInstalled } from './lifecycle/onInstalled'
import { handleStartup } from './lifecycle/onStartup'
import {
  handleAlarm,
  handleTabActivated,
  handleTabUpdated,
  handleTabRemoved,
  handleWindowCreated,
  handleWindowRemoved,
  handleContextMenuClick,
  handleRuntimeMessage,
  handleCommand,
} from './listeners'

export type { MessageType, MessageResponse } from './messages/types'

// ============================================================================
// Initialization
// ============================================================================

async function initializeTabActivity(): Promise<void> {
  const tabs = await browser.tabs.query({})
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
 * Initialize the service worker. Called on install, update, and every wake.
 */
async function initialize(): Promise<void> {
  const settings = await settingsStorage.get()

  await initializeTabActivity()
  await loadPreviousActiveTabs()

  // Populate initial active tabs per window for activity-on-leave tracking
  // (handles the case where the SW restarted and the map was empty).
  const windows = await browser.windows.getAll({ populate: true })
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

  if (settings.suspension.enabled) {
    await setupSuspensionAlarm()
  }
  if (settings.autoSave.enabled) {
    await setupAutoSaveAlarm(settings.autoSave.intervalMinutes)
  }

  const cloudSyncSettings = await cloudSyncSettingsStorage.get()
  if (cloudSyncSettings.enabled && (await syncEngine.isConfigured())) {
    await setupCloudSyncAlarm(cloudSyncSettings.intervalMinutes)
  }

  await setupRecoverySnapshotAlarm()

  if (settings.exportReminder.enabled) {
    await setupExportReminderAlarm()
  }

  await setupContextMenus()
  await updateBadge()

  markInitReady()
}

// ============================================================================
// Event Listeners (registered synchronously at module top level)
// ============================================================================

browser.alarms.onAlarm.addListener(handleAlarm)
browser.tabs.onActivated.addListener(handleTabActivated)
browser.tabs.onUpdated.addListener(handleTabUpdated)
browser.tabs.onRemoved.addListener(handleTabRemoved)
browser.windows.onCreated.addListener(handleWindowCreated)
browser.windows.onRemoved.addListener(handleWindowRemoved)
browser.contextMenus.onClicked.addListener(handleContextMenuClick)
browser.runtime.onMessage.addListener(handleRuntimeMessage)
browser.runtime.onInstalled.addListener(handleInstalled)
browser.runtime.onStartup.addListener(async () => {
  await initReady
  await handleStartup()
})
browser.commands.onCommand.addListener(handleCommand)

// Initialize on load (handles both fresh start and wake from termination)
initialize()
