/**
 * Validators for import/export functionality
 *
 * Handles format detection and URL validation
 */

import type { ImportFormat } from './types'
import { PROTECTED_URL_PATTERNS } from '../constants'

/**
 * Maximum import file size (10MB)
 */
export const MAX_IMPORT_SIZE = 10 * 1024 * 1024

/**
 * Check if a string is a valid HTTP/HTTPS URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }

  const trimmed = url.trim()
  if (!trimmed) {
    return false
  }

  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Check if a URL should be excluded from import (protected URLs)
 */
export function isProtectedUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase()
  return PROTECTED_URL_PATTERNS.some((pattern) => trimmed.startsWith(pattern.toLowerCase()))
}

/**
 * Sanitize and validate a URL for import
 * Returns null if URL is invalid or protected
 */
export function sanitizeUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null
  }

  const trimmed = url.trim()
  if (!trimmed) {
    return null
  }

  // Check if it's a protected URL
  if (isProtectedUrl(trimmed)) {
    return null
  }

  // Check if it's a valid URL
  if (!isValidUrl(trimmed)) {
    return null
  }

  return trimmed
}

/**
 * Detect the format of import content
 */
export function detectImportFormat(content: string): ImportFormat | null {
  if (!content || typeof content !== 'string') {
    return null
  }

  const trimmed = content.trim()
  if (!trimmed) {
    return null
  }

  // Try to parse as JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)

      // Check for Raft format (has version and raftVersion fields)
      if (parsed.version && parsed.raftVersion && Array.isArray(parsed.sessions)) {
        return 'raft'
      }

      // Check for Session Buddy format (collections or sessions export modes)
      if (parsed.collections && Array.isArray(parsed.collections)) {
        return 'sessionBuddy'
      }

      // Check for Session Buddy sessions format (sessions with windows arrays)
      // Must check before TSM since both have `windows`, but SB sessions is an
      // object with a `sessions` key while TSM is a top-level array
      if (parsed.sessions && Array.isArray(parsed.sessions)) {
        const hasSBSessionsSig = parsed.sessions.some(
          (session: unknown) =>
            typeof session === 'object' &&
            session !== null &&
            'windows' in session &&
            Array.isArray((session as { windows: unknown }).windows)
        )
        if (hasSBSessionsSig) {
          return 'sessionBuddy'
        }
      }

      // Check for Toby format (has lists array with cards)
      if (parsed.lists && Array.isArray(parsed.lists)) {
        const hasTobySig = parsed.lists.some(
          (list: unknown) =>
            typeof list === 'object' &&
            list !== null &&
            'cards' in list &&
            Array.isArray((list as { cards: unknown }).cards)
        )
        if (hasTobySig) {
          return 'toby'
        }
      }

      // Check for Tab Session Manager format (array of sessions with windows)
      // Windows can be either an array or a keyed object
      if (Array.isArray(parsed)) {
        const hasTSMSig = parsed.some(
          (session: unknown) =>
            typeof session === 'object' && session !== null && 'windows' in session
        )
        if (hasTSMSig) {
          return 'tabSessionManager'
        }
      }

      // Couldn't identify JSON format
      return null
    } catch {
      // Not valid JSON, try other formats
    }
  }

  // Check for OneTab format (plain text with URL | Title format)
  // OneTab format: URL | Title (one per line), blank lines separate groups
  const lines = trimmed.split('\n').filter((line) => line.trim())
  if (lines.length > 0) {
    // Check if at least some lines match OneTab pattern
    const oneTabPattern = /^https?:\/\/[^\s]+(\s*\|\s*.+)?$/
    const matchingLines = lines.filter((line) => oneTabPattern.test(line.trim()))

    // If more than half the non-empty lines match, consider it OneTab format
    if (matchingLines.length > 0 && matchingLines.length >= lines.length * 0.5) {
      return 'onetab'
    }
  }

  return null
}

/**
 * Validate import content before processing
 */
export function validateImportContent(content: string): {
  valid: boolean
  error?: string
  format?: ImportFormat
} {
  if (!content) {
    return { valid: false, error: 'No content provided' }
  }

  if (content.length > MAX_IMPORT_SIZE) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${MAX_IMPORT_SIZE / 1024 / 1024}MB`,
    }
  }

  const format = detectImportFormat(content)
  if (!format) {
    return {
      valid: false,
      error:
        'Unrecognized format. Supported formats: OneTab, Session Buddy, Tab Session Manager, Toby, Raft',
    }
  }

  return { valid: true, format }
}
