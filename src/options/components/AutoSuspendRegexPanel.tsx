/**
 * Auto-Suspend Regex Exceptions Panel
 *
 * Allows users to define regex patterns that prevent automatic suspension,
 * startup hibernation, and bulk manual actions ("Suspend All Tabs" / "Suspend
 * Other Tabs" from the popup). Direct actions such as the keyboard shortcut
 * and context menu ignore these exceptions and still suspend.
 *
 * Each pattern is an independent input. Matching is OR: a tab is exempt if
 * its full URL matches at least one valid regex (case-insensitive).
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { Settings } from '@/shared/types'
import { browser } from '@/shared/browser'
import { Dialog } from '@/shared/a11y'
import { useFocusTrap, useFocusRestore } from '@/shared/a11y'

interface AutoSuspendRegexPanelProps {
  settings: Settings
  onChange: (regexes: string[]) => void
}

interface MatchingTab {
  id: number
  title?: string
  url: string
  windowId?: number
}

function isValidRegex(pattern: string): boolean {
  if (!pattern.trim()) return true
  try {
    new RegExp(pattern, 'i')
    return true
  } catch {
    return false
  }
}

export function AutoSuspendRegexPanel({ settings, onChange }: AutoSuspendRegexPanelProps) {
  const [regexes, setRegexes] = useState<string[]>(settings.suspension.autoSuspendRegexes)
  const [matchingTabs, setMatchingTabs] = useState<MatchingTab[]>([])
  const [selectedRegexIndex, setSelectedRegexIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useFocusRestore(dialogOpen)

  useFocusTrap(dialogRef, dialogOpen)

  // Keep local state in sync if settings change externally
  useEffect(() => {
    setRegexes(settings.suspension.autoSuspendRegexes)
  }, [settings.suspension.autoSuspendRegexes])

  // Query matching tabs whenever regexes change
  useEffect(() => {
    const validRegexes = regexes.filter((r) => isValidRegex(r) && r.trim())
    if (validRegexes.length === 0) {
      setMatchingTabs([])
      return
    }

    let cancelled = false
    setLoading(true)
    browser.runtime
      .sendMessage({ type: 'GET_MATCHING_TABS', regexes: validRegexes })
      .then((response: { success: boolean; data?: MatchingTab[]; error?: string }) => {
        if (cancelled) return
        if (response.success && response.data) {
          setMatchingTabs(response.data)
        } else {
          console.warn('[Raft] Failed to load matching tabs:', response.error)
          setMatchingTabs([])
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.warn('[Raft] Failed to load matching tabs:', err)
          setMatchingTabs([])
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [regexes])

  const updateRegexes = useCallback(
    (next: string[]) => {
      setRegexes(next)
      onChange(next)
    },
    [onChange]
  )

  const handleChange = (index: number, value: string) => {
    const next = [...regexes]
    next[index] = value
    updateRegexes(next)
  }

  const handleAdd = () => {
    updateRegexes([...regexes, ''])
  }

  const handleRemove = (index: number) => {
    const next = regexes.filter((_, i) => i !== index)
    if (next.length === 0) {
      updateRegexes([''])
    } else {
      updateRegexes(next)
    }
  }

  const countForRegex = (pattern: string): number => {
    if (!pattern.trim() || !isValidRegex(pattern)) return 0
    try {
      const regex = new RegExp(pattern, 'i')
      return matchingTabs.filter((tab) => regex.test(tab.url)).length
    } catch {
      return 0
    }
  }

  const openDialog = (index: number) => {
    setSelectedRegexIndex(index)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setSelectedRegexIndex(null)
    restoreFocus()
  }

  const handleGoToTab = async (tabId: number) => {
    try {
      await browser.tabs.update(tabId, { active: true })
      const tab = await browser.tabs.get(tabId)
      if (tab.windowId) {
        await browser.windows.update(tab.windowId, { focused: true })
      }
    } catch (e) {
      console.warn('[Raft] Failed to focus tab:', e)
    }
  }

  const selectedPattern = selectedRegexIndex !== null ? regexes[selectedRegexIndex] : ''
  const dialogTabs =
    selectedRegexIndex !== null && selectedPattern.trim() && isValidRegex(selectedPattern)
      ? matchingTabs.filter((tab) => {
          try {
            const regex = new RegExp(selectedPattern, 'i')
            return regex.test(tab.url)
          } catch {
            return false
          }
        })
      : []

  return (
    <div class="space-y-3">
      <div class="text-sm text-raft-600">
        <p>
          Regex patterns that keep tabs awake during <strong>automatic</strong> suspension, startup
          hibernation, and bulk manual actions such as "Suspend All Tabs" and "Suspend Other Tabs".
          Direct actions (keyboard shortcut, context menu) still suspend.
        </p>
        <p class="mt-1 text-raft-500">
          Matching is case-insensitive and applied to the full tab URL. Multiple rules are combined
          with OR.
        </p>
      </div>

      <div class="space-y-2">
        {regexes.map((pattern, index) => {
          const valid = isValidRegex(pattern)
          const count = countForRegex(pattern)

          return (
            <div key={index} class="flex items-start gap-2">
              <label htmlFor={`auto-suspend-regex-${index}`} class="sr-only">
                Auto-suspend exception regex {index + 1}
              </label>
              <div class="flex-1 relative">
                <input
                  id={`auto-suspend-regex-${index}`}
                  type="text"
                  value={pattern}
                  onInput={(e) => handleChange(index, (e.target as HTMLInputElement).value)}
                  placeholder="e.g. ^https://mail\\.google\\.com/.*"
                  class={`w-full px-3 py-1.5 text-sm border rounded-md focus:ring-raft-500 focus:border-raft-500 ${
                    valid
                      ? 'border-raft-300'
                      : 'border-red-300 focus:ring-red-500 focus:border-red-500'
                  }`}
                  aria-invalid={!valid}
                  aria-describedby={!valid ? `regex-error-${index}` : undefined}
                />
                {!valid && (
                  <p id={`regex-error-${index}`} class="text-xs text-red-600 mt-1">
                    Invalid regular expression
                  </p>
                )}
              </div>

              <div class="flex items-center gap-2 min-w-[4rem]">
                {count > 0 ? (
                  <button
                    type="button"
                    onClick={() => openDialog(index)}
                    class="text-sm text-raft-600 hover:text-raft-800 underline underline-offset-2"
                    aria-label={`${count} tab${count !== 1 ? 's' : ''} match regex ${index + 1}`}
                  >
                    {count} tab{count !== 1 ? 's' : ''}
                  </button>
                ) : (
                  <span class="text-sm text-raft-400" aria-hidden="true">
                    0 tabs
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  class="p-1 text-raft-400 hover:text-red-600 transition-colors"
                  aria-label={`Remove regex ${index + 1}`}
                  title="Remove"
                >
                  <svg
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={handleAdd}
        class="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-raft-300 text-raft-600 rounded-md hover:bg-raft-50 transition-colors"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        Add exception
      </button>

      {loading && (
        <p class="text-xs text-raft-500" role="status" aria-live="polite">
          Updating matches…
        </p>
      )}

      {/* Matching tabs dialog */}
      <Dialog
        open={dialogOpen}
        title={`Tabs matching ${selectedPattern}`}
        titleId="matching-tabs-title"
        onClose={closeDialog}
        class="fixed inset-0 z-50 flex items-center justify-center"
      >
        <div
          ref={dialogRef}
          class="bg-white rounded-lg shadow-lg border border-raft-200 w-full max-w-lg mx-4 overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="matching-tabs-title"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-raft-200">
            <h2 id="matching-tabs-title" class="text-base font-semibold text-raft-900 truncate">
              Matching tabs ({dialogTabs.length})
            </h2>
            <button
              type="button"
              onClick={closeDialog}
              class="text-raft-400 hover:text-raft-600"
              aria-label="Close"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          <div class="max-h-80 overflow-y-auto">
            {dialogTabs.length === 0 ? (
              <p class="px-4 py-6 text-sm text-raft-500 text-center">No matching tabs</p>
            ) : (
              <ul class="divide-y divide-raft-100">
                {dialogTabs.map((tab) => (
                  <li key={tab.id} class="px-4 py-3 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p
                        class="text-sm font-medium text-raft-800 truncate"
                        title={tab.title || tab.url}
                      >
                        {tab.title || 'Untitled'}
                      </p>
                      <p class="text-xs text-raft-500 truncate" title={tab.url}>
                        {tab.url}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleGoToTab(tab.id)}
                      class="shrink-0 px-2 py-1 text-xs bg-raft-100 text-raft-700 rounded hover:bg-raft-200 transition-colors"
                    >
                      Go to tab
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div class="px-4 py-3 border-t border-raft-200 flex justify-end">
            <button
              type="button"
              onClick={closeDialog}
              class="px-3 py-1.5 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
        <div class="fixed inset-0 bg-black/30 -z-10" onClick={closeDialog} aria-hidden="true" />
      </Dialog>
    </div>
  )
}
