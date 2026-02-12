/**
 * Types for import/export functionality
 */

import type { Session } from '../types'

/**
 * Supported import formats
 */
export type ImportFormat = 'onetab' | 'sessionBuddy' | 'tabSessionManager' | 'toby' | 'raft'

/**
 * Individual import error with context
 */
export interface ImportError {
  /** Line number where error occurred (if applicable) */
  line?: number
  /** Error description */
  message: string
  /** Raw data that caused the error (if applicable) */
  raw?: string
}

/**
 * Statistics about an import operation
 */
export interface ImportStats {
  /** Total number of lines/entries processed */
  totalEntries: number
  /** Number of valid URLs found */
  validUrls: number
  /** Number of URLs skipped (invalid, protected, etc.) */
  skippedUrls: number
  /** Number of sessions created */
  sessionsCreated: number
  /** Total tabs imported across all sessions */
  tabsImported: number
}

/**
 * Result of an import operation
 */
export interface ImportResult {
  /** Whether the import succeeded (may have warnings but no fatal errors) */
  success: boolean
  /** Sessions created from the import */
  sessions: Session[]
  /** Errors that occurred (fatal or not) */
  errors: ImportError[]
  /** Non-fatal warnings */
  warnings: ImportError[]
  /** Statistics about the import */
  stats: ImportStats
  /** Detected format */
  format?: ImportFormat
}

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'text'

/**
 * Options for export operations
 */
export interface ExportOptions {
  /** Format to export as */
  format: ExportFormat
  /** Specific session IDs to export (all if not specified) */
  sessionIds?: string[]
}

/**
 * Statistics about an export operation
 */
export interface ExportStats {
  /** Number of sessions exported */
  sessionsExported: number
  /** Total tabs exported */
  tabsExported: number
  /** Total windows exported */
  windowsExported: number
}

/**
 * Result of an export operation
 */
export interface ExportResult {
  /** Whether the export succeeded */
  success: boolean
  /** Exported data as string */
  data: string
  /** Suggested filename for download */
  filename: string
  /** MIME type for the data */
  mimeType: string
  /** Statistics about the export */
  stats: ExportStats
}

/**
 * Raft export format (for JSON exports)
 */
export interface RaftExport {
  /** Export format version */
  version: string
  /** When the export was created */
  exportedAt: number
  /** Raft version that created the export */
  raftVersion: string
  /** Exported sessions */
  sessions: Session[]
}

// ============================================================
// External format types (for parsing)
// ============================================================

/**
 * Session Buddy link structure
 */
export interface SessionBuddyLink {
  url: string
  title?: string
  pinned?: boolean
}

/**
 * Session Buddy folder structure
 */
export interface SessionBuddyFolder {
  title?: string
  links?: SessionBuddyLink[]
}

/**
 * Session Buddy collection structure
 */
export interface SessionBuddyCollection {
  title?: string
  folders?: SessionBuddyFolder[]
}

/**
 * Session Buddy export format (Collections mode)
 */
export interface SessionBuddyExport {
  collections?: SessionBuddyCollection[]
}

/**
 * Session Buddy tab in sessions export
 */
export interface SessionBuddyTab {
  url: string
  title?: string
  pinned?: boolean
  favIconUrl?: string
  active?: boolean
}

/**
 * Session Buddy window in sessions export
 */
export interface SessionBuddyWindow {
  id?: number
  tabs?: SessionBuddyTab[]
}

/**
 * Session Buddy session in sessions export
 */
export interface SessionBuddySession {
  name?: string
  created?: string
  windows?: SessionBuddyWindow[]
}

/**
 * Session Buddy export format (Sessions + Windows mode)
 */
export interface SessionBuddySessionsExport {
  sessions?: SessionBuddySession[]
}

/**
 * Tab Session Manager tab structure
 */
export interface TSMTab {
  url: string
  title?: string
  pinned?: boolean
  favIconUrl?: string
}

/**
 * Tab Session Manager window structure (array format)
 */
export interface TSMWindow {
  tabs?: TSMTab[]
}

/**
 * Tab Session Manager session structure
 *
 * `windows` can be either:
 * - Array format: `TSMWindow[]` (older/alternative exports)
 * - Keyed object format: `Record<string, Record<string, TSMTab>>` (real TSM exports)
 */
export interface TSMSession {
  name?: string
  date?: number
  windows?: TSMWindow[] | Record<string, Record<string, TSMTab>>
  windowsNumber?: number
  tabsNumber?: number
  tag?: string[]
  sessionStartTime?: number
}

/**
 * Toby card structure
 */
export interface TobyCard {
  url: string
  title?: string
  customTitle?: string
}

/**
 * Toby list structure
 */
export interface TobyList {
  title?: string
  cards?: TobyCard[]
}

/**
 * Toby export format
 */
export interface TobyExport {
  lists?: TobyList[]
}
