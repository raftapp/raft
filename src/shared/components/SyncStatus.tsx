/**
 * Compact Sync Status Indicator
 *
 * Shows current cloud sync status in a small format suitable for headers/footers.
 */

import { useState, useEffect } from 'preact/hooks'
import { formatRelativeTime } from '../utils'

interface SyncStatusData {
  configured: boolean
  enabled: boolean
  unlocked: boolean
  syncing: boolean
  lastSyncAt?: number
  lastError?: string
  pendingCount: number
}

interface SyncStatusProps {
  onUnlockClick?: () => void
  onConnectClick?: () => void
}

export function SyncStatus({ onUnlockClick, onConnectClick }: SyncStatusProps) {
  const [status, setStatus] = useState<SyncStatusData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadStatus = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'CLOUD_GET_STATUS' })
        if (response.success) {
          setStatus(response.data)
        }
      } catch (err) {
        console.error('Failed to load sync status:', err)
      } finally {
        setLoading(false)
      }
    }

    loadStatus()
    const interval = setInterval(loadStatus, 15000)
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return null
  }

  if (!status?.configured) {
    return (
      <button
        onClick={onConnectClick}
        class="flex items-center gap-1.5 text-xs text-raft-500 hover:text-raft-700"
        aria-label="Connect cloud sync"
      >
        <CloudIcon class="w-3.5 h-3.5" />
        <span>Connect</span>
      </button>
    )
  }

  if (!status.unlocked) {
    return (
      <button
        onClick={onUnlockClick}
        class="flex items-center gap-1.5 text-xs text-yellow-600 hover:text-yellow-700"
        aria-label="Unlock cloud sync"
      >
        <LockIcon class="w-3.5 h-3.5" />
        <span>Locked</span>
      </button>
    )
  }

  if (status.syncing) {
    return (
      <div
        class="flex items-center gap-1.5 text-xs text-blue-600"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Syncing in progress"
      >
        <span class="animate-spin" aria-hidden="true">
          ⟳
        </span>
        <span>Syncing</span>
      </div>
    )
  }

  if (status.lastError) {
    return (
      <div
        class="flex items-center gap-1.5 text-xs text-red-600"
        role="alert"
        aria-label={`Sync error: ${status.lastError}`}
      >
        <CloudErrorIcon class="w-3.5 h-3.5" />
        <span>Error</span>
      </div>
    )
  }

  if (status.pendingCount > 0) {
    return (
      <div
        class="flex items-center gap-1.5 text-xs text-raft-600"
        role="status"
        aria-live="polite"
        aria-label={`${status.pendingCount} changes pending sync`}
      >
        <CloudPendingIcon class="w-3.5 h-3.5" />
        <span>{status.pendingCount} pending</span>
      </div>
    )
  }

  return (
    <div
      class="flex items-center gap-1.5 text-xs text-green-600"
      role="status"
      aria-live="polite"
      aria-label={
        status.lastSyncAt ? `Last synced ${formatRelativeTime(status.lastSyncAt)}` : 'Synced'
      }
    >
      <CloudCheckIcon class="w-3.5 h-3.5" />
      <span>Synced</span>
    </div>
  )
}

// Simple SVG icons as components

function CloudIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z"
      />
    </svg>
  )
}

function LockIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  )
}

function CloudCheckIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  )
}

function CloudErrorIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  )
}

function CloudPendingIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
      />
    </svg>
  )
}
