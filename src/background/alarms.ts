import { browser } from '@/shared/browser'
import { ALARM_NAMES, SUSPENSION_CHECK_INTERVAL_MINUTES, RECOVERY_CONFIG } from '@/shared/constants'

export async function setupSuspensionAlarm(): Promise<void> {
  await browser.alarms.clear(ALARM_NAMES.SUSPENSION_CHECK)
  await browser.alarms.create(ALARM_NAMES.SUSPENSION_CHECK, {
    periodInMinutes: SUSPENSION_CHECK_INTERVAL_MINUTES,
  })
}

export async function setupAutoSaveAlarm(intervalMinutes: number): Promise<void> {
  await browser.alarms.clear(ALARM_NAMES.AUTO_SAVE)
  await browser.alarms.create(ALARM_NAMES.AUTO_SAVE, {
    periodInMinutes: intervalMinutes,
  })
}

export async function setupCloudSyncAlarm(intervalMinutes: number): Promise<void> {
  await browser.alarms.clear(ALARM_NAMES.CLOUD_SYNC)
  await browser.alarms.create(ALARM_NAMES.CLOUD_SYNC, {
    periodInMinutes: intervalMinutes,
  })
}

export async function setupRecoverySnapshotAlarm(): Promise<void> {
  await browser.alarms.clear(ALARM_NAMES.RECOVERY_SNAPSHOT)
  await browser.alarms.create(ALARM_NAMES.RECOVERY_SNAPSHOT, {
    periodInMinutes: RECOVERY_CONFIG.INTERVAL_MINUTES,
  })
}

/**
 * Daily check to decide whether an export reminder is due.
 */
export async function setupExportReminderAlarm(): Promise<void> {
  await browser.alarms.clear(ALARM_NAMES.EXPORT_REMINDER)
  await browser.alarms.create(ALARM_NAMES.EXPORT_REMINDER, {
    periodInMinutes: 60 * 24,
    delayInMinutes: 60,
  })
}
