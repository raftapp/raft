/**
 * Chrome storage wrapper with MV3 service worker persistence
 *
 * Key insight: MV3 service workers get terminated aggressively (after ~30s of inactivity).
 * We cannot rely on in-memory state. Everything must:
 * 1. Persist to chrome.storage immediately
 * 2. Reload from storage on every wake
 *
 * This wrapper provides:
 * - Type-safe storage operations
 * - Atomic batch operations
 * - Change listeners that survive service worker restarts
 */

import type { Session, Folder, Settings } from './types'
import { STORAGE_KEYS } from './constants'
import { DEFAULT_SETTINGS } from './types'

/**
 * Type-safe wrapper around chrome.storage.local
 */
export const storage = {
  /**
   * Get a value from storage
   */
  async get<T>(key: string, defaultValue: T): Promise<T> {
    const result = await chrome.storage.local.get(key)
    return (result[key] as T) ?? defaultValue
  },

  /**
   * Set a value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  },

  /**
   * Remove a value from storage
   */
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  },

  /**
   * Get multiple values from storage
   */
  async getMany<T extends Record<string, unknown>>(keys: (keyof T)[]): Promise<Partial<T>> {
    const result = await chrome.storage.local.get(keys as string[])
    return result as Partial<T>
  },

  /**
   * Set multiple values atomically
   */
  async setMany(items: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(items)
  },
}

/**
 * Settings-specific storage operations
 */
export const settingsStorage = {
  /**
   * Get current settings, merged with defaults
   */
  async get(): Promise<Settings> {
    const stored = await storage.get<Partial<Settings>>(STORAGE_KEYS.SETTINGS, {})
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      suspension: { ...DEFAULT_SETTINGS.suspension, ...stored.suspension },
      autoSave: { ...DEFAULT_SETTINGS.autoSave, ...stored.autoSave },
      ui: { ...DEFAULT_SETTINGS.ui, ...stored.ui },
    }
  },

  /**
   * Save settings
   */
  async save(settings: Settings): Promise<void> {
    await storage.set(STORAGE_KEYS.SETTINGS, settings)
  },

  /**
   * Update partial settings
   */
  async update(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.get()
    const updated = {
      ...current,
      ...partial,
      suspension: { ...current.suspension, ...partial.suspension },
      autoSave: { ...current.autoSave, ...partial.autoSave },
      ui: { ...current.ui, ...partial.ui },
    }
    await this.save(updated)
    return updated
  },
}

/**
 * Sessions-specific storage operations
 */
export const sessionsStorage = {
  /**
   * Get all sessions
   */
  async getAll(): Promise<Session[]> {
    return storage.get<Session[]>(STORAGE_KEYS.SESSIONS, [])
  },

  /**
   * Get a session by ID
   */
  async get(id: string): Promise<Session | undefined> {
    const sessions = await this.getAll()
    return sessions.find((s) => s.id === id)
  },

  /**
   * Save a session (creates or updates)
   */
  async save(session: Session): Promise<void> {
    const sessions = await this.getAll()
    const index = sessions.findIndex((s) => s.id === session.id)

    if (index >= 0) {
      sessions[index] = session
    } else {
      sessions.push(session)
    }

    try {
      await storage.set(STORAGE_KEYS.SESSIONS, sessions)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('QUOTA') || message.includes('quota') || message.includes('full')) {
        throw new Error(
          'Storage is full. Delete some sessions to free space, or export and remove older sessions.'
        )
      }
      throw err
    }
  },

  /**
   * Replace the entire sessions array (for atomic batch operations like import)
   */
  async saveAll(sessions: Session[]): Promise<void> {
    try {
      await storage.set(STORAGE_KEYS.SESSIONS, sessions)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('QUOTA') || message.includes('quota') || message.includes('full')) {
        throw new Error(
          'Storage is full. Delete some sessions to free space, or export and remove older sessions.'
        )
      }
      throw err
    }
  },

  /**
   * Delete a session by ID
   */
  async delete(id: string): Promise<void> {
    const sessions = await this.getAll()
    const filtered = sessions.filter((s) => s.id !== id)
    await storage.set(STORAGE_KEYS.SESSIONS, filtered)
  },

  /**
   * Delete multiple sessions
   */
  async deleteMany(ids: string[]): Promise<void> {
    const sessions = await this.getAll()
    const idSet = new Set(ids)
    const filtered = sessions.filter((s) => !idSet.has(s.id))
    await storage.set(STORAGE_KEYS.SESSIONS, filtered)
  },
}

/**
 * Folders-specific storage operations
 */
export const foldersStorage = {
  /**
   * Get all folders
   */
  async getAll(): Promise<Folder[]> {
    return storage.get<Folder[]>(STORAGE_KEYS.FOLDERS, [])
  },

  /**
   * Save a folder
   */
  async save(folder: Folder): Promise<void> {
    const folders = await this.getAll()
    const index = folders.findIndex((f) => f.id === folder.id)

    if (index >= 0) {
      folders[index] = folder
    } else {
      folders.push(folder)
    }

    await storage.set(STORAGE_KEYS.FOLDERS, folders)
  },

  /**
   * Delete a folder by ID
   */
  async delete(id: string): Promise<void> {
    const folders = await this.getAll()
    const filtered = folders.filter((f) => f.id !== id)
    await storage.set(STORAGE_KEYS.FOLDERS, filtered)
  },
}

/**
 * Tab activity tracking for suspension timing
 */
export interface TabActivity {
  tabId: number
  lastActive: number
}

/** Maximum number of tab activity entries to prevent unbounded growth */
const MAX_TAB_ACTIVITY_ENTRIES = 5000

/**
 * Serialized access to tab activity storage.
 * Prevents read-modify-write races from concurrent onActivated/onUpdated/onRemoved events.
 */
let _tabActivityQueue: Promise<void> = Promise.resolve()

function enqueueTabActivity<T>(fn: () => Promise<T>): Promise<T> {
  const result = _tabActivityQueue.then(fn, fn)
  _tabActivityQueue = result.then(
    () => {},
    () => {}
  )
  return result
}

export const tabActivityStorage = {
  /**
   * Get all tab activity records
   */
  async getAll(): Promise<Record<number, number>> {
    return storage.get<Record<number, number>>(STORAGE_KEYS.TAB_ACTIVITY, {})
  },

  /**
   * Update activity for a tab (serialized to prevent races)
   */
  touch(tabId: number): Promise<void> {
    return enqueueTabActivity(async () => {
      const activity = await this.getAll()
      activity[tabId] = Date.now()
      await storage.set(STORAGE_KEYS.TAB_ACTIVITY, activity)
    })
  },

  /**
   * Remove activity record for a closed tab (serialized to prevent races)
   */
  remove(tabId: number): Promise<void> {
    return enqueueTabActivity(async () => {
      const activity = await this.getAll()
      delete activity[tabId]
      await storage.set(STORAGE_KEYS.TAB_ACTIVITY, activity)
    })
  },

  /**
   * Update and remove in a single serialized operation
   */
  touchAndRemove(touchTabId: number, removeTabId: number): Promise<void> {
    return enqueueTabActivity(async () => {
      const activity = await this.getAll()
      activity[touchTabId] = Date.now()
      delete activity[removeTabId]
      await storage.set(STORAGE_KEYS.TAB_ACTIVITY, activity)
    })
  },

  /**
   * Clean up activity records for tabs that no longer exist
   */
  cleanup(existingTabIds: Set<number>): Promise<void> {
    return enqueueTabActivity(async () => {
      const activity = await this.getAll()
      const cleaned: Record<number, number> = {}

      for (const [tabIdStr, lastActive] of Object.entries(activity)) {
        const tabId = parseInt(tabIdStr, 10)
        if (existingTabIds.has(tabId)) {
          cleaned[tabId] = lastActive
        }
      }

      // Cap size as a safety measure
      const entries = Object.entries(cleaned)
      if (entries.length > MAX_TAB_ACTIVITY_ENTRIES) {
        const sorted = entries.sort(([, a], [, b]) => b - a)
        const trimmed: Record<number, number> = {}
        for (const [id, ts] of sorted.slice(0, MAX_TAB_ACTIVITY_ENTRIES)) {
          trimmed[Number(id)] = ts
        }
        await storage.set(STORAGE_KEYS.TAB_ACTIVITY, trimmed)
      } else {
        await storage.set(STORAGE_KEYS.TAB_ACTIVITY, cleaned)
      }
    })
  },
}
