import type { MessageResponse, Settings } from '@/shared/types'
import type { CloudTokens } from '@/shared/cloudSync'

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
  | { type: 'CLOUD_RECONNECT' }
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

export type { MessageResponse }
