/**
 * Tab Session Manager import parser
 *
 * Supports two window formats:
 * - Array format: windows: [{ tabs: [{ url, title, ... }] }]
 * - Keyed object format (real TSM exports): windows: { windowId: { tabId: { url, title, ... } } }
 */

import { nanoid } from 'nanoid'
import type { Session, Tab, Window } from '../../types'
import type { ImportResult, ImportError, ImportStats, TSMSession, TSMTab } from '../types'
import { sanitizeUrl } from '../validators'

/**
 * Process a single TSM tab entry into a Raft Tab, updating stats/warnings.
 * Returns the tab or null if skipped.
 */
function processTsmTab(
  tsmTab: TSMTab,
  tabsSoFar: number,
  sessionIndex: number,
  windowIndex: number,
  stats: ImportStats,
  warnings: ImportError[]
): Tab | null {
  stats.totalEntries++

  if (!tsmTab.url) {
    stats.skippedUrls++
    warnings.push({
      message: `Skipped tab with no URL in session ${sessionIndex + 1}, window ${windowIndex + 1}`,
    })
    return null
  }

  const url = sanitizeUrl(tsmTab.url)
  if (!url) {
    stats.skippedUrls++
    warnings.push({
      message: `Skipped invalid/protected URL in session ${sessionIndex + 1}`,
      raw: tsmTab.url.substring(0, 100),
    })
    return null
  }

  stats.validUrls++

  return {
    id: nanoid(),
    url,
    title: tsmTab.title || url,
    index: tabsSoFar,
    pinned: tsmTab.pinned || false,
    favIconUrl: tsmTab.favIconUrl,
  }
}

/**
 * Parse Tab Session Manager format content into Raft sessions
 */
export function parseTabSessionManager(content: string): ImportResult {
  const errors: ImportError[] = []
  const warnings: ImportError[] = []
  const stats: ImportStats = {
    totalEntries: 0,
    validUrls: 0,
    skippedUrls: 0,
    sessionsCreated: 0,
    tabsImported: 0,
  }

  if (!content || typeof content !== 'string') {
    return {
      success: false,
      sessions: [],
      errors: [{ message: 'No content provided' }],
      warnings: [],
      stats,
      format: 'tabSessionManager',
    }
  }

  let parsed: TSMSession[]
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}` }],
      warnings: [],
      stats,
      format: 'tabSessionManager',
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: 'Invalid Tab Session Manager format: expected array of sessions' }],
      warnings: [],
      stats,
      format: 'tabSessionManager',
    }
  }

  const sessions: Session[] = []
  const now = Date.now()

  for (let sessionIndex = 0; sessionIndex < parsed.length; sessionIndex++) {
    const tsmSession: TSMSession = parsed[sessionIndex]
    const windows: Window[] = []

    if (!tsmSession.windows) {
      warnings.push({
        message: `Session ${sessionIndex + 1} has no windows`,
      })
      continue
    }

    if (Array.isArray(tsmSession.windows)) {
      // Array format: windows: [{ tabs: [...] }]
      for (let windowIndex = 0; windowIndex < tsmSession.windows.length; windowIndex++) {
        const tsmWindow = tsmSession.windows[windowIndex]
        const tabs: Tab[] = []

        if (!tsmWindow.tabs || !Array.isArray(tsmWindow.tabs)) {
          continue
        }

        for (const tsmTab of tsmWindow.tabs) {
          const tab = processTsmTab(tsmTab, tabs.length, sessionIndex, windowIndex, stats, warnings)
          if (tab) tabs.push(tab)
        }

        if (tabs.length > 0) {
          windows.push({ id: nanoid(), tabs, tabGroups: [] })
        }
      }
    } else if (typeof tsmSession.windows === 'object') {
      // Keyed object format: windows: { windowId: { tabId: { url, ... } } }
      const windowEntries = Object.values(tsmSession.windows)
      for (let windowIndex = 0; windowIndex < windowEntries.length; windowIndex++) {
        const windowObj = windowEntries[windowIndex]
        const tabs: Tab[] = []

        if (typeof windowObj !== 'object' || windowObj === null) {
          continue
        }

        const tabEntries = Object.values(windowObj) as TSMTab[]
        for (const tsmTab of tabEntries) {
          const tab = processTsmTab(tsmTab, tabs.length, sessionIndex, windowIndex, stats, warnings)
          if (tab) tabs.push(tab)
        }

        if (tabs.length > 0) {
          windows.push({ id: nanoid(), tabs, tabGroups: [] })
        }
      }
    }

    // Create session if we have windows
    if (windows.length > 0) {
      const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const sessionName = tsmSession.name || `Tab Session Manager Import ${sessionIndex + 1}`
      const createdAt = tsmSession.date || now

      const session: Session = {
        id: nanoid(),
        name: sessionName,
        createdAt,
        updatedAt: now,
        windows,
        source: 'import',
      }

      sessions.push(session)
      stats.sessionsCreated++
      stats.tabsImported += totalTabs
    }
  }

  return {
    success: sessions.length > 0 || parsed.length === 0,
    sessions,
    errors,
    warnings,
    stats,
    format: 'tabSessionManager',
  }
}
