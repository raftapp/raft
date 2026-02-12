/**
 * OneTab import parser
 *
 * OneTab format:
 * - Plain text with URL | Title per line
 * - Blank lines separate groups/windows
 *
 * Example:
 * https://example.com | Page Title
 * https://another.com | Another Title
 *
 * https://third.com | Third (blank line = new window)
 */

import { nanoid } from 'nanoid'
import type { Session, Tab, Window } from '../../types'
import type { ImportResult, ImportError, ImportStats } from '../types'
import { sanitizeUrl } from '../validators'

/**
 * Parse OneTab format content into Raft sessions
 */
export function parseOneTab(content: string): ImportResult {
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
      format: 'onetab',
    }
  }

  const lines = content.split('\n')
  const windows: Window[] = []
  let currentTabs: Tab[] = []
  let tabIndex = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lineNum = i + 1

    // Blank line = start new window (if current has tabs)
    if (!line) {
      if (currentTabs.length > 0) {
        windows.push({
          id: nanoid(),
          tabs: currentTabs,
          tabGroups: [],
        })
        currentTabs = []
        tabIndex = 0
      }
      continue
    }

    stats.totalEntries++

    // Parse line: URL | Title (title is optional)
    const parts = line.split('|')
    const rawUrl = parts[0].trim()
    const title = parts[1]?.trim() || ''

    // Validate and sanitize URL
    const url = sanitizeUrl(rawUrl)
    if (!url) {
      stats.skippedUrls++
      warnings.push({
        line: lineNum,
        message: `Skipped invalid or protected URL`,
        raw: rawUrl.substring(0, 100),
      })
      continue
    }

    stats.validUrls++

    // Create tab
    const tab: Tab = {
      id: nanoid(),
      url,
      title: title || url,
      index: tabIndex++,
      pinned: false,
    }

    currentTabs.push(tab)
  }

  // Don't forget the last window
  if (currentTabs.length > 0) {
    windows.push({
      id: nanoid(),
      tabs: currentTabs,
      tabGroups: [],
    })
  }

  // Create session if we have any windows
  const sessions: Session[] = []
  if (windows.length > 0) {
    const now = Date.now()
    const totalTabs = windows.reduce((sum, w) => sum + w.tabs.length, 0)

    const session: Session = {
      id: nanoid(),
      name: `OneTab Import (${totalTabs} tabs)`,
      createdAt: now,
      updatedAt: now,
      windows,
      source: 'import',
    }

    sessions.push(session)
    stats.sessionsCreated = 1
    stats.tabsImported = totalTabs
  }

  return {
    success: sessions.length > 0 || stats.totalEntries === 0,
    sessions,
    errors,
    warnings,
    stats,
    format: 'onetab',
  }
}
