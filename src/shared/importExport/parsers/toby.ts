/**
 * Toby import parser
 *
 * Toby format (JSON):
 * {
 *   "lists": [{
 *     "title": "Collection Name",
 *     "cards": [{ "url": "...", "title": "...", "customTitle": "..." }]
 *   }]
 * }
 */

import { nanoid } from 'nanoid'
import type { Session, Tab, Window } from '../../types'
import type { ImportResult, ImportError, ImportStats, TobyExport, TobyList } from '../types'
import { sanitizeUrl } from '../validators'

/**
 * Parse Toby format content into Raft sessions
 */
export function parseToby(content: string): ImportResult {
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
      format: 'toby',
    }
  }

  let parsed: TobyExport
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: `Invalid JSON: ${e instanceof Error ? e.message : 'Parse error'}` }],
      warnings: [],
      stats,
      format: 'toby',
    }
  }

  if (!parsed.lists || !Array.isArray(parsed.lists)) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: 'Invalid Toby format: missing lists array' }],
      warnings: [],
      stats,
      format: 'toby',
    }
  }

  const sessions: Session[] = []
  const now = Date.now()

  // In Toby, each list becomes a session with a single window
  for (let listIndex = 0; listIndex < parsed.lists.length; listIndex++) {
    const list: TobyList = parsed.lists[listIndex]
    const tabs: Tab[] = []

    if (!list.cards || !Array.isArray(list.cards)) {
      warnings.push({
        message: `List ${listIndex + 1} has no cards`,
      })
      continue
    }

    for (let cardIndex = 0; cardIndex < list.cards.length; cardIndex++) {
      const card = list.cards[cardIndex]
      stats.totalEntries++

      if (!card.url) {
        stats.skippedUrls++
        warnings.push({
          message: `Skipped card with no URL in list ${listIndex + 1}`,
        })
        continue
      }

      const url = sanitizeUrl(card.url)
      if (!url) {
        stats.skippedUrls++
        warnings.push({
          message: `Skipped invalid/protected URL in list ${listIndex + 1}`,
          raw: card.url.substring(0, 100),
        })
        continue
      }

      stats.validUrls++

      // Toby uses customTitle as user override, fall back to title
      const tab: Tab = {
        id: nanoid(),
        url,
        title: card.customTitle || card.title || url,
        index: tabs.length,
        pinned: false,
      }

      tabs.push(tab)
    }

    // Create session with single window if we have tabs
    if (tabs.length > 0) {
      const sessionName = list.title || `Toby Collection ${listIndex + 1}`

      const window: Window = {
        id: nanoid(),
        tabs,
        tabGroups: [],
      }

      const session: Session = {
        id: nanoid(),
        name: sessionName,
        createdAt: now,
        updatedAt: now,
        windows: [window],
        source: 'import',
      }

      sessions.push(session)
      stats.sessionsCreated++
      stats.tabsImported += tabs.length
    }
  }

  return {
    success: sessions.length > 0 || parsed.lists.length === 0,
    sessions,
    errors,
    warnings,
    stats,
    format: 'toby',
  }
}
