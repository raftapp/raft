import { getDuplicateCount, closeDuplicates } from '../deduplication'
import { updateBadge } from '../badge'
import type { MessageResponse, MessageType } from './types'

type DedupMessage = Extract<MessageType, { type: 'GET_DUPLICATE_COUNT' | 'CLOSE_DUPLICATES' }>

export async function handleDedupMessage(message: DedupMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'GET_DUPLICATE_COUNT': {
      const count = await getDuplicateCount()
      return { success: true, data: { count } }
    }

    case 'CLOSE_DUPLICATES': {
      const result = await closeDuplicates()
      await updateBadge()
      return { success: true, data: result }
    }
  }
}
