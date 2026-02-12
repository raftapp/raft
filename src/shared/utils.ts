/**
 * Shared Utility Functions
 *
 * Common utilities used across the extension.
 */

/**
 * Format a timestamp as a relative time string
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

/**
 * Format a timestamp as a full date/time string
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

/**
 * Safe URL protocols allowed for favicons and restore
 */
const SAFE_PROTOCOLS = ['http:', 'https:']

/**
 * Validate that a URL is safe to use as a favicon source
 * Prevents XSS via data: or javascript: URIs
 */
export function isSafeFaviconUrl(url: string | undefined): boolean {
  if (!url || typeof url !== 'string') {
    return false
  }

  try {
    const parsed = new URL(url)
    return SAFE_PROTOCOLS.includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * Get a safe favicon URL, returning undefined for unsafe URLs
 */
export function getSafeFaviconUrl(url: string | undefined): string | undefined {
  return isSafeFaviconUrl(url) ? url : undefined
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  return (...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = undefined
    }, delay)
  }
}

/**
 * Normalize a URL for deduplication comparison.
 * Strips trailing slashes (except root "/") and fragments (#...).
 * Preserves query params to avoid false positives.
 * Falls back to raw string on parse failure.
 */
export function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url)
    // Remove fragment
    parsed.hash = ''
    // Build normalized URL string
    let normalized = parsed.toString()
    // Strip trailing slash unless it's just the root path (e.g., "https://example.com/")
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return url
  }
}

/**
 * Create a fallback globe SVG data URI for missing favicons
 */
export function getFallbackFaviconDataUri(): string {
  return (
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23999" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>'
    )
  )
}
