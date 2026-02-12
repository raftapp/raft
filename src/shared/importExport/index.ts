/**
 * Import/Export module for Raft
 *
 * Provides functionality for:
 * - Importing sessions from other tab managers (OneTab, Session Buddy, Tab Session Manager, Toby)
 * - Re-importing previously exported Raft sessions
 * - Exporting sessions as JSON or text
 */

// Re-export types
export * from './types'

// Re-export validators
export {
  MAX_IMPORT_SIZE,
  isValidUrl,
  isProtectedUrl,
  sanitizeUrl,
  detectImportFormat,
  validateImportContent,
} from './validators'

// Re-export parsers
export { parseOneTab } from './parsers/onetab'
export { parseSessionBuddy } from './parsers/sessionBuddy'
export { parseTabSessionManager } from './parsers/tabSessionManager'
export { parseToby } from './parsers/toby'
export { parseRaft } from './parsers/raft'

// Re-export exporters
export { exportAsJson, exportAsText, exportSessions, downloadExport } from './exporters'

// Main import function
import type { ImportResult, ImportFormat } from './types'
import { validateImportContent } from './validators'
import { parseOneTab } from './parsers/onetab'
import { parseSessionBuddy } from './parsers/sessionBuddy'
import { parseTabSessionManager } from './parsers/tabSessionManager'
import { parseToby } from './parsers/toby'
import { parseRaft } from './parsers/raft'

/**
 * Import content from any supported format
 *
 * Auto-detects format and parses accordingly
 */
export function importSessions(content: string): ImportResult {
  // Validate content first
  const validation = validateImportContent(content)

  if (!validation.valid) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: validation.error || 'Unknown validation error' }],
      warnings: [],
      stats: {
        totalEntries: 0,
        validUrls: 0,
        skippedUrls: 0,
        sessionsCreated: 0,
        tabsImported: 0,
      },
    }
  }

  // Route to appropriate parser based on detected format
  const format = validation.format!

  switch (format) {
    case 'onetab':
      return parseOneTab(content)
    case 'sessionBuddy':
      return parseSessionBuddy(content)
    case 'tabSessionManager':
      return parseTabSessionManager(content)
    case 'toby':
      return parseToby(content)
    case 'raft':
      return parseRaft(content)
    default:
      return {
        success: false,
        sessions: [],
        errors: [{ message: `Unsupported format: ${format}` }],
        warnings: [],
        stats: {
          totalEntries: 0,
          validUrls: 0,
          skippedUrls: 0,
          sessionsCreated: 0,
          tabsImported: 0,
        },
      }
  }
}

/**
 * Get human-readable format name
 */
export function getFormatDisplayName(format: ImportFormat): string {
  switch (format) {
    case 'onetab':
      return 'OneTab'
    case 'sessionBuddy':
      return 'Session Buddy'
    case 'tabSessionManager':
      return 'Tab Session Manager'
    case 'toby':
      return 'Toby'
    case 'raft':
      return 'Raft'
    default:
      return format
  }
}
