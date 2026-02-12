/**
 * Sessions Zustand Store
 *
 * Manages session state for the popup and options UI.
 * Communicates with the background service worker via messages.
 */

import { create } from 'zustand'
import type { Session, PartialRestoreSelection } from '@/shared/types'

type MessageResponse = { success: true; data?: unknown } | { success: false; error: string }

async function sendMessage<T>(message: unknown): Promise<T | null> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse
  if (response.success) {
    return response.data as T
  }
  console.error('[Raft] Message failed:', response.error)
  return null
}

export interface SessionWithStats extends Session {
  stats: {
    windows: number
    tabs: number
    groups: number
  }
}

interface SessionsState {
  sessions: SessionWithStats[]
  loading: boolean
  searchQuery: string
  error: string | null
}

export interface RestoreResult {
  windowsCreated: number
  tabsCreated: number
  windowsFailed: number
  errors: string[]
}

interface SessionsActions {
  loadSessions: () => Promise<void>
  saveCurrentSession: (name?: string) => Promise<SessionWithStats | null>
  saveCurrentWindow: (name?: string) => Promise<SessionWithStats | null>
  restoreSession: (id: string, asSuspended?: boolean) => Promise<RestoreResult | null>
  restoreSessionPartial: (
    id: string,
    selection: PartialRestoreSelection,
    asSuspended?: boolean
  ) => Promise<RestoreResult | null>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, name: string) => Promise<boolean>
  setSearchQuery: (query: string) => void
  searchSessions: (query: string) => Promise<void>
}

export const useSessionsStore = create<SessionsState & SessionsActions>((set, get) => ({
  sessions: [],
  loading: false,
  searchQuery: '',
  error: null,

  loadSessions: async () => {
    set({ loading: true, error: null })
    try {
      const sessions = await sendMessage<SessionWithStats[]>({ type: 'GET_SESSIONS' })
      set({ sessions: sessions || [], loading: false })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  saveCurrentSession: async (name?: string) => {
    set({ loading: true, error: null })
    try {
      const result = await sendMessage<{ session: SessionWithStats }>({
        type: 'SAVE_SESSION',
        name,
      })
      if (result) {
        // Reload sessions to get updated list
        await get().loadSessions()
        return result.session
      }
      return null
    } catch (error) {
      set({ error: String(error), loading: false })
      return null
    }
  },

  saveCurrentWindow: async (name?: string) => {
    set({ loading: true, error: null })
    try {
      const currentWindow = await chrome.windows.getCurrent()
      const result = await sendMessage<{ session: SessionWithStats }>({
        type: 'SAVE_WINDOW',
        windowId: currentWindow.id,
        name,
      })
      if (result) {
        await get().loadSessions()
        return result.session
      }
      return null
    } catch (error) {
      set({ error: String(error), loading: false })
      return null
    }
  },

  restoreSession: async (id: string, asSuspended: boolean = false) => {
    set({ loading: true, error: null })
    try {
      const result = await sendMessage<RestoreResult>({
        type: 'RESTORE_SESSION',
        sessionId: id,
        asSuspended,
      })
      set({ loading: false })
      return result
    } catch (error) {
      set({ error: String(error), loading: false })
      return null
    }
  },

  restoreSessionPartial: async (
    id: string,
    selection: PartialRestoreSelection,
    asSuspended: boolean = false
  ) => {
    set({ loading: true, error: null })
    try {
      const result = await sendMessage<RestoreResult>({
        type: 'RESTORE_SESSION_PARTIAL',
        sessionId: id,
        asSuspended,
        selection,
      })
      set({ loading: false })
      return result
    } catch (error) {
      set({ error: String(error), loading: false })
      return null
    }
  },

  deleteSession: async (id: string) => {
    set({ loading: true, error: null })
    try {
      await sendMessage({ type: 'DELETE_SESSION', sessionId: id })
      // Remove from local state immediately
      set((state) => ({
        sessions: state.sessions.filter((s) => s.id !== id),
        loading: false,
      }))
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },

  renameSession: async (id: string, name: string) => {
    try {
      await sendMessage({ type: 'RENAME_SESSION', sessionId: id, name })
      // Optimistically update local state
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === id ? { ...s, name: name.trim(), updatedAt: Date.now() } : s
        ),
      }))
      return true
    } catch (error) {
      console.error('[Raft] Rename failed:', error)
      return false
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query })
    get().searchSessions(query)
  },

  searchSessions: async (query: string) => {
    set({ loading: true, error: null })
    try {
      if (!query.trim()) {
        await get().loadSessions()
        return
      }
      const sessions = await sendMessage<SessionWithStats[]>({
        type: 'SEARCH_SESSIONS',
        query,
      })
      set({ sessions: sessions || [], loading: false })
    } catch (error) {
      set({ error: String(error), loading: false })
    }
  },
}))
