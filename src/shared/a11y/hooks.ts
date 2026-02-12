/**
 * A11Y Hooks
 *
 * Preact hooks for accessibility features.
 */

import { useEffect, useRef, useState, useCallback } from 'preact/hooks'
import type { RefObject } from 'preact'
import { getFocusableElements, prefersReducedMotion } from './utils'

/**
 * Hook to trap focus within a container (for modals/dialogs)
 *
 * Usage:
 * ```tsx
 * const dialogRef = useRef<HTMLDivElement>(null)
 * useFocusTrap(dialogRef, isOpen)
 * ```
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement>, active: boolean = true): void {
  useEffect(() => {
    if (!active || !containerRef.current) return

    const container = containerRef.current
    const focusableElements = getFocusableElements(container)

    if (focusableElements.length === 0) return

    const firstElement = focusableElements[0]

    // Focus first element on mount
    firstElement.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return

      // Refresh focusable elements in case DOM changed
      const currentFocusable = getFocusableElements(container)
      if (currentFocusable.length === 0) return

      const first = currentFocusable[0]
      const last = currentFocusable[currentFocusable.length - 1]

      if (e.shiftKey) {
        // Shift+Tab: if on first element, wrap to last
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
    }
  }, [containerRef, active])
}

/**
 * Hook to save and restore focus when a modal opens/closes
 *
 * Usage:
 * ```tsx
 * const restoreFocus = useFocusRestore(isDialogOpen)
 * // Call restoreFocus() when closing dialog
 * ```
 */
export function useFocusRestore(active: boolean): () => void {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (active) {
      // Save the currently focused element
      previousFocusRef.current = document.activeElement as HTMLElement
    }
  }, [active])

  const restore = useCallback(() => {
    if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
      previousFocusRef.current.focus()
      previousFocusRef.current = null
    }
  }, [])

  return restore
}

interface ArrowNavigationOptions {
  /** Orientation of the navigation (horizontal for tabs, vertical for lists) */
  orientation?: 'horizontal' | 'vertical'
  /** Whether to loop from end to start */
  loop?: boolean
  /** Callback when active index changes */
  onActiveChange?: (index: number) => void
}

/**
 * Hook for arrow key navigation in lists and tabs
 *
 * Usage:
 * ```tsx
 * const { activeIndex, handleKeyDown, setActiveIndex } = useArrowNavigation({
 *   orientation: 'horizontal',
 *   itemCount: tabs.length,
 *   onActiveChange: (idx) => setActiveTab(tabs[idx])
 * })
 * ```
 */
export function useArrowNavigation(
  itemCount: number,
  options: ArrowNavigationOptions = {}
): {
  activeIndex: number
  setActiveIndex: (index: number) => void
  handleKeyDown: (e: KeyboardEvent) => void
} {
  const { orientation = 'horizontal', loop = true, onActiveChange } = options
  const [activeIndex, setActiveIndexState] = useState(0)

  const setActiveIndex = useCallback(
    (index: number) => {
      setActiveIndexState(index)
      onActiveChange?.(index)
    },
    [onActiveChange]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const isHorizontal = orientation === 'horizontal'
      const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp'
      const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown'

      let newIndex = activeIndex

      switch (e.key) {
        case prevKey:
          e.preventDefault()
          if (loop) {
            newIndex = activeIndex === 0 ? itemCount - 1 : activeIndex - 1
          } else {
            newIndex = Math.max(0, activeIndex - 1)
          }
          break

        case nextKey:
          e.preventDefault()
          if (loop) {
            newIndex = activeIndex === itemCount - 1 ? 0 : activeIndex + 1
          } else {
            newIndex = Math.min(itemCount - 1, activeIndex + 1)
          }
          break

        case 'Home':
          e.preventDefault()
          newIndex = 0
          break

        case 'End':
          e.preventDefault()
          newIndex = itemCount - 1
          break

        default:
          return
      }

      if (newIndex !== activeIndex) {
        setActiveIndex(newIndex)
      }
    },
    [activeIndex, itemCount, orientation, loop, setActiveIndex]
  )

  return { activeIndex, setActiveIndex, handleKeyDown }
}

/**
 * Hook to announce messages to screen readers via live region
 *
 * Usage:
 * ```tsx
 * const { announce, Announcer } = useAnnounce()
 * // Later:
 * announce('5 results found')
 * // Render <Announcer /> somewhere in your component
 * ```
 */
export function useAnnounce(): {
  announce: (message: string, priority?: 'polite' | 'assertive') => void
  clearAnnouncement: () => void
  message: string
  priority: 'polite' | 'assertive'
} {
  const [message, setMessage] = useState('')
  const [priority, setPriority] = useState<'polite' | 'assertive'>('polite')

  const announce = useCallback((msg: string, p: 'polite' | 'assertive' = 'polite') => {
    // Clear first to ensure re-announcement of same message
    setMessage('')
    setPriority(p)
    // Use requestAnimationFrame to ensure the clear happens first
    requestAnimationFrame(() => {
      setMessage(msg)
    })
  }, [])

  const clearAnnouncement = useCallback(() => {
    setMessage('')
  }, [])

  return { announce, clearAnnouncement, message, priority }
}

/**
 * Hook to detect if user prefers reduced motion
 *
 * Usage:
 * ```tsx
 * const reducedMotion = useReducedMotion()
 * const animationClass = reducedMotion ? '' : 'animate-slide-in'
 * ```
 */
export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion())

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')

    const handleChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  return reducedMotion
}
