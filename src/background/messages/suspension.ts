import { browser } from '@/shared/browser'
import { settingsStorage } from '@/shared/storage'
import { ALARM_NAMES } from '@/shared/constants'
import {
  suspendTab,
  suspendOtherTabs,
  suspendAllTabs,
  restoreAllTabs,
  getTabCounts,
  canSuspendTab,
} from '../suspension'
import { updateBadge } from '../badge'
import { setupSuspensionAlarm, setupAutoSaveAlarm, setupExportReminderAlarm } from '../alarms'
import type { MessageResponse, MessageType } from './types'

type SuspensionMessage = Extract<
  MessageType,
  {
    type:
      | 'SUSPEND_TAB'
      | 'SUSPEND_OTHER_TABS'
      | 'SUSPEND_ALL_TABS'
      | 'RESTORE_ALL_TABS'
      | 'GET_TAB_COUNTS'
      | 'GET_CURRENT_TAB_STATUS'
      | 'GET_SETTINGS'
      | 'UPDATE_SETTINGS'
  }
>

export async function handleSuspensionMessage(
  message: SuspensionMessage
): Promise<MessageResponse> {
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
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
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

      if (settings.suspension.enabled) {
        await setupSuspensionAlarm()
      } else {
        await browser.alarms.clear(ALARM_NAMES.SUSPENSION_CHECK)
      }

      if (settings.autoSave.enabled) {
        await setupAutoSaveAlarm(settings.autoSave.intervalMinutes)
      } else {
        await browser.alarms.clear(ALARM_NAMES.AUTO_SAVE)
      }

      if (settings.exportReminder.enabled) {
        await setupExportReminderAlarm()
      } else {
        await browser.alarms.clear(ALARM_NAMES.EXPORT_REMINDER)
      }

      await updateBadge()
      return { success: true, data: settings }
    }
  }
}
