/**
 * Toast Notification Component
 *
 * Lightweight toast notifications for user feedback.
 * Supports success, error, and info variants with auto-dismiss.
 */

import { useState, useEffect, useCallback } from 'preact/hooks'
import { useReducedMotion } from '@/shared/a11y'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
  action?: ToastAction
}

interface ToastProps {
  toast: ToastMessage
  onDismiss: (id: string) => void
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    // Trigger entrance animation (skip if reduced motion preferred)
    if (reducedMotion) {
      setIsVisible(true)
    } else {
      globalThis.requestAnimationFrame(() => setIsVisible(true))
    }

    const duration = toast.duration ?? 3000
    const timer = setTimeout(() => {
      if (reducedMotion) {
        onDismiss(toast.id)
      } else {
        setIsVisible(false)
        setTimeout(() => onDismiss(toast.id), 150) // Wait for exit animation
      }
    }, duration)

    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, onDismiss, reducedMotion])

  const baseClasses =
    'px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 transition-all duration-150'
  const typeClasses = {
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white',
    info: 'bg-raft-600 text-white',
  }
  const visibilityClasses = isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'

  const icons = {
    success: (
      <svg
        class="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    ),
    error: (
      <svg
        class="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    ),
    info: (
      <svg
        class="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      aria-atomic="true"
      class={`${baseClasses} ${typeClasses[toast.type]} ${visibilityClasses}`}
    >
      {icons[toast.type]}
      <span class="text-sm font-medium">{toast.message}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick()
            onDismiss(toast.id)
          }}
          class="px-2 py-1 text-sm font-semibold bg-white/20 hover:bg-white/30 rounded transition-colors"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(toast.id)}
        class="ml-auto p-1 hover:bg-white/20 rounded transition-colors"
        aria-label="Dismiss notification"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null

  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-label="Notifications">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * Custom hook for managing toast notifications
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const addToast = useCallback(
    (type: ToastType, message: string, duration?: number, action?: ToastAction) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      setToasts((prev) => [...prev, { id, type, message, duration, action }])
      return id
    },
    []
  )

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const success = useCallback(
    (message: string, duration?: number, action?: ToastAction) =>
      addToast('success', message, duration, action),
    [addToast]
  )

  const error = useCallback(
    (message: string, duration?: number, action?: ToastAction) =>
      addToast('error', message, duration ?? 5000, action),
    [addToast]
  )

  const info = useCallback(
    (message: string, duration?: number, action?: ToastAction) =>
      addToast('info', message, duration, action),
    [addToast]
  )

  return {
    toasts,
    addToast,
    dismissToast,
    success,
    error,
    info,
  }
}
