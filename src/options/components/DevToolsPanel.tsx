/**
 * Dev Tools Panel Component
 *
 * Provides buttons to create test scenarios with windows, tabs, and tab groups.
 * Only available in dev mode (import.meta.env.DEV).
 */

import { useState, useEffect } from 'preact/hooks'
import { allScenarios } from '@/devtools/scenarios'
import type { DevScenario } from '@/devtools/types'
import { DEV_PRO_OVERRIDE_KEY } from '@/shared/constants'

interface DevToolsPanelProps {
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export function DevToolsPanel({ onSuccess, onError }: DevToolsPanelProps) {
  const [testWindowCount, setTestWindowCount] = useState(0)
  const [isLoading, setIsLoading] = useState<string | null>(null)
  const [proOverride, setProOverride] = useState(false)

  // Load test window count on mount and after changes
  const loadTestWindowCount = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DEV_GET_TEST_WINDOW_IDS' })
      if (response.success) {
        setTestWindowCount(response.data.windowIds.length)
      }
    } catch {
      // Ignore errors
    }
  }

  useEffect(() => {
    loadTestWindowCount()
    chrome.storage.local.get(DEV_PRO_OVERRIDE_KEY).then((result) => {
      setProOverride(!!result[DEV_PRO_OVERRIDE_KEY])
    })
  }, [])

  const handleProOverrideToggle = async () => {
    const newValue = !proOverride
    if (newValue) {
      await chrome.storage.local.set({ [DEV_PRO_OVERRIDE_KEY]: true })
    } else {
      await chrome.storage.local.remove(DEV_PRO_OVERRIDE_KEY)
    }
    setProOverride(newValue)
    onSuccess(newValue ? 'Pro override enabled' : 'Pro override disabled')
  }

  const handleCreateScenario = async (scenario: DevScenario) => {
    setIsLoading(scenario.id)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DEV_CREATE_SCENARIO',
        scenario,
      })
      if (response.success) {
        onSuccess(`Created ${scenario.name} scenario (${response.data.windowCount} windows)`)
        loadTestWindowCount()
      } else {
        onError(response.error || 'Failed to create scenario')
      }
    } catch (err) {
      onError(String(err))
    } finally {
      setIsLoading(null)
    }
  }

  const handleCleanup = async () => {
    setIsLoading('cleanup')
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DEV_CLEANUP_TEST_WINDOWS' })
      if (response.success) {
        onSuccess(`Closed ${response.data.closedCount} test windows`)
        loadTestWindowCount()
      } else {
        onError(response.error || 'Failed to cleanup')
      }
    } catch (err) {
      onError(String(err))
    } finally {
      setIsLoading(null)
    }
  }

  return (
    <div class="space-y-6">
      {/* Warning Banner */}
      <div class="bg-orange-50 border border-orange-200 rounded-lg p-4">
        <div class="flex items-start gap-3">
          <svg
            class="w-5 h-5 text-orange-500 shrink-0 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <div>
            <p class="font-medium text-orange-800">Development Mode Only</p>
            <p class="text-sm text-orange-700 mt-1">
              These tools are only available during development. They will not appear in production
              builds.
            </p>
          </div>
        </div>
      </div>

      {/* Pro Override */}
      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold text-raft-900">Pro Override</h2>
            <p class="text-sm text-raft-600 mt-1">
              Bypass license checks to test Cloud Sync without a Lemon Squeezy key.
            </p>
          </div>
          <button
            onClick={handleProOverrideToggle}
            class={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${proOverride ? 'bg-green-500' : 'bg-raft-300'}`}
            role="switch"
            aria-checked={proOverride}
          >
            <span
              class={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${proOverride ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        </div>
      </section>

      {/* Test Scenarios */}
      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <h2 class="text-lg font-semibold text-raft-900 mb-4">Test Scenarios</h2>
        <p class="text-sm text-raft-600 mb-4">
          Create test scenarios with various configurations of windows, tabs, and tab groups.
        </p>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {allScenarios.map((scenario) => (
            <button
              key={scenario.id}
              onClick={() => handleCreateScenario(scenario)}
              disabled={isLoading !== null}
              class="flex flex-col items-start p-4 text-left bg-raft-50 hover:bg-raft-100 border border-raft-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span class="font-medium text-raft-900">{scenario.name}</span>
              <span class="text-xs text-raft-500 mt-1">{scenario.description}</span>
              {isLoading === scenario.id && (
                <span class="text-xs text-raft-400 mt-2">Creating...</span>
              )}
            </button>
          ))}
        </div>
      </section>

      {/* Cleanup Section */}
      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <h2 class="text-lg font-semibold text-raft-900 mb-4">Cleanup</h2>

        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-raft-600">
              Test windows created: <span class="font-medium text-raft-900">{testWindowCount}</span>
            </p>
            <p class="text-xs text-raft-500 mt-1">Close all windows created by test scenarios</p>
          </div>

          <button
            onClick={handleCleanup}
            disabled={isLoading !== null || testWindowCount === 0}
            class="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading === 'cleanup' ? 'Closing...' : 'Close All Test Windows'}
          </button>
        </div>
      </section>
    </div>
  )
}
