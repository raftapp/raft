import { getRecoverySnapshots, restoreFromSnapshot, deleteRecoverySnapshot } from '../recovery'
import type { MessageResponse, MessageType } from './types'

type RecoveryMessage = Extract<
  MessageType,
  {
    type: 'GET_RECOVERY_SNAPSHOTS' | 'RESTORE_RECOVERY_SNAPSHOT' | 'DELETE_RECOVERY_SNAPSHOT'
  }
>

export async function handleRecoveryMessage(message: RecoveryMessage): Promise<MessageResponse> {
  switch (message.type) {
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
  }
}
