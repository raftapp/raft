/**
 * Tests for shared utility functions
 *
 * Tests formatRelativeTime, formatDate, isSafeFaviconUrl, getSafeFaviconUrl,
 * debounce, and getFallbackFaviconDataUri.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  formatRelativeTime,
  formatDate,
  isSafeFaviconUrl,
  getSafeFaviconUrl,
  debounce,
  getFallbackFaviconDataUri,
} from '@/shared/utils'

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return "Just now" for timestamps less than 1 minute ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    expect(formatRelativeTime(now)).toBe('Just now')
    expect(formatRelativeTime(now - 30000)).toBe('Just now') // 30 seconds ago
    expect(formatRelativeTime(now - 59000)).toBe('Just now') // 59 seconds ago
  })

  it('should return minutes ago for timestamps 1-59 minutes ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    expect(formatRelativeTime(now - 60000)).toBe('1m ago')
    expect(formatRelativeTime(now - 120000)).toBe('2m ago')
    expect(formatRelativeTime(now - 59 * 60000)).toBe('59m ago')
  })

  it('should return hours ago for timestamps 1-23 hours ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    expect(formatRelativeTime(now - 60 * 60000)).toBe('1h ago')
    expect(formatRelativeTime(now - 2 * 60 * 60000)).toBe('2h ago')
    expect(formatRelativeTime(now - 23 * 60 * 60000)).toBe('23h ago')
  })

  it('should return "Yesterday" for timestamps 24-47 hours ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    expect(formatRelativeTime(now - 24 * 60 * 60000)).toBe('Yesterday')
    expect(formatRelativeTime(now - 36 * 60 * 60000)).toBe('Yesterday')
    expect(formatRelativeTime(now - 47 * 60 * 60000)).toBe('Yesterday')
  })

  it('should return days ago for timestamps 2-6 days ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    expect(formatRelativeTime(now - 2 * 24 * 60 * 60000)).toBe('2d ago')
    expect(formatRelativeTime(now - 3 * 24 * 60 * 60000)).toBe('3d ago')
    expect(formatRelativeTime(now - 6 * 24 * 60 * 60000)).toBe('6d ago')
  })

  it('should return date string for timestamps 7+ days ago', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const sevenDaysAgo = now - 7 * 24 * 60 * 60000
    const result = formatRelativeTime(sevenDaysAgo)

    // Should be a locale date string, not relative time
    expect(result).not.toContain('ago')
    expect(result).not.toBe('Just now')
    expect(result).not.toBe('Yesterday')
  })

  it('should handle timestamps in the future', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    // Future timestamps should return "Just now" due to negative diff
    expect(formatRelativeTime(now + 60000)).toBe('Just now')
  })

  it('should handle timestamp 0', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const result = formatRelativeTime(0)
    // Should be a date string from 1970
    expect(result).not.toContain('ago')
  })
})

describe('formatDate', () => {
  it('should format a known date correctly', () => {
    // Use a fixed date and check for expected components
    const timestamp = new Date('2024-01-15T10:30:00').getTime()
    const result = formatDate(timestamp)

    // The formatted date should contain the year, month, and day
    expect(result).toContain('2024')
    expect(result).toMatch(/Jan|1/) // Month as Jan or 1
    expect(result).toMatch(/15/) // Day
  })

  it('should format dates consistently', () => {
    // Use a known recent date instead of epoch to avoid timezone edge cases
    const timestamp = new Date('2023-06-15T12:00:00Z').getTime()
    const result = formatDate(timestamp)
    expect(result).toContain('2023')
  })
})

describe('isSafeFaviconUrl', () => {
  describe('valid URLs (should return true)', () => {
    it('should accept http:// URLs', () => {
      expect(isSafeFaviconUrl('http://example.com/favicon.ico')).toBe(true)
      expect(isSafeFaviconUrl('http://localhost/favicon.ico')).toBe(true)
    })

    it('should accept https:// URLs', () => {
      expect(isSafeFaviconUrl('https://example.com/favicon.ico')).toBe(true)
      expect(isSafeFaviconUrl('https://www.google.com/favicon.ico')).toBe(true)
    })

    it('should accept URLs with ports', () => {
      expect(isSafeFaviconUrl('http://localhost:3000/favicon.ico')).toBe(true)
      expect(isSafeFaviconUrl('https://example.com:8443/favicon.ico')).toBe(true)
    })

    it('should accept URLs with query strings', () => {
      expect(isSafeFaviconUrl('https://example.com/favicon.ico?v=123')).toBe(true)
    })
  })

  describe('XSS prevention - dangerous URLs (should return false)', () => {
    it('should reject data: URLs', () => {
      expect(isSafeFaviconUrl('data:image/png;base64,abc123')).toBe(false)
      expect(isSafeFaviconUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    })

    it('should reject javascript: URLs', () => {
      expect(isSafeFaviconUrl('javascript:alert(1)')).toBe(false)
      expect(isSafeFaviconUrl('javascript:void(0)')).toBe(false)
    })

    it('should reject vbscript: URLs', () => {
      expect(isSafeFaviconUrl('vbscript:msgbox("XSS")')).toBe(false)
    })

    it('should reject file: URLs', () => {
      expect(isSafeFaviconUrl('file:///etc/passwd')).toBe(false)
      expect(isSafeFaviconUrl('file://C:/Windows/System32')).toBe(false)
    })

    it('should reject ftp: URLs', () => {
      expect(isSafeFaviconUrl('ftp://example.com/file')).toBe(false)
    })

    it('should reject chrome: URLs', () => {
      expect(isSafeFaviconUrl('chrome://settings')).toBe(false)
      expect(isSafeFaviconUrl('chrome-extension://abcd/icon.png')).toBe(false)
    })

    it('should reject about: URLs', () => {
      expect(isSafeFaviconUrl('about:blank')).toBe(false)
    })
  })

  describe('invalid inputs (should return false)', () => {
    it('should reject undefined', () => {
      expect(isSafeFaviconUrl(undefined)).toBe(false)
    })

    it('should reject empty string', () => {
      expect(isSafeFaviconUrl('')).toBe(false)
    })

    it('should reject malformed URLs', () => {
      expect(isSafeFaviconUrl('not a url')).toBe(false)
      expect(isSafeFaviconUrl('://missing-protocol')).toBe(false)
      expect(isSafeFaviconUrl('http://')).toBe(false)
    })

    it('should reject non-string types', () => {
      // Type assertions to test runtime behavior
      expect(isSafeFaviconUrl(null as unknown as string)).toBe(false)
      expect(isSafeFaviconUrl(123 as unknown as string)).toBe(false)
      expect(isSafeFaviconUrl({} as unknown as string)).toBe(false)
    })
  })
})

describe('getSafeFaviconUrl', () => {
  it('should return the URL for safe URLs', () => {
    const safeUrl = 'https://example.com/favicon.ico'
    expect(getSafeFaviconUrl(safeUrl)).toBe(safeUrl)
  })

  it('should return undefined for unsafe URLs', () => {
    expect(getSafeFaviconUrl('javascript:alert(1)')).toBeUndefined()
    expect(getSafeFaviconUrl('data:image/png;base64,abc')).toBeUndefined()
  })

  it('should return undefined for undefined input', () => {
    expect(getSafeFaviconUrl(undefined)).toBeUndefined()
  })

  it('should return undefined for empty string', () => {
    expect(getSafeFaviconUrl('')).toBeUndefined()
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should delay function execution', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should only call function once for rapid invocations', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()
    debounced()
    debounced()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should reset timer on each call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)
    debounced() // Reset timer
    vi.advanceTimersByTime(50)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should pass arguments to the debounced function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('arg1', 'arg2')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('should use the latest arguments when called multiple times', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    debounced('second')
    debounced('third')

    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('should allow multiple executions with enough time between', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenLastCalledWith('first')

    debounced('second')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('second')
  })

  it('should handle zero delay', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 0)

    debounced()
    vi.advanceTimersByTime(0)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('getFallbackFaviconDataUri', () => {
  it('should return a data URI', () => {
    const result = getFallbackFaviconDataUri()
    expect(result).toMatch(/^data:image\/svg\+xml,/)
  })

  it('should contain SVG content', () => {
    const result = getFallbackFaviconDataUri()
    // Decode to verify it's valid SVG
    const decoded = decodeURIComponent(result.replace('data:image/svg+xml,', ''))
    expect(decoded).toContain('<svg')
    expect(decoded).toContain('</svg>')
    expect(decoded).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('should return the same value on multiple calls', () => {
    const first = getFallbackFaviconDataUri()
    const second = getFallbackFaviconDataUri()
    expect(first).toBe(second)
  })
})
