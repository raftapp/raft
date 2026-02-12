/**
 * A11Y Components
 *
 * Reusable accessibility components.
 */

import type { ComponentChildren } from 'preact'

interface VisuallyHiddenProps {
  children: ComponentChildren
  /** If true, content becomes visible when focused (for skip links) */
  focusable?: boolean
}

/**
 * Visually hides content while keeping it accessible to screen readers
 *
 * Usage:
 * ```tsx
 * <VisuallyHidden>5 items selected</VisuallyHidden>
 * ```
 */
export function VisuallyHidden({ children, focusable = false }: VisuallyHiddenProps) {
  return (
    <span class={focusable ? 'sr-only focus:not-sr-only focus:absolute' : 'sr-only'}>
      {children}
    </span>
  )
}

interface LiveRegionProps {
  /** Message to announce */
  message: string
  /** Priority: 'polite' waits for user idle, 'assertive' interrupts */
  priority?: 'polite' | 'assertive'
  /** Whether to announce the full message when it changes */
  atomic?: boolean
}

/**
 * ARIA live region for dynamic announcements
 *
 * Usage:
 * ```tsx
 * <LiveRegion message={statusMessage} />
 * ```
 */
export function LiveRegion({ message, priority = 'polite', atomic = true }: LiveRegionProps) {
  return (
    <div role="status" aria-live={priority} aria-atomic={atomic} class="sr-only">
      {message}
    </div>
  )
}

interface SkipLinkProps {
  /** ID of the target element to skip to */
  href: string
  /** Text for the skip link */
  children?: ComponentChildren
}

/**
 * Skip navigation link for keyboard users
 *
 * Usage:
 * ```tsx
 * <SkipLink href="#main-content">Skip to main content</SkipLink>
 * <main id="main-content">...</main>
 * ```
 */
export function SkipLink({ href, children = 'Skip to main content' }: SkipLinkProps) {
  return (
    <a href={href} class="skip-link">
      {children}
    </a>
  )
}

interface DialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Dialog title for accessibility */
  title: string
  /** ID for the title element (used by aria-labelledby) */
  titleId: string
  /** Optional description ID (used by aria-describedby) */
  descriptionId?: string
  /** Children content */
  children: ComponentChildren
  /** Called when dialog should close (e.g., Escape key) */
  onClose?: () => void
  /** Additional class names */
  class?: string
}

/**
 * Accessible dialog wrapper with proper ARIA attributes
 *
 * Note: This provides the ARIA semantics. You should also use
 * useFocusTrap and useFocusRestore hooks for complete accessibility.
 *
 * Usage:
 * ```tsx
 * <Dialog
 *   open={isOpen}
 *   title="Confirm Delete"
 *   titleId="delete-dialog-title"
 *   onClose={() => setIsOpen(false)}
 * >
 *   <h2 id="delete-dialog-title">Confirm Delete</h2>
 *   ...
 * </Dialog>
 * ```
 */
export function Dialog({
  open,
  title,
  titleId,
  descriptionId,
  children,
  onClose,
  class: className = '',
}: DialogProps) {
  if (!open) return null

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-label={title}
      onKeyDown={handleKeyDown}
      class={className}
    >
      {children}
    </div>
  )
}

interface AlertDialogProps {
  /** Whether the dialog is open */
  open: boolean
  /** Dialog title for accessibility */
  title: string
  /** ID for the title element */
  titleId: string
  /** ID for the description element */
  descriptionId: string
  /** Children content */
  children: ComponentChildren
  /** Called when dialog should close */
  onClose?: () => void
  /** Additional class names */
  class?: string
}

/**
 * Accessible alert dialog for confirmations
 *
 * Uses role="alertdialog" which is appropriate for dialogs requiring
 * immediate user response (confirmations, warnings, etc.)
 */
export function AlertDialog({
  open,
  title,
  titleId,
  descriptionId,
  children,
  onClose,
  class: className = '',
}: AlertDialogProps) {
  if (!open) return null

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- AlertDialog Escape handler
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-label={title}
      onKeyDown={handleKeyDown}
      class={className}
    >
      {children}
    </div>
  )
}
