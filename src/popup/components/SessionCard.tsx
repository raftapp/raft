/**
 * Session Card for Popup
 *
 * Collapsed: shows name, timestamp, stats, sync badge, restore buttons, chevron toggle.
 * Expanded: shows windows with checkboxes for selective restore.
 */

import { useState, useMemo, useCallback } from 'preact/hooks'
import type { SessionWithStats } from '@/shared/stores/sessionsStore'
import type { PartialRestoreSelection, Window } from '@/shared/types'
import { formatRelativeTime, isSafeFaviconUrl, getFallbackFaviconDataUri } from '@/shared/utils'

/** Tab group color → Tailwind dot color */
const GROUP_COLOR_MAP: Record<string, string> = {
  grey: 'bg-gray-400',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-yellow-500',
  green: 'bg-green-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
}

/** Max tabs shown per window before "Show all" toggle */
const INITIAL_TAB_LIMIT = 15

interface SessionCardProps {
  session: SessionWithStats
  isSynced: boolean
  isCloudSynced?: boolean
  expanded: boolean
  onToggleExpand: () => void
  disabled: boolean
  onRestore: (asSuspended: boolean) => void
  onRestorePartial: (selection: PartialRestoreSelection, asSuspended: boolean) => void
}

type SelectionState = Record<string, Set<string>>

function buildFullSelection(session: SessionWithStats): SelectionState {
  const sel: SelectionState = {}
  for (const w of session.windows) {
    sel[w.id] = new Set(w.tabs.map((t) => t.id))
  }
  return sel
}

function countSelected(selection: SelectionState): number {
  let count = 0
  for (const tabIds of Object.values(selection)) {
    count += tabIds.size
  }
  return count
}

function totalTabs(session: SessionWithStats): number {
  return session.windows.reduce((sum, w) => sum + w.tabs.length, 0)
}

export function SessionCard({
  session,
  isSynced,
  isCloudSynced,
  expanded,
  onToggleExpand,
  disabled,
  onRestore,
  onRestorePartial,
}: SessionCardProps) {
  const [selection, setSelection] = useState<SelectionState>(() => buildFullSelection(session))
  const [showAllTabs, setShowAllTabs] = useState<Record<string, boolean>>({})

  const total = totalTabs(session)
  const selected = useMemo(() => countSelected(selection), [selection])

  // Reset selection when session changes
  const resetSelection = useCallback(() => {
    setSelection(buildFullSelection(session))
    setShowAllTabs({})
  }, [session])

  // When expanding, reset selection to all
  const handleToggleExpand = () => {
    if (!expanded) {
      resetSelection()
    }
    onToggleExpand()
  }

  const toggleTab = (windowId: string, tabId: string) => {
    setSelection((prev) => {
      const next = { ...prev }
      const windowSet = new Set(prev[windowId] || [])
      if (windowSet.has(tabId)) {
        windowSet.delete(tabId)
      } else {
        windowSet.add(tabId)
      }
      next[windowId] = windowSet
      return next
    })
  }

  const toggleWindow = (window: Window) => {
    setSelection((prev) => {
      const next = { ...prev }
      const currentSet = prev[window.id] || new Set()
      const allSelected = window.tabs.every((t) => currentSet.has(t.id))

      if (allSelected) {
        // Deselect all tabs in this window
        next[window.id] = new Set()
      } else {
        // Select all tabs in this window
        next[window.id] = new Set(window.tabs.map((t) => t.id))
      }
      return next
    })
  }

  const getWindowCheckState = (window: Window): 'all' | 'some' | 'none' => {
    const windowSet = selection[window.id] || new Set()
    if (windowSet.size === 0) return 'none'
    if (window.tabs.every((t) => windowSet.has(t.id))) return 'all'
    return 'some'
  }

  const buildPartialSelection = (): PartialRestoreSelection => {
    const windows: Record<string, string[]> = {}
    for (const [windowId, tabIds] of Object.entries(selection)) {
      if (tabIds.size > 0) {
        windows[windowId] = [...tabIds]
      }
    }
    return { windows }
  }

  const handleRestoreSelected = (asSuspended: boolean) => {
    if (selected === total) {
      // All selected, use full restore
      onRestore(asSuspended)
    } else {
      onRestorePartial(buildPartialSelection(), asSuspended)
    }
  }

  return (
    <article
      class="bg-raft-50 rounded-lg border border-raft-200 hover:border-raft-300 transition-colors"
      aria-label={`Session: ${session.name}, ${session.stats.tabs} tabs`}
    >
      {/* Collapsed header */}
      <div class="p-3">
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-1.5 min-w-0 flex-1">
            <button
              onClick={handleToggleExpand}
              class="shrink-0 w-5 h-5 flex items-center justify-center text-raft-400 hover:text-raft-600 transition-colors"
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse session details' : 'Expand session details'}
            >
              <svg
                class={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
            <span class="font-medium text-sm text-raft-800 truncate" title={session.name}>
              {session.name}
            </span>
            {isSynced && (
              <svg
                class="w-3.5 h-3.5 text-green-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
                aria-hidden="true"
                role="img"
              >
                <title>Backed up via browser sync</title>
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            )}
            {isCloudSynced && (
              <svg
                class="w-3.5 h-3.5 text-blue-500 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                aria-hidden="true"
                role="img"
              >
                <title>Backed up to Google Drive</title>
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                />
              </svg>
            )}
          </div>
          <span class="text-xs text-raft-500 ml-2 shrink-0">
            {formatRelativeTime(session.createdAt)}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-raft-600 ml-5">
            {session.stats.windows}w / {session.stats.tabs}t
            {session.stats.groups > 0 && ` / ${session.stats.groups}g`}
          </span>
          {!expanded && (
            <div class="flex gap-1" role="group" aria-label="Session actions">
              <button
                onClick={() => onRestore(false)}
                disabled={disabled}
                class="px-2 py-1 text-xs font-medium text-raft-700 bg-white border border-raft-300 rounded hover:bg-raft-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label={`Restore session ${session.name}`}
              >
                Restore
              </button>
              <button
                onClick={() => onRestore(true)}
                disabled={disabled}
                class="px-2 py-1 text-xs text-raft-500 hover:bg-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Restore with tabs suspended to save memory"
                aria-label={`Restore session ${session.name} with tabs suspended`}
              >
                Restore Suspended
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded view */}
      {expanded && (
        <div class="border-t border-raft-200">
          <div class="max-h-[250px] overflow-y-auto px-3 py-2">
            {session.windows.map((window, windowIndex) => {
              const checkState = getWindowCheckState(window)
              const windowSet = selection[window.id] || new Set()
              const showAll = showAllTabs[window.id] ?? false
              const visibleTabs = showAll ? window.tabs : window.tabs.slice(0, INITIAL_TAB_LIMIT)
              const hasMore = window.tabs.length > INITIAL_TAB_LIMIT

              return (
                <div key={window.id} class="mb-2 last:mb-0">
                  {/* Window header with checkbox */}
                  <label class="flex items-center gap-2 py-1 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checkState === 'all'}
                      ref={(el) => {
                        if (el) el.indeterminate = checkState === 'some'
                      }}
                      onChange={() => toggleWindow(window)}
                      class="w-3.5 h-3.5 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                      aria-checked={checkState === 'some' ? 'mixed' : checkState === 'all'}
                      aria-label={`Window ${windowIndex + 1}: ${window.tabs.length} tabs`}
                    />
                    <span class="text-xs font-medium text-raft-700">
                      Window {windowIndex + 1}
                      {window.focused && <span class="text-raft-400 ml-1">(focused)</span>}
                    </span>
                    <span class="text-xs text-raft-400">
                      {windowSet.size}/{window.tabs.length}
                    </span>
                  </label>

                  {/* Tab list */}
                  <div class="ml-5 space-y-0.5">
                    {visibleTabs.map((tab) => {
                      const group = tab.groupId
                        ? window.tabGroups.find((g) => g.id === tab.groupId)
                        : undefined
                      const isChecked = windowSet.has(tab.id)

                      return (
                        <label
                          key={tab.id}
                          class="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-raft-100 rounded px-1 -mx-1"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleTab(window.id, tab.id)}
                            class="w-3 h-3 rounded border-raft-300 text-raft-600 focus:ring-raft-500 shrink-0"
                          />
                          {tab.favIconUrl && isSafeFaviconUrl(tab.favIconUrl) ? (
                            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Favicon fallback, not interactive
                            <img
                              src={tab.favIconUrl}
                              alt=""
                              class="w-3 h-3 shrink-0"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement
                                img.src = getFallbackFaviconDataUri()
                                img.onerror = null
                              }}
                            />
                          ) : (
                            <img
                              src={getFallbackFaviconDataUri()}
                              alt=""
                              class="w-3 h-3 shrink-0"
                            />
                          )}
                          <span
                            class="text-xs text-raft-600 truncate flex-1"
                            title={tab.title || tab.url}
                          >
                            {tab.title || tab.url}
                          </span>
                          {tab.pinned && <span class="text-xs text-blue-400 shrink-0">pin</span>}
                          {group && (
                            <span
                              class={`w-2 h-2 rounded-full shrink-0 ${GROUP_COLOR_MAP[group.color] || 'bg-gray-400'}`}
                              title={group.title || 'Group'}
                            />
                          )}
                        </label>
                      )
                    })}
                    {hasMore && !showAll && (
                      <button
                        onClick={() => setShowAllTabs((prev) => ({ ...prev, [window.id]: true }))}
                        class="text-xs text-raft-500 hover:text-raft-700 py-0.5 px-1"
                      >
                        Show all {window.tabs.length} tabs
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Sticky footer */}
          <div class="px-3 py-2 border-t border-raft-200 bg-raft-50 flex items-center justify-between">
            <span class="text-xs text-raft-600">
              {selected} of {total} selected
            </span>
            <div class="flex gap-1" role="group" aria-label="Restore selected tabs">
              <button
                onClick={() => handleRestoreSelected(false)}
                disabled={disabled || selected === 0}
                class="px-2 py-1 text-xs font-medium text-white bg-raft-600 rounded hover:bg-raft-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Restore Selected
              </button>
              <button
                onClick={() => handleRestoreSelected(true)}
                disabled={disabled || selected === 0}
                class="px-2 py-1 text-xs text-raft-500 hover:bg-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Restore selected tabs suspended"
              >
                Restore Suspended
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
