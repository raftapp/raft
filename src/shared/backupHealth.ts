/**
 * Backup Health Computation
 *
 * Pure functions for computing backup health status.
 * No Chrome API calls — all data is passed in.
 */

import { BACKUP_HEALTH_CONFIG } from './constants'

export type HealthLevel = 'good' | 'attention' | 'warning'

export interface BackupLayerStatus {
  name: string
  status: 'active' | 'stale' | 'error' | 'disabled' | 'locked'
  lastSuccessAt?: number
  detail: string
}

export interface BackupSuggestion {
  message: string
  /** Navigation target: 'general' | 'sessions' | 'cloud' | 'browser-sync' */
  target?: string
  actionLabel?: string
}

export interface BackupHealthData {
  level: HealthLevel
  headline: string
  summary: string
  layers: BackupLayerStatus[]
  coverage: {
    totalSessions: number
    backedUpSessions: number
    percentage: number
  }
  suggestions: BackupSuggestion[]
}

export interface BackupHealthInput {
  totalSessions: number
  autoSaveEnabled: boolean
  lastAutoSaveAt?: number
  recoverySnapshotCount: number
  lastRecoveryAt?: number
  browserSync: {
    sessionCount: number
    totalBytes: number
    maxBytes: number
    percentUsed: number
  }
  cloudSync: {
    configured: boolean
    enabled: boolean
    unlocked: boolean
    lastSyncAt?: number
    lastError?: string
    syncing: boolean
  }
  isPro: boolean
  exportReminderLastExport?: number
}

const MS_PER_HOUR = 3600000

export function computeBackupHealth(input: BackupHealthInput): BackupHealthData {
  const now = Date.now()
  const layers: BackupLayerStatus[] = []
  const suggestions: BackupSuggestion[] = []
  let level: HealthLevel = 'good'

  // ===== Layer 1: Auto-Save =====
  if (input.autoSaveEnabled) {
    const hoursSince = input.lastAutoSaveAt ? (now - input.lastAutoSaveAt) / MS_PER_HOUR : Infinity

    if (hoursSince < BACKUP_HEALTH_CONFIG.STALE_ATTENTION_HOURS) {
      layers.push({
        name: 'Auto-Save',
        status: 'active',
        lastSuccessAt: input.lastAutoSaveAt,
        detail: 'Running on schedule',
      })
    } else if (hoursSince < BACKUP_HEALTH_CONFIG.STALE_WARNING_HOURS) {
      layers.push({
        name: 'Auto-Save',
        status: 'stale',
        lastSuccessAt: input.lastAutoSaveAt,
        detail: 'No recent auto-save',
      })
    } else {
      layers.push({
        name: 'Auto-Save',
        status: 'stale',
        lastSuccessAt: input.lastAutoSaveAt,
        detail: input.lastAutoSaveAt ? 'Auto-save overdue' : 'No auto-saves yet',
      })
    }
  } else {
    layers.push({
      name: 'Auto-Save',
      status: 'disabled',
      detail: 'Disabled',
    })
    if (input.totalSessions > 0) {
      suggestions.push({
        message: 'Enable auto-save for automatic session backups',
        target: 'general',
        actionLabel: 'Enable',
      })
    }
  }

  // ===== Layer 2: Recovery Snapshots =====
  if (input.recoverySnapshotCount > 0) {
    const hoursSince = input.lastRecoveryAt ? (now - input.lastRecoveryAt) / MS_PER_HOUR : Infinity

    layers.push({
      name: 'Recovery Snapshots',
      status: hoursSince < 1 ? 'active' : 'stale',
      lastSuccessAt: input.lastRecoveryAt,
      detail: `${input.recoverySnapshotCount} snapshots available`,
    })
  } else {
    layers.push({
      name: 'Recovery Snapshots',
      status: 'stale',
      detail: 'No snapshots yet',
    })
  }

  // ===== Layer 3: Browser Sync =====
  if (input.browserSync.sessionCount > 0) {
    if (input.browserSync.percentUsed >= BACKUP_HEALTH_CONFIG.SYNC_WARNING_PERCENT) {
      layers.push({
        name: 'Browser Sync',
        status: 'stale',
        detail: `${input.browserSync.percentUsed.toFixed(0)}% full - oldest sessions may be dropped`,
      })
    } else if (input.browserSync.percentUsed >= BACKUP_HEALTH_CONFIG.SYNC_ATTENTION_PERCENT) {
      layers.push({
        name: 'Browser Sync',
        status: 'stale',
        detail: `${input.browserSync.percentUsed.toFixed(0)}% full`,
      })
    } else {
      layers.push({
        name: 'Browser Sync',
        status: 'active',
        detail: `${input.browserSync.sessionCount} sessions synced`,
      })
    }
  } else {
    layers.push({
      name: 'Browser Sync',
      status: 'stale',
      detail: 'No sessions synced yet',
    })
  }

  // ===== Layer 4: Cloud Sync =====
  if (input.isPro && input.cloudSync.configured) {
    if (!input.cloudSync.unlocked) {
      layers.push({
        name: 'Cloud Sync',
        status: 'locked',
        detail: 'Locked - enter password to sync',
      })
      suggestions.push({
        message: 'Unlock Cloud Sync to keep sessions backed up',
        target: 'cloud',
        actionLabel: 'Unlock',
      })
    } else if (input.cloudSync.lastError) {
      layers.push({
        name: 'Cloud Sync',
        status: 'error',
        lastSuccessAt: input.cloudSync.lastSyncAt,
        detail: 'Sync error',
      })
    } else if (input.cloudSync.syncing) {
      layers.push({
        name: 'Cloud Sync',
        status: 'active',
        lastSuccessAt: input.cloudSync.lastSyncAt,
        detail: 'Syncing now',
      })
    } else {
      const hoursSince = input.cloudSync.lastSyncAt
        ? (now - input.cloudSync.lastSyncAt) / MS_PER_HOUR
        : Infinity

      layers.push({
        name: 'Cloud Sync',
        status: hoursSince < BACKUP_HEALTH_CONFIG.STALE_ATTENTION_HOURS ? 'active' : 'stale',
        lastSuccessAt: input.cloudSync.lastSyncAt,
        detail: input.cloudSync.lastSyncAt ? 'Connected' : 'Never synced',
      })
    }
  } else if (input.isPro) {
    layers.push({
      name: 'Cloud Sync',
      status: 'disabled',
      detail: 'Not connected',
    })
    suggestions.push({
      message: 'Connect Cloud Sync for encrypted Google Drive backup',
      target: 'cloud',
      actionLabel: 'Connect',
    })
  } else {
    layers.push({
      name: 'Cloud Sync',
      status: 'disabled',
      detail: 'Pro feature',
    })
    if (input.totalSessions >= BACKUP_HEALTH_CONFIG.SUGGEST_CLOUD_SESSION_COUNT) {
      suggestions.push({
        message: 'Upgrade to Pro for encrypted cloud backup',
        target: 'cloud',
      })
    }
  }

  // ===== Export suggestion =====
  if (input.totalSessions >= BACKUP_HEALTH_CONFIG.SUGGEST_EXPORT_SESSION_COUNT) {
    if (!input.exportReminderLastExport) {
      suggestions.push({
        message: 'Export your sessions as a backup file',
        target: 'sessions',
        actionLabel: 'Export',
      })
    } else {
      const daysSinceExport = (now - input.exportReminderLastExport) / (MS_PER_HOUR * 24)
      if (daysSinceExport >= BACKUP_HEALTH_CONFIG.SUGGEST_EXPORT_DAYS) {
        suggestions.push({
          message: `Last export was ${Math.floor(daysSinceExport)} days ago`,
          target: 'sessions',
          actionLabel: 'Export',
        })
      }
    }
  }

  // ===== Determine overall health level =====
  const hasActiveLayers = layers.some(
    (l) => l.status === 'active' && l.name !== 'Recovery Snapshots'
  )
  const hasCloudError =
    input.isPro &&
    input.cloudSync.configured &&
    input.cloudSync.lastError &&
    !input.cloudSync.unlocked

  // Find the most recent successful backup time across all layers
  const allSuccessTimes = layers
    .map((l) => l.lastSuccessAt)
    .filter((t): t is number => t !== undefined)
  const lastSuccessAt = allSuccessTimes.length > 0 ? Math.max(...allSuccessTimes) : undefined
  const hoursSinceAnyBackup = lastSuccessAt ? (now - lastSuccessAt) / MS_PER_HOUR : Infinity

  if (input.totalSessions === 0) {
    // No sessions = nothing to back up
    level = 'good'
  } else if (hoursSinceAnyBackup >= BACKUP_HEALTH_CONFIG.STALE_WARNING_HOURS || hasCloudError) {
    level = 'warning'
  } else if (
    hoursSinceAnyBackup >= BACKUP_HEALTH_CONFIG.STALE_ATTENTION_HOURS ||
    !hasActiveLayers ||
    !input.autoSaveEnabled
  ) {
    level = 'attention'
  } else {
    level = 'good'
  }

  // ===== Coverage =====
  let backedUpSessions: number
  if (
    input.isPro &&
    input.cloudSync.configured &&
    input.cloudSync.unlocked &&
    !input.cloudSync.lastError
  ) {
    // Cloud sync: assume all sessions covered when active
    backedUpSessions = input.totalSessions
  } else {
    backedUpSessions = input.browserSync.sessionCount
  }
  const coverage = {
    totalSessions: input.totalSessions,
    backedUpSessions: Math.min(backedUpSessions, input.totalSessions),
    percentage:
      input.totalSessions > 0
        ? Math.round((Math.min(backedUpSessions, input.totalSessions) / input.totalSessions) * 100)
        : 100,
  }

  // ===== Headline + Summary =====
  const headlines: Record<HealthLevel, string> = {
    good: 'Your tabs are safe',
    attention: 'Attention needed',
    warning: 'Action needed',
  }

  const timePart = lastSuccessAt
    ? `Last backup ${formatTimeAgo(now - lastSuccessAt)}`
    : 'No recent backup'
  const coveragePart = `${coverage.backedUpSessions} of ${coverage.totalSessions} sessions backed up`
  const summary =
    input.totalSessions > 0 ? `${timePart} - ${coveragePart}` : 'No sessions to back up'

  return {
    level,
    headline: headlines[level],
    summary,
    layers,
    coverage,
    suggestions,
  }
}

function formatTimeAgo(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
