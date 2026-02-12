/**
 * Backup Health Badge
 *
 * Compact health indicator for the popup footer.
 * Replaces the SyncStatus component with a unified backup view.
 */

import { useState, useEffect } from 'preact/hooks'
import type { BackupHealthData, HealthLevel } from '../backupHealth'

const HEALTH_COLORS: Record<HealthLevel, { icon: string; text: string }> = {
  good: { icon: 'text-green-500', text: 'text-green-700' },
  attention: { icon: 'text-amber-500', text: 'text-amber-700' },
  warning: { icon: 'text-red-500', text: 'text-red-700' },
}

interface BackupHealthBadgeProps {
  onNavigate?: (target: string) => void
}

export function BackupHealthBadge({ onNavigate }: BackupHealthBadgeProps) {
  const [health, setHealth] = useState<BackupHealthData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadHealth = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_BACKUP_HEALTH' })
        if (response.success) {
          setHealth(response.data)
        }
      } catch (err) {
        console.error('Failed to load backup health:', err)
      } finally {
        setLoading(false)
      }
    }

    loadHealth()
    const interval = setInterval(loadHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading || !health) {
    return null
  }

  const colors = HEALTH_COLORS[health.level]
  const topSuggestion = health.suggestions[0]

  return (
    <div
      class="flex flex-col items-center gap-1"
      role="status"
      aria-live="polite"
      aria-label={`${health.headline}: ${health.summary}`}
    >
      <div class="flex items-center gap-1.5">
        <ShieldIcon class={`w-4 h-4 ${colors.icon}`} level={health.level} />
        <span class={`text-xs font-medium ${colors.text}`}>{health.headline}</span>
      </div>

      {health.coverage.totalSessions > 0 && (
        <span class="text-xs text-raft-500">
          {health.coverage.backedUpSessions}/{health.coverage.totalSessions} backed up
        </span>
      )}

      {topSuggestion && health.level !== 'good' && (
        <button
          onClick={() => {
            if (topSuggestion.target && onNavigate) {
              onNavigate(topSuggestion.target)
            } else {
              chrome.runtime.openOptionsPage()
            }
          }}
          class={`text-xs ${colors.text} hover:underline`}
        >
          {topSuggestion.actionLabel || topSuggestion.message}
        </button>
      )}
    </div>
  )
}

function ShieldIcon({ class: className, level }: { class?: string; level: HealthLevel }) {
  if (level === 'good') {
    return (
      <svg
        class={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
        />
      </svg>
    )
  }

  if (level === 'attention') {
    return (
      <svg
        class={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
    )
  }

  // warning
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}
