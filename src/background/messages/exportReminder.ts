import { settingsStorage, sessionsStorage, storage } from '@/shared/storage'
import { STORAGE_KEYS, EXPORT_REMINDER_CONFIG } from '@/shared/constants'
import { isProUser } from '@/shared/licensing'
import type { MessageResponse, MessageType } from './types'

/**
 * Export reminder state stored in local storage.
 */
export interface ExportReminderState {
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
 * Check if an export reminder should be shown and update the reminder state.
 * Invoked from the EXPORT_REMINDER alarm.
 */
export async function checkExportReminder(): Promise<void> {
  const settings = await settingsStorage.get()

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
    // No export ever done - set initial lastExportDate to now so we don't nag immediately.
    // The reminder will trigger after intervalDays from now.
    await settingsStorage.update({
      exportReminder: { ...settings.exportReminder, lastExportDate: Date.now() },
    })
  }

  // Check for milestone-based reminder
  const lastMilestone = settings.exportReminder.lastMilestoneReached ?? 0
  for (const milestone of EXPORT_REMINDER_CONFIG.MILESTONES) {
    if (sessionCount >= milestone && milestone > lastMilestone) {
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

type ExportReminderMessage = Extract<
  MessageType,
  {
    type: 'GET_EXPORT_REMINDER_STATE' | 'DISMISS_EXPORT_REMINDER' | 'MARK_EXPORT_COMPLETE'
  }
>

export async function handleExportReminderMessage(
  message: ExportReminderMessage
): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_EXPORT_REMINDER_STATE': {
      const state = await storage.get<ExportReminderState | null>(
        STORAGE_KEYS.EXPORT_REMINDER_STATE,
        null
      )
      return { success: true, data: state }
    }

    case 'DISMISS_EXPORT_REMINDER': {
      await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)
      return { success: true }
    }

    case 'MARK_EXPORT_COMPLETE': {
      const settings = await settingsStorage.get()
      await settingsStorage.update({
        exportReminder: { ...settings.exportReminder, lastExportDate: Date.now() },
      })
      await storage.remove(STORAGE_KEYS.EXPORT_REMINDER_STATE)
      return { success: true }
    }
  }
}
