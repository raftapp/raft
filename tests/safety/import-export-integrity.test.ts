/**
 * Import/Export Integrity Safety Tests
 *
 * Proves that data travels safely between formats without loss.
 */

import { describe, it, expect } from 'vitest'
import { nanoid } from 'nanoid'
import { exportAsJson, exportAsText } from '@/shared/importExport/exporters'
import { parseRaft } from '@/shared/importExport/parsers/raft'
import { parseOneTab } from '@/shared/importExport/parsers/onetab'
import { parseSessionBuddy } from '@/shared/importExport/parsers/sessionBuddy'
import { parseTabSessionManager } from '@/shared/importExport/parsers/tabSessionManager'
import { parseToby } from '@/shared/importExport/parsers/toby'
import { importSessions } from '@/shared/importExport'
import type { Session } from '@/shared/types'
import { buildSession, assertSessionFidelity } from './helpers'

function buildComplexSession(): Session {
  const groupId1 = nanoid()
  const groupId2 = nanoid()
  return {
    id: nanoid(),
    name: 'Complex Session',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    windows: [
      {
        id: nanoid(),
        tabs: [
          { id: nanoid(), url: 'https://github.com/repo', title: 'GitHub Repo', index: 0, pinned: true, favIconUrl: 'https://github.com/favicon.ico', groupId: groupId1 },
          { id: nanoid(), url: 'https://docs.google.com/doc', title: 'Project Doc', index: 1, pinned: false, groupId: groupId1, discarded: true },
          { id: nanoid(), url: 'https://stackoverflow.com/q/1', title: 'SO Answer', index: 2, pinned: false, favIconUrl: 'https://cdn.sstatic.net/favicon.ico' },
        ],
        tabGroups: [
          { id: groupId1, title: 'Development', color: 'blue', collapsed: false },
        ],
        focused: true,
        state: 'maximized',
      },
      {
        id: nanoid(),
        tabs: [
          { id: nanoid(), url: 'https://mail.google.com', title: 'Gmail', index: 0, pinned: true },
          { id: nanoid(), url: 'https://calendar.google.com', title: 'Calendar', index: 1, pinned: false, groupId: groupId2 },
        ],
        tabGroups: [
          { id: groupId2, title: 'Google Suite', color: 'red', collapsed: true },
        ],
        state: 'normal',
      },
    ],
    source: 'manual',
  }
}

describe('Your data travels safely between formats', () => {
  describe('Raft JSON round-trip preserves all data', () => {
    it('complex session survives export -> re-import', () => {
      const original = buildComplexSession()
      const exported = exportAsJson([original])

      expect(exported.success).toBe(true)

      const imported = parseRaft(exported.data)
      expect(imported.success).toBe(true)
      expect(imported.sessions).toHaveLength(1)

      assertSessionFidelity(original, imported.sessions[0])
    })

    it('tab groups, pins, URLs preserved through round-trip', () => {
      const original = buildComplexSession()
      const exported = exportAsJson([original])
      const imported = parseRaft(exported.data)

      const allOrigTabs = original.windows.flatMap((w) => w.tabs)
      const allImportedTabs = imported.sessions[0].windows.flatMap((w) => w.tabs)

      // Every original URL appears in the import
      for (const origTab of allOrigTabs) {
        const match = allImportedTabs.find((t) => t.url === origTab.url)
        expect(match).toBeDefined()
        expect(match!.pinned).toBe(origTab.pinned)
        expect(match!.title).toBe(origTab.title)
      }

      // Tab group properties preserved
      const origGroups = original.windows.flatMap((w) => w.tabGroups)
      const importedGroups = imported.sessions[0].windows.flatMap((w) => w.tabGroups)
      expect(importedGroups).toHaveLength(origGroups.length)

      for (const origGroup of origGroups) {
        const match = importedGroups.find((g) => g.title === origGroup.title)
        expect(match).toBeDefined()
        expect(match!.color).toBe(origGroup.color)
        expect(match!.collapsed).toBe(origGroup.collapsed)
      }
    })

    it('multiple sessions round-trip together', () => {
      const sessions = [
        buildSession('s1', { name: 'Session One' }),
        buildSession('s2', { name: 'Session Two' }),
        buildComplexSession(),
      ]

      const exported = exportAsJson(sessions)
      expect(exported.stats.sessionsExported).toBe(3)

      const imported = parseRaft(exported.data)
      expect(imported.success).toBe(true)
      expect(imported.sessions).toHaveLength(3)
      expect(imported.sessions.map((s) => s.name)).toEqual(
        expect.arrayContaining(['Session One', 'Session Two', 'Complex Session'])
      )
    })
  })

  describe('Text export is re-importable', () => {
    it('text export creates valid OneTab format that re-imports', () => {
      const session = buildSession('s1', {
        name: 'Text Test',
        windows: [{
          id: nanoid(),
          tabs: [
            { id: nanoid(), url: 'https://example.com', title: 'Example', index: 0, pinned: false },
            { id: nanoid(), url: 'https://test.com', title: 'Test', index: 1, pinned: false },
          ],
          tabGroups: [],
        }],
      })

      const exported = exportAsText([session])
      expect(exported.success).toBe(true)

      // The text output should be parseable as OneTab format
      const imported = parseOneTab(exported.data)
      expect(imported.success).toBe(true)
      expect(imported.stats.validUrls).toBe(2)
    })

    it('all URLs survive text export/import cycle', () => {
      const urls = [
        'https://github.com/anthropics',
        'https://docs.google.com/document/d/abc',
        'https://en.wikipedia.org/wiki/Special:Search?search=test',
      ]

      const session = buildSession('s1', {
        windows: [{
          id: nanoid(),
          tabs: urls.map((url, i) => ({
            id: nanoid(),
            url,
            title: `Tab ${i}`,
            index: i,
            pinned: false,
          })),
          tabGroups: [],
        }],
      })

      const exported = exportAsText([session])
      const imported = parseOneTab(exported.data)

      expect(imported.success).toBe(true)
      const importedUrls = imported.sessions[0].windows.flatMap((w) => w.tabs.map((t) => t.url))
      for (const url of urls) {
        expect(importedUrls).toContain(url)
      }
    })

    it('multi-window sessions use correct separators', () => {
      const session = buildSession('s1', {
        name: 'Multi-Window',
        windows: [
          {
            id: nanoid(),
            tabs: [{ id: nanoid(), url: 'https://w1.com', title: 'Win 1', index: 0, pinned: false }],
            tabGroups: [],
          },
          {
            id: nanoid(),
            tabs: [{ id: nanoid(), url: 'https://w2.com', title: 'Win 2', index: 0, pinned: false }],
            tabGroups: [],
          },
        ],
      })

      const exported = exportAsText([session])
      expect(exported.data).toContain('--- Window 2 ---')
      expect(exported.data).toContain('https://w1.com')
      expect(exported.data).toContain('https://w2.com')
    })
  })

  describe('Imports from other tab managers', () => {
    it('OneTab data with URLs and titles', () => {
      const oneTabData = [
        'https://github.com | GitHub',
        'https://google.com | Google',
        '',
        'https://reddit.com | Reddit',
      ].join('\n')

      const result = parseOneTab(oneTabData)

      expect(result.success).toBe(true)
      expect(result.stats.validUrls).toBe(3)
      expect(result.sessions).toHaveLength(1)
      // Blank line creates second window
      expect(result.sessions[0].windows).toHaveLength(2)
    })

    it('Session Buddy collections with pinned state', () => {
      const sbData = JSON.stringify({
        collections: [{
          title: 'My Collection',
          folders: [{
            links: [
              { url: 'https://github.com', title: 'GitHub', pinned: true },
              { url: 'https://google.com', title: 'Google', pinned: false },
            ],
          }],
        }],
      })

      const result = parseSessionBuddy(sbData)

      expect(result.success).toBe(true)
      expect(result.stats.validUrls).toBe(2)
      const tabs = result.sessions[0].windows[0].tabs
      expect(tabs[0].pinned).toBe(true)
      expect(tabs[1].pinned).toBe(false)
    })

    it('Tab Session Manager sessions with timestamps', () => {
      const tsmData = JSON.stringify([{
        name: 'TSM Session',
        date: 1700000000000,
        windows: [{
          tabs: [
            { url: 'https://github.com', title: 'GitHub', favIconUrl: 'https://github.com/favicon.ico' },
            { url: 'https://google.com', title: 'Google' },
          ],
        }],
      }])

      const result = parseTabSessionManager(tsmData)

      expect(result.success).toBe(true)
      expect(result.sessions[0].name).toBe('TSM Session')
      expect(result.sessions[0].createdAt).toBe(1700000000000)
      expect(result.stats.validUrls).toBe(2)
    })

    it('Toby lists with custom titles', () => {
      const tobyData = JSON.stringify({
        lists: [{
          title: 'Dev Resources',
          cards: [
            { url: 'https://vitejs.dev', title: 'Vite', customTitle: 'Vite Build Tool' },
            { url: 'https://preactjs.com', title: 'Preact' },
          ],
        }],
      })

      const result = parseToby(tobyData)

      expect(result.success).toBe(true)
      expect(result.sessions[0].name).toBe('Dev Resources')
      // customTitle takes precedence
      expect(result.sessions[0].windows[0].tabs[0].title).toBe('Vite Build Tool')
      expect(result.sessions[0].windows[0].tabs[1].title).toBe('Preact')
    })
  })

  describe('Malformed input is handled safely', () => {
    it('rejects empty input without crashing', () => {
      const result = importSessions('')
      expect(result.success).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects truncated JSON without crashing', () => {
      const result = importSessions('{"version":"1.0","raftVer')
      expect(result.success).toBe(false)
    })

    it('rejects oversized input', () => {
      const huge = 'x'.repeat(11 * 1024 * 1024) // 11MB, over 10MB limit
      const result = importSessions(huge)
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toContain('too large')
    })

    it('rejects javascript: URLs in import data', () => {
      const malicious = 'javascript:alert(1) | Malicious\nhttps://safe.com | Safe'
      const result = parseOneTab(malicious)

      // Only the safe URL should be imported
      expect(result.stats.validUrls).toBe(1)
      expect(result.stats.skippedUrls).toBe(1)
      const urls = result.sessions[0].windows.flatMap((w) => w.tabs.map((t) => t.url))
      expect(urls).not.toContain('javascript:alert(1)')
      expect(urls).toContain('https://safe.com')
    })

    it('handles mix of valid and invalid URLs gracefully', () => {
      const mixed = [
        'https://valid1.com | Valid 1',
        'not-a-url',
        'https://valid2.com | Valid 2',
        'chrome://extensions',
        'https://valid3.com | Valid 3',
      ].join('\n')

      const result = parseOneTab(mixed)

      expect(result.success).toBe(true)
      expect(result.stats.validUrls).toBe(3)
      expect(result.stats.skippedUrls).toBe(2)
    })
  })
})
