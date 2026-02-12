/**
 * Export functionality for Raft sessions
 *
 * Supports:
 * - JSON export (full Raft format with metadata)
 * - Text export (OneTab-compatible URL | Title format)
 */

import type { Session } from '../types'
import type { ExportOptions, ExportResult, ExportStats, RaftExport } from './types'
import { EXTENSION_VERSION } from '../constants'

/**
 * Export format version (for future migrations)
 */
const EXPORT_VERSION = '1.0'

/**
 * Export sessions as full Raft JSON format
 */
export function exportAsJson(sessions: Session[], sessionIds?: string[]): ExportResult {
  const sessionsToExport = sessionIds ? sessions.filter((s) => sessionIds.includes(s.id)) : sessions

  const stats: ExportStats = {
    sessionsExported: sessionsToExport.length,
    windowsExported: sessionsToExport.reduce((sum, s) => sum + s.windows.length, 0),
    tabsExported: sessionsToExport.reduce(
      (sum, s) => sum + s.windows.reduce((wSum, w) => wSum + w.tabs.length, 0),
      0
    ),
  }

  const exportData: RaftExport = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    raftVersion: EXTENSION_VERSION,
    sessions: sessionsToExport,
  }

  const data = JSON.stringify(exportData, null, 2)
  const date = new Date().toISOString().split('T')[0]

  return {
    success: true,
    data,
    filename: `raft-sessions-${date}.json`,
    mimeType: 'application/json',
    stats,
  }
}

/**
 * Export sessions as plain text (OneTab-compatible format)
 *
 * Format:
 * === Session Name ===
 * URL | Title
 * URL | Title
 *
 * === Another Session ===
 * ...
 */
export function exportAsText(sessions: Session[], sessionIds?: string[]): ExportResult {
  const sessionsToExport = sessionIds ? sessions.filter((s) => sessionIds.includes(s.id)) : sessions

  const stats: ExportStats = {
    sessionsExported: sessionsToExport.length,
    windowsExported: sessionsToExport.reduce((sum, s) => sum + s.windows.length, 0),
    tabsExported: sessionsToExport.reduce(
      (sum, s) => sum + s.windows.reduce((wSum, w) => wSum + w.tabs.length, 0),
      0
    ),
  }

  const lines: string[] = []

  for (const session of sessionsToExport) {
    // Session header
    lines.push(`=== ${session.name} ===`)
    lines.push('')

    for (let windowIndex = 0; windowIndex < session.windows.length; windowIndex++) {
      const window = session.windows[windowIndex]

      // Add window separator for multi-window sessions
      if (session.windows.length > 1 && windowIndex > 0) {
        lines.push('')
        lines.push(`--- Window ${windowIndex + 1} ---`)
        lines.push('')
      }

      for (const tab of window.tabs) {
        const title = tab.title || tab.url
        lines.push(`${tab.url} | ${title}`)
      }
    }

    lines.push('')
    lines.push('')
  }

  const data = lines.join('\n').trim()
  const date = new Date().toISOString().split('T')[0]

  return {
    success: true,
    data,
    filename: `raft-sessions-${date}.txt`,
    mimeType: 'text/plain',
    stats,
  }
}

/**
 * Export sessions based on options
 */
export function exportSessions(sessions: Session[], options: ExportOptions): ExportResult {
  if (options.format === 'json') {
    return exportAsJson(sessions, options.sessionIds)
  } else {
    return exportAsText(sessions, options.sessionIds)
  }
}

/**
 * Trigger file download in browser
 */
export function downloadExport(result: ExportResult): void {
  const blob = new globalThis.Blob([result.data], { type: result.mimeType })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = result.filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}
