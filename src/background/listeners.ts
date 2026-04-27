/**
 * Listener bodies for the service worker.
 *
 * The registrations themselves live in src/background/index.ts at module top
 * level (required by MV3 to catch wake-up events). These helpers carry the
 * logic each listener runs.
 */

import { browser } from '@/shared/browser'
import { settingsStorage, tabActivityStorage } from '@/shared/storage'
import { ALARM_NAMES } from '@/shared/constants'
import { syncEngine, syncStateStorage } from '@/shared/cloudSync'
import { suspendTab, suspendOtherTabs, checkForInactiveTabs } from './suspension'
import { captureRecoverySnapshot, debouncedCaptureSnapshot } from './recovery'
import { captureCurrentSession, saveSession, performAutoSave } from './sessions'
import { closeDuplicates } from './deduplication'
import { initReady, savePreviousActiveTabs, previousActiveTab } from './state'
import { updateBadge } from './badge'
import { maybeHibernateTab, hibernateWindow } from './lifecycle/hibernation'
import { checkExportReminder } from './messages/exportReminder'
import { handleMessage } from './messages'
import type { MessageType } from './messages'

export async function handleAlarm(alarm: chrome.alarms.Alarm): Promise<void> {
  switch (alarm.name) {
    case ALARM_NAMES.SUSPENSION_CHECK: {
      await checkForInactiveTabs()
      await updateBadge()
      const tabs = await browser.tabs.query({})
      const tabIds = new Set(tabs.map((t) => t.id).filter((id): id is number => id !== undefined))
      await tabActivityStorage.cleanup(tabIds)
      break
    }
    case ALARM_NAMES.AUTO_SAVE:
      await performAutoSave()
      break
    case ALARM_NAMES.CLOUD_SYNC:
      if ((await syncEngine.isConfigured()) && syncEngine.isUnlocked()) {
        const syncState = await syncStateStorage.get()
        if (!syncState.authExpired) {
          await syncEngine.performFullSync()
        }
      }
      break
    case ALARM_NAMES.RECOVERY_SNAPSHOT:
      await captureRecoverySnapshot()
      break
    case ALARM_NAMES.EXPORT_REMINDER:
      await checkExportReminder()
      break
  }
}

export async function handleTabActivated(activeInfo: chrome.tabs.OnActivatedInfo): Promise<void> {
  await initReady
  // Touch the tab the user just left so its idle clock starts ticking.
  const prevTabId = previousActiveTab.get(activeInfo.windowId)
  if (prevTabId !== undefined) {
    await tabActivityStorage.touch(prevTabId)
  }
  previousActiveTab.set(activeInfo.windowId, activeInfo.tabId)
  await savePreviousActiveTabs()
  await updateBadge()
}

export async function handleTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.OnUpdatedInfo
): Promise<void> {
  if (changeInfo.status === 'complete' || changeInfo.discarded === false) {
    await maybeHibernateTab(tabId)
  }
  if (changeInfo.status === 'complete') {
    await tabActivityStorage.touch(tabId)
  }
  if (changeInfo.discarded !== undefined) {
    await updateBadge()
    debouncedCaptureSnapshot()
  }
  if (changeInfo.url !== undefined) {
    await updateBadge()
  }
}

export async function handleTabRemoved(tabId: number): Promise<void> {
  await tabActivityStorage.remove(tabId)
  await updateBadge()
}

export async function handleWindowCreated(win: chrome.windows.Window): Promise<void> {
  if (win.type !== 'normal' || !win.id) return
  await initReady

  const settings = await settingsStorage.get()
  if (!settings.suspension.hibernateOnStartup) return

  // Only hibernate the FIRST normal window — effectively a "startup" (e.g.,
  // PWA kept Chrome alive, then the user opens a browser window). If other
  // normal windows already exist, this is just a new window (Ctrl+N).
  const normalWindows = await browser.windows.getAll()
  const normalCount = normalWindows.filter((w) => w.type === 'normal').length
  if (normalCount > 1) return

  // Small delay to let Chrome finish creating/restoring tabs in the window
  await new Promise((resolve) => setTimeout(resolve, 500))
  console.log(`[Raft] First normal window detected (${win.id}), hibernating...`)
  await hibernateWindow(win.id)
}

export async function handleWindowRemoved(windowId: number): Promise<void> {
  await initReady
  previousActiveTab.delete(windowId)
  await savePreviousActiveTabs()
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
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
}

export function handleRuntimeMessage(
  message: MessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
): boolean {
  if (sender.id !== browser.runtime.id) {
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
}

export async function handleCommand(command: string): Promise<void> {
  switch (command) {
    case 'suspend-current-tab': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await suspendTab(tab.id)
        await updateBadge()
      }
      break
    }
    case 'suspend-other-tabs': {
      const window = await browser.windows.getCurrent()
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
}
