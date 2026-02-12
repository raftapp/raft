/**
 * Backup Dashboard
 *
 * Detailed backup health view for the options page.
 * Shows health shield, 4 layer cards, coverage bar, and suggestions.
 */

import { useState, useEffect, useCallback } from 'preact/hooks'
import type { BackupHealthData, BackupLayerStatus, HealthLevel } from '@/shared/backupHealth'
import { formatRelativeTime } from '@/shared/utils'

const LEVEL_STYLES: Record<
  HealthLevel,
  { bg: string; border: string; text: string; icon: string }
> = {
  good: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    icon: 'text-green-500',
  },
  attention: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: 'text-amber-500',
  },
  warning: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    icon: 'text-red-500',
  },
}

const LAYER_STATUS_STYLES: Record<string, { icon: string; color: string }> = {
  active: { icon: 'text-green-500', color: 'bg-green-50' },
  stale: { icon: 'text-amber-500', color: 'bg-amber-50' },
  error: { icon: 'text-red-500', color: 'bg-red-50' },
  disabled: { icon: 'text-raft-400', color: 'bg-raft-50' },
  locked: { icon: 'text-yellow-500', color: 'bg-yellow-50' },
}

interface BackupDashboardProps {
  isPro: boolean
  onNavigateTab: (tab: string) => void
}

export function BackupDashboard({ isPro, onNavigateTab }: BackupDashboardProps) {
  const [health, setHealth] = useState<BackupHealthData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadHealth = useCallback(async () => {
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
  }, [])

  useEffect(() => {
    loadHealth()
    const interval = setInterval(loadHealth, 30000)
    return () => clearInterval(interval)
  }, [loadHealth])

  if (loading || !health) {
    return null
  }

  const styles = LEVEL_STYLES[health.level]

  return (
    <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6 mb-6">
      <h2 class="text-lg font-semibold text-raft-900 mb-4">Backup Health</h2>

      {/* Health headline */}
      <div
        class={`flex items-center gap-3 p-4 rounded-lg ${styles.bg} ${styles.border} border mb-4`}
      >
        <ShieldIcon class={`w-8 h-8 ${styles.icon}`} />
        <div>
          <p class={`font-semibold ${styles.text}`}>{health.headline}</p>
          <p class="text-sm text-raft-600">{health.summary}</p>
        </div>
      </div>

      {/* Layer cards grid */}
      <div class="grid grid-cols-2 gap-3 mb-4">
        {health.layers.map((layer) => (
          <LayerCard key={layer.name} layer={layer} isPro={isPro} />
        ))}
      </div>

      {/* Coverage bar */}
      {health.coverage.totalSessions > 0 && (
        <div class="mb-4">
          <div class="flex items-center justify-between text-sm mb-1">
            <span class="text-raft-600">Backup Coverage</span>
            <span class="text-raft-700 font-medium">
              {health.coverage.backedUpSessions} / {health.coverage.totalSessions} sessions (
              {health.coverage.percentage}%)
            </span>
          </div>
          <div class="h-2 bg-raft-100 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full transition-all ${
                health.coverage.percentage >= 80
                  ? 'bg-green-500'
                  : health.coverage.percentage >= 50
                    ? 'bg-amber-500'
                    : 'bg-red-500'
              }`}
              style={{ width: `${Math.min(health.coverage.percentage, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Suggestions */}
      {health.suggestions.length > 0 && (
        <div class="space-y-2">
          {health.suggestions.map((suggestion, i) => (
            <div
              key={i}
              class="flex items-center justify-between py-2 px-3 bg-raft-50 rounded-lg text-sm"
            >
              <span class="text-raft-600">{suggestion.message}</span>
              {suggestion.target && suggestion.actionLabel && (
                <button
                  onClick={() => onNavigateTab(suggestion.target!)}
                  class="px-3 py-1 text-xs font-medium text-raft-700 bg-white border border-raft-300 rounded hover:bg-raft-100 transition-colors shrink-0 ml-2"
                >
                  {suggestion.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function LayerCard({ layer, isPro }: { layer: BackupLayerStatus; isPro: boolean }) {
  const styles = LAYER_STATUS_STYLES[layer.status] || LAYER_STATUS_STYLES.disabled

  return (
    <div class={`rounded-lg p-3 ${styles.color}`}>
      <div class="flex items-center gap-2 mb-1">
        <LayerStatusIcon status={layer.status} class={`w-4 h-4 ${styles.icon}`} />
        <span class="text-sm font-medium text-raft-700">{layer.name}</span>
        {layer.name === 'Cloud Sync' && !isPro && (
          <span class="px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded">Pro</span>
        )}
      </div>
      <p class="text-xs text-raft-600">{layer.detail}</p>
      {layer.lastSuccessAt && (
        <p class="text-xs text-raft-400 mt-0.5">{formatRelativeTime(layer.lastSuccessAt)}</p>
      )}
    </div>
  )
}

function LayerStatusIcon({ status, class: className }: { status: string; class?: string }) {
  if (status === 'active') {
    return (
      <svg
        class={className}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    )
  }
  if (status === 'error') {
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
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    )
  }
  if (status === 'locked') {
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
          d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
        />
      </svg>
    )
  }
  if (status === 'stale') {
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
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    )
  }
  // disabled
  return (
    <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
    </svg>
  )
}

function ShieldIcon({ class: className }: { class?: string }) {
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
