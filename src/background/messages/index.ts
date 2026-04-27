import type { MessageResponse, MessageType } from './types'
import { handleSuspensionMessage } from './suspension'
import { handleSessionsMessage } from './sessions'
import { handleCloudMessage } from './cloud'
import { handleProMessage } from './pro'
import { handleRecoveryMessage } from './recovery'
import { handleExportReminderMessage } from './exportReminder'
import { handleDedupMessage } from './dedup'
import { handleBackupHealthMessage } from './backupHealth'
import { handleDevToolsMessage } from './devtools'

export type { MessageType, MessageResponse } from './types'

/**
 * Process incoming messages by routing each MessageType to its domain handler.
 */
export async function handleMessage(message: MessageType): Promise<MessageResponse> {
  try {
    switch (message.type) {
      case 'SUSPEND_TAB':
      case 'SUSPEND_OTHER_TABS':
      case 'SUSPEND_ALL_TABS':
      case 'RESTORE_ALL_TABS':
      case 'GET_TAB_COUNTS':
      case 'GET_CURRENT_TAB_STATUS':
      case 'GET_SETTINGS':
      case 'UPDATE_SETTINGS':
        return await handleSuspensionMessage(message)

      case 'SAVE_SESSION':
      case 'SAVE_WINDOW':
      case 'RESTORE_SESSION':
      case 'GET_SESSIONS':
      case 'DELETE_SESSION':
      case 'RENAME_SESSION':
      case 'SEARCH_SESSIONS':
      case 'RESTORE_SESSION_PARTIAL':
        return await handleSessionsMessage(message)

      case 'CLOUD_CONNECT':
      case 'CLOUD_DISCONNECT':
      case 'CLOUD_RECONNECT':
      case 'CLOUD_SETUP_ENCRYPTION':
      case 'CLOUD_UNLOCK':
      case 'CLOUD_REGENERATE_RECOVERY_KEY':
      case 'CLOUD_RECOVER_WITH_KEY':
      case 'CLOUD_LOCK':
      case 'CLOUD_SYNC':
      case 'CLOUD_GET_STATUS':
      case 'CLOUD_GET_SETTINGS':
      case 'CLOUD_UPDATE_SETTINGS':
      case 'CLOUD_GET_SYNCED_IDS':
      case 'GET_SYNC_STATUS':
      case 'RESTORE_FROM_SYNC':
      case 'CLEAR_SYNC_DATA':
        return await handleCloudMessage(message)

      case 'PRO_CHECK_STATUS':
      case 'PRO_OPEN_CHECKOUT':
      case 'PRO_ACTIVATE_LICENSE':
      case 'PRO_GET_LICENSE':
      case 'PRO_CLEAR_LICENSE':
        return await handleProMessage(message)

      case 'GET_RECOVERY_SNAPSHOTS':
      case 'RESTORE_RECOVERY_SNAPSHOT':
      case 'DELETE_RECOVERY_SNAPSHOT':
        return await handleRecoveryMessage(message)

      case 'GET_EXPORT_REMINDER_STATE':
      case 'DISMISS_EXPORT_REMINDER':
      case 'MARK_EXPORT_COMPLETE':
        return await handleExportReminderMessage(message)

      case 'GET_DUPLICATE_COUNT':
      case 'CLOSE_DUPLICATES':
        return await handleDedupMessage(message)

      case 'GET_BACKUP_HEALTH':
        return await handleBackupHealthMessage(message)

      case 'DEV_CREATE_SCENARIO':
      case 'DEV_CLEANUP_TEST_WINDOWS':
      case 'DEV_GET_TEST_WINDOW_IDS':
        return await handleDevToolsMessage(message)

      default: {
        const _exhaustive: never = message
        void _exhaustive
        return { success: false, error: 'Unknown message type' }
      }
    }
  } catch (error) {
    console.error('[Raft] Message handler error:', error)
    return { success: false, error: String(error) }
  }
}
