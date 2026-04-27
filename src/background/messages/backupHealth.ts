import { settingsStorage } from '@/shared/storage'
import { computeBackupHealth } from '@/shared/backupHealth'
import { syncEngine } from '@/shared/cloudSync'
import { getSyncStatus } from '@/shared/syncBackup'
import { isProUser } from '@/shared/licensing'
import { getAllSessions } from '../sessions'
import { getRecoverySnapshots } from '../recovery'
import type { MessageResponse, MessageType } from './types'

type BackupHealthMessage = Extract<MessageType, { type: 'GET_BACKUP_HEALTH' }>

export async function handleBackupHealthMessage(
  _message: BackupHealthMessage
): Promise<MessageResponse> {
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
