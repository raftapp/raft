/**
 * A11Y Utility Functions
 *
 * Helper functions for accessibility features.
 */

let idCounter = 0

/**
 * Generate unique IDs for ARIA relationships
 */
export function generateId(prefix: string = 'a11y'): string {
  idCounter++
  return `${prefix}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const focusableSelectors = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ')

  const elements = container.querySelectorAll<HTMLElement>(focusableSelectors)
  return Array.from(elements).filter((el) => {
    // Filter out hidden elements
    return el.offsetParent !== null && !el.hidden
  })
}

/**
 * Check if reduced motion is preferred
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Check if high contrast is preferred
 */
export function prefersHighContrast(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-contrast: more)').matches
}
