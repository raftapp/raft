/**
 * Deduplication Tests
 *
 * Tests for URL normalization and tab deduplication logic.
 * URL normalization strips trailing slashes and fragments for comparison.
 * Deduplication finds and closes duplicate tabs while respecting protection rules.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { normalizeUrlForDedup } from '@/shared/utils'
import { getDuplicateCount, closeDuplicates } from '@/background/deduplication'
import { addMockTab, addMockWindow, setMockStorage } from '../mocks/chrome'
import { STORAGE_KEYS } from '@/shared/constants'

describe('normalizeUrlForDedup', () => {
  it('should strip trailing slashes', () => {
    expect(normalizeUrlForDedup('https://example.com/page/')).toBe(
      'https://example.com/page'
    )
  })

  it('should preserve root trailing slash', () => {
    expect(normalizeUrlForDedup('https://example.com/')).toBe(
      'https://example.com/'
    )
  })

  it('should strip fragments', () => {
    expect(normalizeUrlForDedup('https://example.com/page#section')).toBe(
      'https://example.com/page'
    )
  })

  it('should preserve query params', () => {
    expect(normalizeUrlForDedup('https://example.com/page?q=test')).toBe(
      'https://example.com/page?q=test'
    )
  })

  it('should fall back to raw string on parse failure', () => {
    expect(normalizeUrlForDedup('not-a-url')).toBe('not-a-url')
  })

  it('should handle empty fragment', () => {
    expect(normalizeUrlForDedup('https://example.com/#')).toBe(
      'https://example.com/'
    )
  })
})

describe('getDuplicateCount', () => {
  beforeEach(() => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        suspension: { neverSuspendPinned: true, neverSuspendAudio: true },
        autoSave: { enabled: false },
        ui: { showBadge: true },
        exportReminder: { enabled: false },
      },
    })
  })

  it('should return 0 when no duplicates exist', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example' })
    addMockTab({ windowId: 1, url: 'https://other.com', title: 'Other' })

    const count = await getDuplicateCount()
    expect(count).toBe(0)
  })

  it('should return correct count for 2 tabs with same URL', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example 1' })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example 2' })

    const count = await getDuplicateCount()
    expect(count).toBe(1)
  })

  it('should count correctly across windows', async () => {
    addMockWindow({ id: 1 })
    addMockWindow({ id: 2 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example W1' })
    addMockTab({ windowId: 2, url: 'https://example.com', title: 'Example W2' })

    const count = await getDuplicateCount()
    expect(count).toBe(1)
  })

  it('should normalize URLs (trailing slash difference = same URL)', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com/page', title: 'Without slash' })
    addMockTab({ windowId: 1, url: 'https://example.com/page/', title: 'With slash' })

    const count = await getDuplicateCount()
    expect(count).toBe(1)
  })
})

describe('closeDuplicates', () => {
  beforeEach(() => {
    setMockStorage({
      [STORAGE_KEYS.SETTINGS]: {
        suspension: { neverSuspendPinned: true, neverSuspendAudio: true },
        autoSave: { enabled: false },
        ui: { showBadge: true },
        exportReminder: { enabled: false },
      },
    })
  })

  it('should close duplicate tabs and return correct result', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example 1' })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example 2' })

    const result = await closeDuplicates()

    expect(result.duplicatesFound).toBe(2)
    expect(result.tabsClosed).toBe(1)
    expect(result.protected).toBe(0)
  })

  it('should keep the active tab when both are duplicates', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Inactive', active: false })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Active', active: true })

    const result = await closeDuplicates()

    expect(result.tabsClosed).toBe(1)
    // The active tab should be kept (not closed)
    const remainingTabs = await chrome.tabs.query({})
    expect(remainingTabs.length).toBe(1)
    expect(remainingTabs[0].active).toBe(true)
  })

  it('should protect pinned tabs when neverSuspendPinned is true', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Normal', active: true })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Pinned', pinned: true })

    const result = await closeDuplicates()

    expect(result.duplicatesFound).toBe(2)
    expect(result.protected).toBe(1)
    expect(result.tabsClosed).toBe(0)
  })

  it('should protect audible tabs when neverSuspendAudio is true', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Normal', active: true })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Audible', audible: true })

    const result = await closeDuplicates()

    expect(result.duplicatesFound).toBe(2)
    expect(result.protected).toBe(1)
    expect(result.tabsClosed).toBe(0)
  })

  it('should skip protected URL patterns (chrome:// etc)', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'chrome://settings', title: 'Settings 1' })
    addMockTab({ windowId: 1, url: 'chrome://settings', title: 'Settings 2' })

    const result = await closeDuplicates()

    // Protected URLs are skipped in findDuplicateGroups entirely
    expect(result.duplicatesFound).toBe(0)
    expect(result.tabsClosed).toBe(0)
    expect(result.protected).toBe(0)
  })

  it('should return {duplicatesFound: 0, tabsClosed: 0, protected: 0} when no dupes', async () => {
    addMockWindow({ id: 1 })
    addMockTab({ windowId: 1, url: 'https://example.com', title: 'Example' })
    addMockTab({ windowId: 1, url: 'https://other.com', title: 'Other' })

    const result = await closeDuplicates()

    expect(result.duplicatesFound).toBe(0)
    expect(result.tabsClosed).toBe(0)
    expect(result.protected).toBe(0)
  })
})
