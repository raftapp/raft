import {
  captureCurrentSession,
  captureWindow,
  restoreSession,
  restoreSessionPartial,
  saveSession,
  deleteSession,
  renameSession,
  getAllSessions,
  searchSessions,
  getSessionStats,
} from '../sessions'
import type { MessageResponse, MessageType } from './types'

type SessionsMessage = Extract<
  MessageType,
  {
    type:
      | 'SAVE_SESSION'
      | 'SAVE_WINDOW'
      | 'RESTORE_SESSION'
      | 'GET_SESSIONS'
      | 'DELETE_SESSION'
      | 'RENAME_SESSION'
      | 'SEARCH_SESSIONS'
      | 'RESTORE_SESSION_PARTIAL'
  }
>

export async function handleSessionsMessage(message: SessionsMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'SAVE_SESSION': {
      const session = await captureCurrentSession(message.name, 'manual')
      await saveSession(session)
      return { success: true, data: { session, stats: getSessionStats(session) } }
    }

    case 'SAVE_WINDOW': {
      const session = await captureWindow(message.windowId, message.name)
      await saveSession(session)
      return { success: true, data: { session, stats: getSessionStats(session) } }
    }

    case 'RESTORE_SESSION': {
      const result = await restoreSession(message.sessionId, {
        asSuspended: message.asSuspended,
      })
      return { success: true, data: result }
    }

    case 'GET_SESSIONS': {
      const sessions = await getAllSessions()
      const sessionsWithStats = sessions.map((s) => ({
        ...s,
        stats: getSessionStats(s),
      }))
      sessionsWithStats.sort((a, b) => b.createdAt - a.createdAt)
      return { success: true, data: sessionsWithStats }
    }

    case 'DELETE_SESSION': {
      await deleteSession(message.sessionId)
      return { success: true }
    }

    case 'RENAME_SESSION': {
      await renameSession(message.sessionId, message.name)
      return { success: true }
    }

    case 'SEARCH_SESSIONS': {
      const sessions = await searchSessions(message.query)
      const sessionsWithStats = sessions.map((s) => ({
        ...s,
        stats: getSessionStats(s),
      }))
      sessionsWithStats.sort((a, b) => b.createdAt - a.createdAt)
      return { success: true, data: sessionsWithStats }
    }

    case 'RESTORE_SESSION_PARTIAL': {
      const result = await restoreSessionPartial(message.sessionId, {
        asSuspended: message.asSuspended,
        selection: message.selection,
      })
      return { success: true, data: result }
    }
  }
}
