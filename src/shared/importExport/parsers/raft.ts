/**
 * Raft import parser
 *
 * Re-imports previously exported Raft sessions
 *
 * Raft format (JSON):
 * {
 *   "version": "1.0",
 *   "exportedAt": 1234567890,
 *   "raftVersion": "0.1.0",
 *   "sessions": [{ ... Raft session objects ... }]
 * }
 */

import { nanoid } from 'nanoid'
import type { Session, Tab, Window, TabGroup } from '../../types'
import type { ImportResult, ImportError, ImportStats, RaftExport } from '../types'
import { sanitizeUrl } from '../validators'

/**
 * Parse Raft export format content back into Raft sessions
 */
export function parseRaft(content: string): ImportResult {
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
      format: 'raft',
    }
  }

  let parsed: RaftExport
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}` }],
      warnings: [],
      stats,
      format: 'raft',
    }
  }

  if (!parsed.version || !parsed.raftVersion || !Array.isArray(parsed.sessions)) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: 'Invalid Raft format: missing version, raftVersion, or sessions array' }],
      warnings: [],
      stats,
      format: 'raft',
    }
  }

  const sessions: Session[] = []
  const now = Date.now()

  for (let sessionIndex = 0; sessionIndex < parsed.sessions.length; sessionIndex++) {
    const raftSession = parsed.sessions[sessionIndex]

    if (!raftSession.windows || !Array.isArray(raftSession.windows)) {
      warnings.push({
        message: `Session ${sessionIndex + 1} has no windows`,
      })
      continue
    }

    const windows: Window[] = []

    for (let windowIndex = 0; windowIndex < raftSession.windows.length; windowIndex++) {
      const raftWindow = raftSession.windows[windowIndex]
      const tabs: Tab[] = []

      if (!raftWindow.tabs || !Array.isArray(raftWindow.tabs)) {
        continue
      }

      // Build a map of old group IDs to new ones
      const groupIdMap = new Map<string, string>()
      const tabGroups: TabGroup[] = []

      // Process tab groups if they exist
      if (raftWindow.tabGroups && Array.isArray(raftWindow.tabGroups)) {
        for (const group of raftWindow.tabGroups) {
          const newGroupId = nanoid()
          groupIdMap.set(group.id, newGroupId)
          tabGroups.push({
            id: newGroupId,
            title: group.title || '',
            color: group.color || 'grey',
            collapsed: group.collapsed || false,
          })
        }
      }

      for (let tabIndex = 0; tabIndex < raftWindow.tabs.length; tabIndex++) {
        const raftTab = raftWindow.tabs[tabIndex]
        stats.totalEntries++

        if (!raftTab.url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped tab with no URL in session ${sessionIndex + 1}, window ${windowIndex + 1}`,
          })
          continue
        }

        const url = sanitizeUrl(raftTab.url)
        if (!url) {
          stats.skippedUrls++
          warnings.push({
            message: `Skipped invalid/protected URL in session ${sessionIndex + 1}`,
            raw: raftTab.url.substring(0, 100),
          })
          continue
        }

        stats.validUrls++

        // Map old group ID to new one if it exists
        const newGroupId = raftTab.groupId ? groupIdMap.get(raftTab.groupId) : undefined

        const tab: Tab = {
          id: nanoid(),
          url,
          title: raftTab.title || url,
          index: tabs.length,
          pinned: raftTab.pinned || false,
          favIconUrl: raftTab.favIconUrl,
          groupId: newGroupId,
          discarded: raftTab.discarded,
          lastAccessed: raftTab.lastAccessed,
        }

        tabs.push(tab)
      }

      if (tabs.length > 0) {
        windows.push({
          id: nanoid(),
          tabs,
          tabGroups,
          focused: raftWindow.focused,
          state: raftWindow.state,
        })
      }
    }

    // Create session if we have windows
    if (windows.length > 0) {
      const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0)

      const session: Session = {
        id: nanoid(),
        name: raftSession.name || `Raft Import ${sessionIndex + 1}`,
        createdAt: raftSession.createdAt || now,
        updatedAt: now,
        windows,
        tags: raftSession.tags,
        folderId: undefined, // Don't preserve folder associations on import
        source: 'import',
      }

      sessions.push(session)
      stats.sessionsCreated++
      stats.tabsImported += totalTabs
    }
  }

  return {
    success: sessions.length > 0 || parsed.sessions.length === 0,
    sessions,
    errors,
    warnings,
    stats,
    format: 'raft',
  }
}
