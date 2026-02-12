/**
 * Import/Export Tests
 *
 * Tests for importing sessions from various formats and exporting sessions.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'
import {
  detectImportFormat,
  validateImportContent,
  isValidUrl,
  isProtectedUrl,
  sanitizeUrl,
  parseOneTab,
  parseSessionBuddy,
  parseTabSessionManager,
  parseToby,
  parseRaft,
  importSessions,
  exportAsJson,
  exportAsText,
  getFormatDisplayName,
  MAX_IMPORT_SIZE,
} from '@/shared/importExport'

describe('validators', () => {
  describe('isValidUrl', () => {
    it('should accept valid http URLs', () => {
      expect(isValidUrl('http://example.com')).toBe(true)
      expect(isValidUrl('http://example.com/path')).toBe(true)
      expect(isValidUrl('http://example.com:8080/path?query=1')).toBe(true)
    })

    it('should accept valid https URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true)
      expect(isValidUrl('https://sub.example.com/path/to/page')).toBe(true)
    })

    it('should reject invalid URLs', () => {
      expect(isValidUrl('')).toBe(false)
      expect(isValidUrl('not a url')).toBe(false)
      expect(isValidUrl('example.com')).toBe(false)
      expect(isValidUrl('ftp://example.com')).toBe(false)
    })

    it('should reject non-string values', () => {
      expect(isValidUrl(null as unknown as string)).toBe(false)
      expect(isValidUrl(undefined as unknown as string)).toBe(false)
      expect(isValidUrl(123 as unknown as string)).toBe(false)
    })
  })

  describe('isProtectedUrl', () => {
    it('should detect chrome:// URLs', () => {
      expect(isProtectedUrl('chrome://extensions')).toBe(true)
      expect(isProtectedUrl('chrome://settings')).toBe(true)
    })

    it('should detect chrome-extension:// URLs', () => {
      expect(isProtectedUrl('chrome-extension://abc123/popup.html')).toBe(true)
    })

    it('should detect edge:// URLs', () => {
      expect(isProtectedUrl('edge://extensions')).toBe(true)
    })

    it('should detect about: URLs', () => {
      expect(isProtectedUrl('about:blank')).toBe(true)
    })

    it('should detect file:// URLs', () => {
      expect(isProtectedUrl('file:///home/user/file.html')).toBe(true)
    })

    it('should not flag normal URLs', () => {
      expect(isProtectedUrl('https://example.com')).toBe(false)
      expect(isProtectedUrl('http://localhost:3000')).toBe(false)
    })
  })

  describe('sanitizeUrl', () => {
    it('should return valid URLs unchanged', () => {
      expect(sanitizeUrl('https://example.com')).toBe('https://example.com')
    })

    it('should trim whitespace', () => {
      expect(sanitizeUrl('  https://example.com  ')).toBe('https://example.com')
    })

    it('should return null for invalid URLs', () => {
      expect(sanitizeUrl('not a url')).toBe(null)
      expect(sanitizeUrl('')).toBe(null)
    })

    it('should return null for protected URLs', () => {
      expect(sanitizeUrl('chrome://extensions')).toBe(null)
    })
  })

  describe('detectImportFormat', () => {
    it('should detect OneTab format', () => {
      const content = `https://example.com | Example Page
https://another.com | Another Page`
      expect(detectImportFormat(content)).toBe('onetab')
    })

    it('should detect Session Buddy format', () => {
      const content = JSON.stringify({
        collections: [{ title: 'Test', folders: [] }],
      })
      expect(detectImportFormat(content)).toBe('sessionBuddy')
    })

    it('should detect Tab Session Manager format (array windows)', () => {
      const content = JSON.stringify([
        { name: 'Session 1', windows: [{ tabs: [] }] },
      ])
      expect(detectImportFormat(content)).toBe('tabSessionManager')
    })

    it('should detect Tab Session Manager format (keyed windows)', () => {
      const content = JSON.stringify([
        { name: 'Session 1', windows: { 'win-1': { 'tab-1': { url: 'https://a.com' } } } },
      ])
      expect(detectImportFormat(content)).toBe('tabSessionManager')
    })

    it('should detect Session Buddy sessions format', () => {
      const content = JSON.stringify({
        sessions: [{ name: 'Session', windows: [{ tabs: [] }] }],
      })
      expect(detectImportFormat(content)).toBe('sessionBuddy')
    })

    it('should detect Toby format', () => {
      const content = JSON.stringify({
        lists: [{ title: 'List 1', cards: [] }],
      })
      expect(detectImportFormat(content)).toBe('toby')
    })

    it('should detect Raft format', () => {
      const content = JSON.stringify({
        version: '1.0',
        raftVersion: '0.1.0',
        sessions: [],
      })
      expect(detectImportFormat(content)).toBe('raft')
    })

    it('should return null for unrecognized content', () => {
      expect(detectImportFormat('')).toBe(null)
      expect(detectImportFormat('random text')).toBe(null)
      expect(detectImportFormat('{}')).toBe(null)
    })
  })

  describe('validateImportContent', () => {
    it('should accept valid content', () => {
      const content = `https://example.com | Example`
      const result = validateImportContent(content)
      expect(result.valid).toBe(true)
      expect(result.format).toBe('onetab')
    })

    it('should reject empty content', () => {
      const result = validateImportContent('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('No content provided')
    })

    it('should reject oversized content', () => {
      const content = 'x'.repeat(MAX_IMPORT_SIZE + 1)
      const result = validateImportContent(content)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('too large')
    })

    it('should reject unrecognized format', () => {
      const result = validateImportContent('random text without urls')
      expect(result.valid).toBe(false)
      expect(result.error).toContain('Unrecognized format')
    })
  })
})

describe('OneTab parser', () => {
  it('should parse simple OneTab content', () => {
    const content = `https://example.com | Example Page
https://another.com | Another Page`

    const result = parseOneTab(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].windows).toHaveLength(1)
    expect(result.sessions[0].windows[0].tabs).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs[0].url).toBe('https://example.com')
    expect(result.sessions[0].windows[0].tabs[0].title).toBe('Example Page')
  })

  it('should handle URLs without titles', () => {
    const content = `https://example.com`

    const result = parseOneTab(content)
    expect(result.success).toBe(true)
    expect(result.sessions[0].windows[0].tabs[0].title).toBe('https://example.com')
  })

  it('should split windows on blank lines', () => {
    const content = `https://example.com | Window 1 Tab

https://another.com | Window 2 Tab`

    const result = parseOneTab(content)
    expect(result.success).toBe(true)
    expect(result.sessions[0].windows).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs[0].title).toBe('Window 1 Tab')
    expect(result.sessions[0].windows[1].tabs[0].title).toBe('Window 2 Tab')
  })

  it('should skip invalid URLs with warnings', () => {
    const content = `https://example.com | Valid
invalid url
chrome://extensions`

    const result = parseOneTab(content)
    expect(result.success).toBe(true)
    expect(result.sessions[0].windows[0].tabs).toHaveLength(1)
    expect(result.warnings).toHaveLength(2)
    expect(result.stats.validUrls).toBe(1)
    expect(result.stats.skippedUrls).toBe(2)
  })

  it('should mark sessions as imported', () => {
    const content = `https://example.com | Test`
    const result = parseOneTab(content)
    expect(result.sessions[0].source).toBe('import')
  })
})

describe('Session Buddy parser', () => {
  it('should parse Session Buddy format', () => {
    const content = JSON.stringify({
      collections: [{
        title: 'My Collection',
        folders: [{
          links: [
            { url: 'https://example.com', title: 'Example', pinned: true },
            { url: 'https://another.com', title: 'Another' },
          ],
        }],
      }],
    })

    const result = parseSessionBuddy(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].name).toBe('My Collection')
    expect(result.sessions[0].windows[0].tabs).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs[0].pinned).toBe(true)
  })

  it('should create multiple sessions from multiple collections', () => {
    const content = JSON.stringify({
      collections: [
        { title: 'Collection 1', folders: [{ links: [{ url: 'https://a.com' }] }] },
        { title: 'Collection 2', folders: [{ links: [{ url: 'https://b.com' }] }] },
      ],
    })

    const result = parseSessionBuddy(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(2)
  })

  it('should handle invalid JSON', () => {
    const result = parseSessionBuddy('not valid json')
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('Invalid JSON')
  })

  it('should handle missing collections or sessions', () => {
    const result = parseSessionBuddy('{}')
    expect(result.success).toBe(false)
    expect(result.errors[0].message).toContain('missing collections or sessions')
  })
})

describe('Tab Session Manager parser', () => {
  it('should parse Tab Session Manager format', () => {
    const content = JSON.stringify([{
      name: 'My Session',
      date: 1609459200000,
      windows: [{
        tabs: [
          { url: 'https://example.com', title: 'Example', pinned: true },
          { url: 'https://another.com', title: 'Another', favIconUrl: 'https://favicon.ico' },
        ],
      }],
    }])

    const result = parseTabSessionManager(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].name).toBe('My Session')
    expect(result.sessions[0].createdAt).toBe(1609459200000)
    expect(result.sessions[0].windows[0].tabs).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs[1].favIconUrl).toBe('https://favicon.ico')
  })

  it('should handle multiple sessions', () => {
    const content = JSON.stringify([
      { name: 'Session 1', windows: [{ tabs: [{ url: 'https://a.com' }] }] },
      { name: 'Session 2', windows: [{ tabs: [{ url: 'https://b.com' }] }] },
    ])

    const result = parseTabSessionManager(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(2)
  })

  it('should handle invalid JSON', () => {
    const result = parseTabSessionManager('not valid json')
    expect(result.success).toBe(false)
    expect(result.errors[0].message).toContain('Invalid JSON')
  })
})

describe('Toby parser', () => {
  it('should parse Toby format', () => {
    const content = JSON.stringify({
      lists: [{
        title: 'My List',
        cards: [
          { url: 'https://example.com', title: 'Example', customTitle: 'Custom' },
          { url: 'https://another.com', title: 'Another' },
        ],
      }],
    })

    const result = parseToby(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].name).toBe('My List')
    expect(result.sessions[0].windows[0].tabs).toHaveLength(2)
    // Should prefer customTitle over title
    expect(result.sessions[0].windows[0].tabs[0].title).toBe('Custom')
    expect(result.sessions[0].windows[0].tabs[1].title).toBe('Another')
  })

  it('should create one session per list', () => {
    const content = JSON.stringify({
      lists: [
        { title: 'List 1', cards: [{ url: 'https://a.com' }] },
        { title: 'List 2', cards: [{ url: 'https://b.com' }] },
      ],
    })

    const result = parseToby(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(2)
  })
})

describe('Raft parser', () => {
  it('should parse Raft export format', () => {
    const content = JSON.stringify({
      version: '1.0',
      raftVersion: '0.1.0',
      exportedAt: 1609459200000,
      sessions: [{
        id: 'old-id',
        name: 'Test Session',
        createdAt: 1609459200000,
        updatedAt: 1609459200000,
        windows: [{
          id: 'old-window-id',
          tabs: [
            { id: 'old-tab-id', url: 'https://example.com', title: 'Example', index: 0, pinned: true },
          ],
          tabGroups: [{
            id: 'old-group-id',
            title: 'Group',
            color: 'blue',
            collapsed: false,
          }],
        }],
        source: 'manual',
      }],
    })

    const result = parseRaft(content)
    expect(result.success).toBe(true)
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].name).toBe('Test Session')
    // Should have new IDs
    expect(result.sessions[0].id).not.toBe('old-id')
    // Source should be import
    expect(result.sessions[0].source).toBe('import')
    // Tab data preserved
    expect(result.sessions[0].windows[0].tabs[0].pinned).toBe(true)
    // Tab groups preserved
    expect(result.sessions[0].windows[0].tabGroups).toHaveLength(1)
  })

  it('should handle missing version info', () => {
    const content = JSON.stringify({ sessions: [] })
    const result = parseRaft(content)
    expect(result.success).toBe(false)
    expect(result.errors[0].message).toContain('missing version')
  })
})

describe('importSessions', () => {
  it('should auto-detect and parse OneTab format', () => {
    const content = `https://example.com | Example`
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('onetab')
  })

  it('should auto-detect and parse JSON formats', () => {
    const content = JSON.stringify({
      collections: [{ title: 'Test', folders: [{ links: [{ url: 'https://a.com' }] }] }],
    })
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('sessionBuddy')
  })

  it('should return error for invalid content', () => {
    const result = importSessions('')
    expect(result.success).toBe(false)
    expect(result.errors).toHaveLength(1)
  })
})

describe('exporters', () => {
  const createTestSession = (id: string, name: string) => ({
    id,
    name,
    createdAt: 1609459200000,
    updatedAt: 1609459200000,
    windows: [{
      id: 'window-1',
      tabs: [
        { id: 'tab-1', url: 'https://example.com', title: 'Example', index: 0, pinned: false },
        { id: 'tab-2', url: 'https://another.com', title: 'Another', index: 1, pinned: true },
      ],
      tabGroups: [],
    }],
    source: 'manual' as const,
  })

  describe('exportAsJson', () => {
    it('should export all sessions as JSON', () => {
      const sessions = [createTestSession('1', 'Session 1'), createTestSession('2', 'Session 2')]
      const result = exportAsJson(sessions)

      expect(result.success).toBe(true)
      expect(result.mimeType).toBe('application/json')
      expect(result.filename).toMatch(/^raft-sessions-\d{4}-\d{2}-\d{2}\.json$/)

      const parsed = JSON.parse(result.data)
      expect(parsed.version).toBe('1.0')
      expect(parsed.raftVersion).toBeDefined()
      expect(parsed.sessions).toHaveLength(2)
      expect(parsed.exportedAt).toBeGreaterThan(0)
    })

    it('should export selected sessions only', () => {
      const sessions = [createTestSession('1', 'Session 1'), createTestSession('2', 'Session 2')]
      const result = exportAsJson(sessions, ['1'])

      const parsed = JSON.parse(result.data)
      expect(parsed.sessions).toHaveLength(1)
      expect(parsed.sessions[0].name).toBe('Session 1')
    })

    it('should report correct stats', () => {
      const sessions = [createTestSession('1', 'Session 1')]
      const result = exportAsJson(sessions)

      expect(result.stats.sessionsExported).toBe(1)
      expect(result.stats.windowsExported).toBe(1)
      expect(result.stats.tabsExported).toBe(2)
    })
  })

  describe('exportAsText', () => {
    it('should export as OneTab-compatible text', () => {
      const sessions = [createTestSession('1', 'Session 1')]
      const result = exportAsText(sessions)

      expect(result.success).toBe(true)
      expect(result.mimeType).toBe('text/plain')
      expect(result.filename).toMatch(/^raft-sessions-\d{4}-\d{2}-\d{2}\.txt$/)

      expect(result.data).toContain('=== Session 1 ===')
      expect(result.data).toContain('https://example.com | Example')
      expect(result.data).toContain('https://another.com | Another')
    })

    it('should add window separators for multi-window sessions', () => {
      const session = {
        ...createTestSession('1', 'Multi Window'),
        windows: [
          { id: 'w1', tabs: [{ id: 't1', url: 'https://a.com', title: 'A', index: 0, pinned: false }], tabGroups: [] },
          { id: 'w2', tabs: [{ id: 't2', url: 'https://b.com', title: 'B', index: 0, pinned: false }], tabGroups: [] },
        ],
      }
      const result = exportAsText([session])

      expect(result.data).toContain('--- Window 2 ---')
    })

    it('should export selected sessions only', () => {
      const sessions = [createTestSession('1', 'Session 1'), createTestSession('2', 'Session 2')]
      const result = exportAsText(sessions, ['2'])

      expect(result.data).not.toContain('Session 1')
      expect(result.data).toContain('Session 2')
    })
  })
})

describe('getFormatDisplayName', () => {
  it('should return human-readable names', () => {
    expect(getFormatDisplayName('onetab')).toBe('OneTab')
    expect(getFormatDisplayName('sessionBuddy')).toBe('Session Buddy')
    expect(getFormatDisplayName('tabSessionManager')).toBe('Tab Session Manager')
    expect(getFormatDisplayName('toby')).toBe('Toby')
    expect(getFormatDisplayName('raft')).toBe('Raft')
  })
})

// ============================================================
// Fixture-based tests — realistic export files from each tool
// ============================================================

function loadFixture(filename: string): string {
  return readFileSync(resolve(__dirname, '../fixtures', filename), 'utf-8')
}

describe('fixture: OneTab', () => {
  const content = loadFixture('onetab.txt')

  it('should auto-detect as onetab format', () => {
    expect(detectImportFormat(content)).toBe('onetab')
  })

  it('should parse all groups and tabs', () => {
    const result = parseOneTab(content)
    expect(result.success).toBe(true)
    // 3 groups separated by blank lines → 3 windows
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0].windows).toHaveLength(3)
    // Group 1: 3 tabs, Group 2: 2 tabs, Group 3: 2 tabs
    expect(result.sessions[0].windows[0].tabs).toHaveLength(3)
    expect(result.sessions[0].windows[1].tabs).toHaveLength(2)
    expect(result.sessions[0].windows[2].tabs).toHaveLength(2)
    expect(result.stats.tabsImported).toBe(7)
  })

  it('should preserve titles and handle URLs without titles', () => {
    const result = parseOneTab(content)
    const group1 = result.sessions[0].windows[0].tabs
    expect(group1[0].title).toBe('OneTab - Share and Export')
    expect(group1[0].url).toBe('https://github.com/nicedoc/onetab')

    // URL with query params
    expect(group1[2].url).toContain('?rq=1')

    // URL without title in group 3
    const group3 = result.sessions[0].windows[2].tabs
    expect(group3[0].title).toBe('https://example.com')
  })

  it('should round-trip through importSessions', () => {
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('onetab')
    expect(result.stats.tabsImported).toBe(7)
  })
})

describe('fixture: Session Buddy (collections)', () => {
  const content = loadFixture('session-buddy-collections.json')

  it('should auto-detect as sessionBuddy format', () => {
    expect(detectImportFormat(content)).toBe('sessionBuddy')
  })

  it('should parse collections into sessions', () => {
    const result = parseSessionBuddy(content)
    expect(result.success).toBe(true)
    // 2 collections → 2 sessions
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0].name).toBe('Research Tabs')
    expect(result.sessions[1].name).toBe('Shopping')
  })

  it('should map folders to windows', () => {
    const result = parseSessionBuddy(content)
    // Research Tabs: 2 folders → 2 windows
    expect(result.sessions[0].windows).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs).toHaveLength(2)
    expect(result.sessions[0].windows[1].tabs).toHaveLength(1)
    // Shopping: 1 folder → 1 window
    expect(result.sessions[1].windows).toHaveLength(1)
    expect(result.sessions[1].windows[0].tabs).toHaveLength(2)
  })

  it('should capture favIconUrl and pinned status', () => {
    const result = parseSessionBuddy(content)
    const tab0 = result.sessions[0].windows[0].tabs[0]
    expect(tab0.favIconUrl).toBe('https://developer.mozilla.org/favicon.ico')
    expect(tab0.pinned).toBe(true)
    expect(tab0.title).toBe('JavaScript | MDN')
  })

  it('should handle total tab count correctly', () => {
    const result = parseSessionBuddy(content)
    // 2 + 1 + 2 = 5 tabs total
    expect(result.stats.tabsImported).toBe(5)
    expect(result.stats.validUrls).toBe(5)
  })
})

describe('fixture: Session Buddy (sessions)', () => {
  const content = loadFixture('session-buddy-sessions.json')

  it('should auto-detect as sessionBuddy format', () => {
    expect(detectImportFormat(content)).toBe('sessionBuddy')
  })

  it('should parse sessions with windows and tabs', () => {
    const result = parseSessionBuddy(content)
    expect(result.success).toBe(true)
    // 2 sessions
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0].name).toBe('Work Session')
    expect(result.sessions[1].name).toBe('Reading List')
  })

  it('should preserve window structure', () => {
    const result = parseSessionBuddy(content)
    // Work Session: 2 windows
    expect(result.sessions[0].windows).toHaveLength(2)
    expect(result.sessions[0].windows[0].tabs).toHaveLength(3)
    expect(result.sessions[0].windows[1].tabs).toHaveLength(2)
    // Reading List: 1 window
    expect(result.sessions[1].windows).toHaveLength(1)
    expect(result.sessions[1].windows[0].tabs).toHaveLength(2)
  })

  it('should capture favIconUrl and pinned status', () => {
    const result = parseSessionBuddy(content)
    const tab0 = result.sessions[0].windows[0].tabs[0]
    expect(tab0.favIconUrl).toBe('https://github.com/favicon.ico')
    expect(tab0.pinned).toBe(true)
    expect(tab0.url).toBe('https://github.com/notifications')
  })

  it('should handle total tab count correctly', () => {
    const result = parseSessionBuddy(content)
    // 3 + 2 + 2 = 7 tabs total
    expect(result.stats.tabsImported).toBe(7)
  })

  it('should round-trip through importSessions', () => {
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('sessionBuddy')
    expect(result.sessions).toHaveLength(2)
  })
})

describe('fixture: Tab Session Manager (keyed objects)', () => {
  const content = loadFixture('tab-session-manager.json')

  it('should auto-detect as tabSessionManager format', () => {
    expect(detectImportFormat(content)).toBe('tabSessionManager')
  })

  it('should parse keyed windows and tabs', () => {
    const result = parseTabSessionManager(content)
    expect(result.success).toBe(true)
    // 2 sessions
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0].name).toBe('Development')
    expect(result.sessions[1].name).toBe('Research')
  })

  it('should map keyed windows correctly', () => {
    const result = parseTabSessionManager(content)
    // Development: 2 windows (window-100: 3 tabs, window-200: 2 tabs)
    expect(result.sessions[0].windows).toHaveLength(2)
    const win1TabCount = result.sessions[0].windows[0].tabs.length
    const win2TabCount = result.sessions[0].windows[1].tabs.length
    expect(win1TabCount + win2TabCount).toBe(5)
    // Research: 1 window with 2 tabs
    expect(result.sessions[1].windows).toHaveLength(1)
    expect(result.sessions[1].windows[0].tabs).toHaveLength(2)
  })

  it('should preserve date, favIconUrl, and pinned status', () => {
    const result = parseTabSessionManager(content)
    expect(result.sessions[0].createdAt).toBe(1707580800000)

    // Find the pinned tab (github.com)
    const allTabs = result.sessions[0].windows.flatMap((w) => w.tabs)
    const pinnedTab = allTabs.find((t) => t.pinned)
    expect(pinnedTab).toBeDefined()
    expect(pinnedTab!.url).toBe('https://github.com/nicedoc/onetab')
    expect(pinnedTab!.favIconUrl).toBe('https://github.com/favicon.ico')
  })

  it('should handle total tab count correctly', () => {
    const result = parseTabSessionManager(content)
    // 5 + 2 = 7 tabs total
    expect(result.stats.tabsImported).toBe(7)
    expect(result.stats.validUrls).toBe(7)
  })

  it('should round-trip through importSessions', () => {
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('tabSessionManager')
    expect(result.sessions).toHaveLength(2)
  })
})

describe('fixture: Toby', () => {
  const content = loadFixture('toby.json')

  it('should auto-detect as toby format', () => {
    expect(detectImportFormat(content)).toBe('toby')
  })

  it('should parse lists into sessions', () => {
    const result = parseToby(content)
    expect(result.success).toBe(true)
    // 2 lists → 2 sessions
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0].name).toBe('Frontend Tools')
    expect(result.sessions[1].name).toBe('Documentation')
  })

  it('should prefer customTitle over title', () => {
    const result = parseToby(content)
    const tabs = result.sessions[0].windows[0].tabs
    // First card has customTitle "Vite"
    expect(tabs[0].title).toBe('Vite')
    // Second card has empty customTitle, should use title
    expect(tabs[1].title).toBe(
      'Tailwind CSS - Rapidly build modern websites without ever leaving your HTML.'
    )
    // Third card has no customTitle, should use title
    expect(tabs[2].title).toBe('Preact - Fast 3kB alternative to React')
  })

  it('should handle total tab count correctly', () => {
    const result = parseToby(content)
    // 3 + 2 = 5 tabs total
    expect(result.stats.tabsImported).toBe(5)
  })

  it('should round-trip through importSessions', () => {
    const result = importSessions(content)
    expect(result.success).toBe(true)
    expect(result.format).toBe('toby')
    expect(result.sessions).toHaveLength(2)
  })
})
