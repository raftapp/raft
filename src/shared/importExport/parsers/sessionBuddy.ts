/**
 * Session Buddy import parser
 *
 * Supports two export modes:
 * - Collections format: { collections: [{ title, folders: [{ links: [{ url, title }] }] }] }
 * - Sessions + Windows format: { sessions: [{ name, windows: [{ tabs: [{ url, title }] }] }] }
 */

import { nanoid } from 'nanoid'
import type { Session, Tab, Window } from '../../types'
import type {
  ImportResult,
  ImportError,
  ImportStats,
  SessionBuddyExport,
  SessionBuddyCollection,
  SessionBuddySessionsExport,
  SessionBuddySession,
} from '../types'
import { sanitizeUrl } from '../validators'

/**
 * Strip BOM character if present at start of content
 */
function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1)
  }
  return content
}

/**
 * Parse Session Buddy collections format into Raft sessions
 */
function parseCollections(
  collections: SessionBuddyCollection[],
  stats: ImportStats,
  warnings: ImportError[]
): Session[] {
  const sessions: Session[] = []
  const now = Date.now()

  for (let collIndex = 0; collIndex < collections.length; collIndex++) {
    const collection = collections[collIndex]
    const windows: Window[] = []

    if (!collection.folders || !Array.isArray(collection.folders)) {
      warnings.push({
        message: `Collection ${collIndex + 1} has no folders`,
      })
      continue
    }

    for (let folderIndex = 0; folderIndex < collection.folders.length; folderIndex++) {
      const folder = collection.folders[folderIndex]
      const tabs: Tab[] = []

      if (!folder.links || !Array.isArray(folder.links)) {
        continue
      }

      for (const link of folder.links) {
        stats.totalEntries++

        if (!link.url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped link with no URL in collection ${collIndex + 1}, folder ${folderIndex + 1}`,
          })
          continue
        }

        const url = sanitizeUrl(link.url)
        if (!url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped invalid/protected URL in collection ${collIndex + 1}`,
            raw: link.url.substring(0, 100),
          })
          continue
        }

        stats.validUrls++

        const tab: Tab = {
          id: nanoid(),
          url,
          title: link.title || url,
          index: tabs.length,
          pinned: link.pinned || false,
          favIconUrl: (link as { favIconUrl?: string }).favIconUrl,
        }

        tabs.push(tab)
      }

      if (tabs.length > 0) {
        windows.push({ id: nanoid(), tabs, tabGroups: [] })
      }
    }

    if (windows.length > 0) {
      const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const sessionName = collection.title || `Session Buddy Import ${collIndex + 1}`

      const session: Session = {
        id: nanoid(),
        name: sessionName,
        createdAt: now,
        updatedAt: now,
        windows,
        source: 'import',
      }

      sessions.push(session)
      stats.sessionsCreated++
      stats.tabsImported += totalTabs
    }
  }

  return sessions
}

/**
 * Parse Session Buddy sessions format into Raft sessions
 */
function parseSessions(
  sbSessions: SessionBuddySession[],
  stats: ImportStats,
  warnings: ImportError[]
): Session[] {
  const sessions: Session[] = []
  const now = Date.now()

  for (let sessionIndex = 0; sessionIndex < sbSessions.length; sessionIndex++) {
    const sbSession = sbSessions[sessionIndex]
    const windows: Window[] = []

    if (!sbSession.windows || !Array.isArray(sbSession.windows)) {
      warnings.push({
        message: `Session ${sessionIndex + 1} has no windows`,
      })
      continue
    }

    for (let windowIndex = 0; windowIndex < sbSession.windows.length; windowIndex++) {
      const sbWindow = sbSession.windows[windowIndex]
      const tabs: Tab[] = []

      if (!sbWindow.tabs || !Array.isArray(sbWindow.tabs)) {
        continue
      }

      for (const sbTab of sbWindow.tabs) {
        stats.totalEntries++

        if (!sbTab.url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped tab with no URL in session ${sessionIndex + 1}, window ${windowIndex + 1}`,
          })
          continue
        }

        const url = sanitizeUrl(sbTab.url)
        if (!url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped invalid/protected URL in session ${sessionIndex + 1}`,
            raw: sbTab.url.substring(0, 100),
          })
          continue
        }

        stats.validUrls++

        const tab: Tab = {
          id: nanoid(),
          url,
          title: sbTab.title || url,
          index: tabs.length,
          pinned: sbTab.pinned || false,
          favIconUrl: sbTab.favIconUrl,
        }

        tabs.push(tab)
      }

      if (tabs.length > 0) {
        windows.push({ id: nanoid(), tabs, tabGroups: [] })
      }
    }

    if (windows.length > 0) {
      const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0)
      const sessionName = sbSession.name || `Session Buddy Import ${sessionIndex + 1}`

      const session: Session = {
        id: nanoid(),
        name: sessionName,
        createdAt: now,
        updatedAt: now,
        windows,
        source: 'import',
      }

      sessions.push(session)
      stats.sessionsCreated++
      stats.tabsImported += totalTabs
    }
  }

  return sessions
}

/**
 * Parse Session Buddy format content into Raft sessions
 */
export function parseSessionBuddy(content: string): ImportResult {
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
      format: 'sessionBuddy',
    }
  }

  let parsed: SessionBuddyExport & SessionBuddySessionsExport
  try {
    parsed = JSON.parse(stripBom(content))
  } catch (e) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}` }],
      warnings: [],
      stats,
      format: 'sessionBuddy',
    }
  }

  // Try sessions format first (Sessions + Windows export mode)
  if (parsed.sessions && Array.isArray(parsed.sessions)) {
    const sessions = parseSessions(parsed.sessions, stats, warnings)

    return {
      success: sessions.length > 0 || parsed.sessions.length === 0,
      sessions,
      errors,
      warnings,
      stats,
      format: 'sessionBuddy',
    }
  }

  // Fall back to collections format
  if (parsed.collections && Array.isArray(parsed.collections)) {
    const sessions = parseCollections(parsed.collections, stats, warnings)

    return {
      success: sessions.length > 0 || parsed.collections.length === 0,
      sessions,
      errors,
      warnings,
      stats,
      format: 'sessionBuddy',
    }
  }

  return {
    success: false,
    sessions: [],
    errors: [{ message: 'Invalid Session Buddy format: missing collections or sessions array' }],
    warnings: [],
    stats,
    format: 'sessionBuddy',
  }
}
