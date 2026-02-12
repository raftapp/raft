/**
 * Session Management Service
 *
 * Handles capturing and restoring browser sessions including:
 * - Windows, tabs, and tab groups
 * - Native tab discard state preservation
 * - Protection rules for chrome:// URLs
 */

import { nanoid } from 'nanoid'
import { sessionsStorage, settingsStorage, storage } from '@/shared/storage'
import { PROTECTED_URL_PATTERNS, MAX_SESSIONS, STORAGE_KEYS } from '@/shared/constants'
import type {
  Session,
  Window,
  Tab,
  TabGroup,
  SessionSource,
  TabGroupColor,
  PartialRestoreSelection,
} from '@/shared/types'
import { backupSession, removeSessionFromSync } from '@/shared/syncBackup'
import { syncEngine, cloudSyncSettingsStorage } from '@/shared/cloudSync'

/** Cached search index: session ID → pre-lowercased searchable string */
let searchIndex: Map<string, string> | null = null

function buildSearchEntry(session: Session): string {
  const parts = [session.name]
  for (const window of session.windows) {
    for (const tab of window.tabs) {
      parts.push(tab.title, tab.url)
    }
  }
  return parts.join('\0').toLowerCase()
}

async function ensureSearchIndex(): Promise<Map<string, string>> {
  if (searchIndex) return searchIndex
  const sessions = await sessionsStorage.getAll()
  searchIndex = new Map()
  for (const session of sessions) {
    searchIndex.set(session.id, buildSearchEntry(session))
  }
  return searchIndex
}

function invalidateSearchIndex(): void {
  searchIndex = null
}

/**
 * Check if a URL can be saved/restored (not a protected URL)
 */
function canSaveUrl(url: string | undefined): boolean {
  if (!url) return false
  return !PROTECTED_URL_PATTERNS.some((pattern) => url.startsWith(pattern))
}

/**
 * Capture the current state of all windows and tabs
 */
export async function captureCurrentSession(
  name?: string,
  source: SessionSource = 'manual'
): Promise<Session> {
  const windows = await chrome.windows.getAll({ populate: true })
  const now = Date.now()

  const sessionWindows: Window[] = []

  for (const win of windows) {
    if (!win.id || win.type !== 'normal') continue

    // Get tab groups for this window
    const chromeGroups = await chrome.tabGroups.query({ windowId: win.id })
    const groupIdMap = new Map<number, string>()

    const tabGroups: TabGroup[] = chromeGroups.map((group) => {
      const id = nanoid()
      groupIdMap.set(group.id, id)
      return {
        id,
        title: group.title || '',
        color: group.color as TabGroupColor,
        collapsed: group.collapsed,
      }
    })

    const tabs: Tab[] = []
    for (const tab of win.tabs || []) {
      const url = tab.url

      if (!canSaveUrl(url)) continue

      tabs.push({
        id: nanoid(),
        url: url!,
        title: tab.title || 'Untitled',
        favIconUrl: tab.favIconUrl,
        index: tab.index,
        groupId:
          tab.groupId !== undefined && tab.groupId !== -1 ? groupIdMap.get(tab.groupId) : undefined,
        pinned: tab.pinned || false,
        discarded: tab.discarded,
        lastAccessed: tab.lastAccessed,
      })
    }

    // Skip windows with no saveable tabs
    if (tabs.length === 0) continue

    sessionWindows.push({
      id: nanoid(),
      tabs,
      tabGroups,
      focused: win.focused,
      state: win.state as chrome.windows.WindowState,
    })
  }

  const session: Session = {
    id: nanoid(),
    name: name || `Session ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    windows: sessionWindows,
    source,
  }

  return session
}

/**
 * Capture a single window
 */
export async function captureWindow(windowId: number, name?: string): Promise<Session> {
  const win = await chrome.windows.get(windowId, { populate: true })
  const now = Date.now()

  // Get tab groups for this window
  const chromeGroups = await chrome.tabGroups.query({ windowId })
  const groupIdMap = new Map<number, string>()

  const tabGroups: TabGroup[] = chromeGroups.map((group) => {
    const id = nanoid()
    groupIdMap.set(group.id, id)
    return {
      id,
      title: group.title || '',
      color: group.color as TabGroupColor,
      collapsed: group.collapsed,
    }
  })

  const tabs: Tab[] = []
  for (const tab of win.tabs || []) {
    const url = tab.url

    if (!canSaveUrl(url)) continue

    tabs.push({
      id: nanoid(),
      url: url!,
      title: tab.title || 'Untitled',
      favIconUrl: tab.favIconUrl,
      index: tab.index,
      groupId:
        tab.groupId !== undefined && tab.groupId !== -1 ? groupIdMap.get(tab.groupId) : undefined,
      pinned: tab.pinned || false,
      discarded: tab.discarded,
      lastAccessed: tab.lastAccessed,
    })
  }

  const session: Session = {
    id: nanoid(),
    name: name || `Window ${new Date(now).toLocaleString()}`,
    createdAt: now,
    updatedAt: now,
    windows: [
      {
        id: nanoid(),
        tabs,
        tabGroups,
        focused: win.focused,
        state: win.state as chrome.windows.WindowState,
      },
    ],
    source: 'manual',
  }

  return session
}

/**
 * Poll until a tab's URL is no longer about:blank (navigation has committed).
 * Returns false on timeout or if the tab is closed.
 */
async function waitForTabNavigation(
  tabId: number,
  timeoutMs = 10_000,
  pollIntervalMs = 150
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId)
      if (tab.url && tab.url !== 'about:blank') return true
    } catch {
      return false // Tab closed
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return false
}

export interface RestoreOptions {
  /** Restore all tabs in suspended (discarded) state */
  asSuspended?: boolean
  /** Close existing windows first */
  replaceCurrentWindows?: boolean
}

export interface RestoreResult {
  windowsCreated: number
  tabsCreated: number
  windowsFailed: number
  errors: string[]
}

/**
 * Restore an array of windows with their tabs and groups.
 * This is the core restore logic shared by full and partial restore.
 */
async function restoreWindows(
  windows: Window[],
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  let windowsCreated = 0
  let tabsCreated = 0
  let windowsFailed = 0
  const errors: string[] = []

  // Collect tabs to discard after creation (when asSuspended is true)
  const tabsToDiscard: number[] = []

  for (const sessionWindow of windows) {
    try {
      // Create the window with the first tab
      const firstTab = sessionWindow.tabs[0]
      if (!firstTab) continue

      let newWindow: chrome.windows.Window | undefined
      try {
        newWindow = await chrome.windows.create({
          url: firstTab.url,
          focused: sessionWindow.focused,
          state: sessionWindow.state,
        })
      } catch (err) {
        windowsFailed++
        const errorMsg = `Failed to create window: ${err instanceof Error ? err.message : String(err)}`
        errors.push(errorMsg)
        console.error(`[Raft] ${errorMsg}`)
        continue // Continue with next window
      }

      const newWindowId = newWindow?.id
      if (!newWindowId || !newWindow) {
        windowsFailed++
        errors.push('Window created but no ID returned')
        continue
      }
      windowsCreated++
      tabsCreated++

      // Get the first tab ID (it's created with the window)
      const firstTabId = newWindow.tabs?.[0]?.id

      // Track for discard if restoring as suspended
      if (options.asSuspended && firstTabId) {
        tabsToDiscard.push(firstTabId)
      }

      // Track old group IDs to new group IDs
      const groupIdMap = new Map<string, number>()

      // Create remaining tabs
      for (let i = 1; i < sessionWindow.tabs.length; i++) {
        const tab = sessionWindow.tabs[i]

        try {
          const newTab = await chrome.tabs.create({
            windowId: newWindowId,
            url: tab.url,
            index: tab.index,
            pinned: tab.pinned,
            active: false,
          })

          if (newTab.id) {
            tabsCreated++

            // Track for discard if restoring as suspended
            if (options.asSuspended) {
              tabsToDiscard.push(newTab.id)
            }

            // Add to group if it has one
            if (tab.groupId) {
              try {
                const existingGroupId = groupIdMap.get(tab.groupId)
                if (existingGroupId !== undefined) {
                  await chrome.tabs.group({
                    tabIds: newTab.id,
                    groupId: existingGroupId,
                  })
                } else {
                  const sessionGroup = sessionWindow.tabGroups.find((g) => g.id === tab.groupId)
                  if (sessionGroup) {
                    const newGroupId = await chrome.tabs.group({
                      tabIds: newTab.id,
                      createProperties: { windowId: newWindowId },
                    })
                    groupIdMap.set(tab.groupId, newGroupId)

                    await chrome.tabGroups.update(newGroupId, {
                      title: sessionGroup.title,
                      color: sessionGroup.color,
                      collapsed: sessionGroup.collapsed,
                    })
                  }
                }
              } catch (err) {
                console.warn(`[Raft] Failed to restore tab group for tab "${tab.title}":`, err)
              }
            }
          }
        } catch (err) {
          console.warn(`[Raft] Failed to create tab "${tab.title}":`, err)
        }
      }

      // Handle first tab's group membership
      if (firstTabId && firstTab.groupId) {
        try {
          const existingGroupId = groupIdMap.get(firstTab.groupId)
          if (existingGroupId !== undefined) {
            await chrome.tabs.group({
              tabIds: firstTabId,
              groupId: existingGroupId,
            })
          } else {
            const sessionGroup = sessionWindow.tabGroups.find((g) => g.id === firstTab.groupId)
            if (sessionGroup) {
              const newGroupId = await chrome.tabs.group({
                tabIds: firstTabId,
                createProperties: { windowId: newWindowId },
              })
              groupIdMap.set(firstTab.groupId, newGroupId)

              await chrome.tabGroups.update(newGroupId, {
                title: sessionGroup.title,
                color: sessionGroup.color,
                collapsed: sessionGroup.collapsed,
              })
            }
          }
        } catch (err) {
          console.warn(`[Raft] Failed to restore tab group for first tab "${firstTab.title}":`, err)
        }
      }

      // Pin the first tab if needed (must be done after grouping)
      if (firstTabId && firstTab.pinned) {
        try {
          await chrome.tabs.update(firstTabId, { pinned: true })
        } catch (err) {
          console.warn(`[Raft] Failed to pin first tab "${firstTab.title}":`, err)
        }
      }
    } catch (err) {
      windowsFailed++
      const errorMsg = `Unexpected error restoring window: ${err instanceof Error ? err.message : String(err)}`
      errors.push(errorMsg)
      console.error(`[Raft] ${errorMsg}`)
    }
  }

  // Discard tabs if restoring as suspended
  // Wait for each tab's navigation to commit before discarding to avoid about:blank
  if (options.asSuspended && tabsToDiscard.length > 0) {
    const results = await Promise.allSettled(
      tabsToDiscard.map(async (tabId) => {
        const navigated = await waitForTabNavigation(tabId)
        if (!navigated) {
          console.warn(`[Raft] Tab ${tabId} navigation did not commit, skipping discard`)
          return
        }
        await chrome.tabs.discard(tabId)
      })
    )
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[Raft] Failed to discard tab:', r.reason)
      }
    }
  }

  return { windowsCreated, tabsCreated, windowsFailed, errors }
}

/**
 * Restore a session from storage
 */
export async function restoreSession(
  sessionId: string,
  options: RestoreOptions = {}
): Promise<RestoreResult> {
  const session = await sessionsStorage.get(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }

  return restoreWindows(session.windows, options)
}

/**
 * Restore a partial selection of a session (specific windows/tabs).
 */
export async function restoreSessionPartial(
  sessionId: string,
  options: RestoreOptions & { selection: PartialRestoreSelection }
): Promise<RestoreResult> {
  const session = await sessionsStorage.get(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }

  const { selection, ...restoreOpts } = options

  // Filter windows and tabs according to selection
  const filteredWindows: Window[] = []

  for (const window of session.windows) {
    const selectedTabIds = selection.windows[window.id]
    if (!selectedTabIds || selectedTabIds.length === 0) continue

    const selectedTabIdSet = new Set(selectedTabIds)

    // Filter tabs to only selected ones
    const filteredTabs = window.tabs.filter((tab) => selectedTabIdSet.has(tab.id))
    if (filteredTabs.length === 0) continue

    // Filter tab groups to only those referenced by surviving tabs
    const usedGroupIds = new Set(filteredTabs.map((t) => t.groupId).filter(Boolean))
    const filteredGroups = window.tabGroups.filter((g) => usedGroupIds.has(g.id))

    filteredWindows.push({
      ...window,
      tabs: filteredTabs,
      tabGroups: filteredGroups,
    })
  }

  if (filteredWindows.length === 0) {
    return { windowsCreated: 0, tabsCreated: 0, windowsFailed: 0, errors: ['No tabs selected'] }
  }

  return restoreWindows(filteredWindows, restoreOpts)
}

/**
 * Serialization lock for save operations.
 * Prevents concurrent saveSession/performAutoSave from corrupting session lists.
 */
let _saveLock: Promise<void> = Promise.resolve()

function withSaveLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = _saveLock.then(fn, fn)
  _saveLock = result.then(
    () => {},
    () => {}
  )
  return result
}

/**
 * Save a session to storage
 */
export function saveSession(session: Session): Promise<void> {
  return withSaveLock(async () => {
    const sessions = await sessionsStorage.getAll()

    // Check if we're at the limit
    if (sessions.length >= MAX_SESSIONS) {
      // Remove oldest auto-save sessions first
      const autoSaves = sessions
        .filter((s) => s.source === 'auto')
        .sort((a, b) => a.createdAt - b.createdAt)

      if (autoSaves.length > 0) {
        await sessionsStorage.delete(autoSaves[0].id)
        // Also remove from sync
        await removeSessionFromSync(autoSaves[0].id)
      } else {
        // Remove oldest manual session
        const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
        await sessionsStorage.delete(sorted[0].id)
        await removeSessionFromSync(sorted[0].id)
      }
    }

    await sessionsStorage.save(session)
    invalidateSearchIndex()

    // Backup to sync storage (non-blocking, best effort)
    // Only backup manual saves and imports (skip auto-saves and backups to conserve space)
    if (session.source !== 'auto' && session.source !== 'backup') {
      backupSession(session)
        .then((success) => {
          storage.set(STORAGE_KEYS.LAST_BACKUP_STATUS, {
            success,
            timestamp: Date.now(),
            sessionName: session.name,
            error: success ? null : 'Session could not fit in sync storage',
          })
        })
        .catch((err) => {
          console.warn('[Raft] Sync backup failed:', err)
          storage.set(STORAGE_KEYS.LAST_BACKUP_STATUS, {
            success: false,
            timestamp: Date.now(),
            sessionName: session.name,
            error: String(err),
          })
        })

      // Cloud sync (non-blocking)
      triggerCloudSync(session.id)
    }
  })
}

/**
 * Trigger cloud sync for a session (non-blocking)
 */
async function triggerCloudSync(sessionId: string): Promise<void> {
  try {
    const settings = await cloudSyncSettingsStorage.get()
    if (!settings.enabled || !settings.syncOnSave) return

    if (await syncEngine.isConfigured()) {
      // Push session to cloud (will queue if not unlocked)
      await syncEngine.pushSession(sessionId)
    }
  } catch (err) {
    console.warn('[Raft] Cloud sync trigger failed:', err)
    storage.set(STORAGE_KEYS.LAST_SYNC_ERROR, {
      timestamp: Date.now(),
      error: String(err),
    })
  }
}

/**
 * Rename a session
 */
export function renameSession(sessionId: string, name: string): Promise<void> {
  return withSaveLock(async () => {
    const session = await sessionsStorage.get(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const trimmed = name.trim()
    if (!trimmed) throw new Error('Session name cannot be empty')

    session.name = trimmed
    session.updatedAt = Date.now()
    await sessionsStorage.save(session)
    invalidateSearchIndex()

    // Sync renamed session to cloud (non-blocking)
    triggerCloudSync(sessionId)
  })
}

/**
 * Delete a session from storage
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await sessionsStorage.delete(sessionId)
  invalidateSearchIndex()
  // Also remove from sync storage
  await removeSessionFromSync(sessionId)

  // Delete from cloud (non-blocking)
  triggerCloudDelete(sessionId)
}

/**
 * Trigger cloud deletion for a session (non-blocking)
 */
async function triggerCloudDelete(sessionId: string): Promise<void> {
  try {
    const settings = await cloudSyncSettingsStorage.get()
    if (!settings.enabled) return

    if (await syncEngine.isConfigured()) {
      await syncEngine.deleteSessionFromCloud(sessionId)
    }
  } catch (err) {
    console.warn('[Raft] Cloud delete trigger failed:', err)
  }
}

/**
 * Get all sessions from storage
 */
export async function getAllSessions(): Promise<Session[]> {
  return sessionsStorage.getAll()
}

/**
 * Search sessions by name or URL
 */
export async function searchSessions(query: string): Promise<Session[]> {
  if (!query.trim()) {
    return getAllSessions()
  }

  const sessions = await sessionsStorage.getAll()
  const index = await ensureSearchIndex()
  const lowerQuery = query.toLowerCase()

  return sessions.filter((s) => index.get(s.id)?.includes(lowerQuery) ?? false)
}

/**
 * Perform auto-save of current session
 */
export function performAutoSave(): Promise<Session | null> {
  return withSaveLock(async () => {
    const settings = await settingsStorage.get()
    if (!settings.autoSave.enabled) return null

    const session = await captureCurrentSession('Auto-save', 'auto')

    // Don't save empty sessions
    if (session.windows.length === 0) return null

    const totalTabs = session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
    if (totalTabs === 0) return null

    // Clean up old auto-saves beyond maxSlots
    const allSessions = await sessionsStorage.getAll()
    const autoSaves = allSessions
      .filter((s) => s.source === 'auto')
      .sort((a, b) => b.createdAt - a.createdAt)

    if (autoSaves.length >= settings.autoSave.maxSlots) {
      // Delete oldest auto-saves to make room
      const toDelete = autoSaves.slice(settings.autoSave.maxSlots - 1)
      for (const s of toDelete) {
        await sessionsStorage.delete(s.id)
      }
    }

    // Save directly (already inside lock, skip withSaveLock in saveSession)
    const sessions = await sessionsStorage.getAll()
    if (sessions.length >= MAX_SESSIONS) {
      const autoSavesForEvict = sessions
        .filter((s) => s.source === 'auto')
        .sort((a, b) => a.createdAt - b.createdAt)
      if (autoSavesForEvict.length > 0) {
        await sessionsStorage.delete(autoSavesForEvict[0].id)
        await removeSessionFromSync(autoSavesForEvict[0].id)
      } else {
        const sorted = [...sessions].sort((a, b) => a.createdAt - b.createdAt)
        await sessionsStorage.delete(sorted[0].id)
        await removeSessionFromSync(sorted[0].id)
      }
    }
    await sessionsStorage.save(session)
    invalidateSearchIndex()

    return session
  })
}

/**
 * Get session statistics
 */
export function getSessionStats(session: Session): {
  windows: number
  tabs: number
  groups: number
} {
  let tabs = 0
  let groups = 0

  for (const window of session.windows) {
    tabs += window.tabs.length
    groups += window.tabGroups.length
  }

  return {
    windows: session.windows.length,
    tabs,
    groups,
  }
}
