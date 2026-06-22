/**
 * Auto-Suspend Regex Exceptions Panel
 *
 * Allows users to define rules that prevent automatic suspension,
 * startup hibernation, and bulk manual actions ("Suspend All Tabs" /
 * "Suspend Other Tabs" from the popup). Direct single-tab actions — the
 * keyboard shortcut, the context menu, and the popup's per-tab Suspend
 * button — ignore these exceptions and still suspend.
 *
 * Each rule combines a pattern with a target. Matching is OR: a tab is
 * exempt if it matches at least one valid rule (case-insensitive).
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { Settings, AutoSuspendRule, AutoSuspendTarget } from '@/shared/types'
import { browser } from '@/shared/browser'
import { Dialog } from '@/shared/a11y'
import { useFocusTrap, useFocusRestore } from '@/shared/a11y'

interface AutoSuspendRegexPanelProps {
  settings: Settings
  onChange: (rules: AutoSuspendRule[]) => void
}

interface MatchingTab {
  id: number
  title?: string
  url: string
  windowId?: number
  groupName?: string
}

const TARGET_OPTIONS: { value: AutoSuspendTarget; label: string }[] = [
  { value: 'url', label: 'Tab URL' },
  { value: 'tabGroupName', label: 'Tab Group Name' },
]

function isValidPattern(pattern: string): boolean {
  if (!pattern.trim()) return true
  try {
    new RegExp(pattern, 'i')
    return true
  } catch {
    return false
  }
}

function isValidRule(rule: AutoSuspendRule): boolean {
  return rule.pattern.trim().length > 0 && isValidPattern(rule.pattern)
}

export function AutoSuspendRegexPanel({ settings, onChange }: AutoSuspendRegexPanelProps) {
  const [rules, setRules] = useState<AutoSuspendRule[]>(settings.suspension.autoSuspendRules)
  const [matchingTabs, setMatchingTabs] = useState<MatchingTab[]>([])
  const [selectedRuleIndex, setSelectedRuleIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useFocusRestore(dialogOpen)

  useFocusTrap(dialogRef, dialogOpen)

  // Keep local state in sync if settings change externally
  useEffect(() => {
    setRules(settings.suspension.autoSuspendRules)
  }, [settings.suspension.autoSuspendRules])

  // Query matching tabs whenever rules change
  useEffect(() => {
    const validRules = rules.filter(isValidRule)
    if (validRules.length === 0) {
      setMatchingTabs([])
      return
    }

    let cancelled = false
    setLoading(true)
    browser.runtime
      .sendMessage({ type: 'GET_MATCHING_TABS', rules: validRules })
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
  }, [rules])

  const updateRules = useCallback(
    (next: AutoSuspendRule[]) => {
      setRules(next)
      onChange(next)
    },
    [onChange]
  )

  const handlePatternChange = (index: number, value: string) => {
    const next = [...rules]
    next[index] = { ...next[index], pattern: value }
    updateRules(next)
  }

  const handleTargetChange = (index: number, target: AutoSuspendTarget) => {
    const next = [...rules]
    next[index] = { ...next[index], target }
    updateRules(next)
  }

  const handleAdd = () => {
    updateRules([...rules, { pattern: '', target: 'url' }])
  }

  const handleRemove = (index: number) => {
    const next = rules.filter((_, i) => i !== index)
    if (next.length === 0) {
      updateRules([{ pattern: '', target: 'url' }])
    } else {
      updateRules(next)
    }
  }

  const countForRule = (rule: AutoSuspendRule): number => {
    if (!isValidRule(rule)) return 0
    try {
      const regex = new RegExp(rule.pattern, 'i')
      if (rule.target === 'tabGroupName') {
        return matchingTabs.filter((tab) => regex.test(tab.groupName ?? '')).length
      }
      return matchingTabs.filter((tab) => regex.test(tab.url)).length
    } catch {
      return 0
    }
  }

  const openDialog = (index: number) => {
    setSelectedRuleIndex(index)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setSelectedRuleIndex(null)
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

  const selectedRule = selectedRuleIndex !== null ? rules[selectedRuleIndex] : null
  const dialogTabs =
    selectedRule && isValidRule(selectedRule)
      ? matchingTabs.filter((tab) => {
          try {
            const regex = new RegExp(selectedRule.pattern, 'i')
            if (selectedRule.target === 'tabGroupName') {
              return regex.test(tab.groupName ?? '')
            }
            return regex.test(tab.url)
          } catch {
            return false
          }
        })
      : []

  const placeholderFor = (target: AutoSuspendTarget) =>
    target === 'tabGroupName' ? 'e.g. ^Work.*' : 'e.g. ^https://mail\\.google\\.com/.*'

  return (
    <div class="space-y-3">
      <div class="text-sm text-raft-600">
        <p>
          Regex patterns that keep tabs awake during <strong>automatic</strong> suspension, startup
          hibernation, and bulk manual actions such as "Suspend All Tabs" and "Suspend Other Tabs".
          Direct single-tab actions (keyboard shortcut, context menu, and the popup's per-tab
          Suspend button) still suspend.
        </p>
        <p class="mt-1 text-raft-500">
          Matching is case-insensitive. Multiple rules are combined with OR.
        </p>
      </div>

      <div class="space-y-2">
        {rules.map((rule, index) => {
          const valid = isValidPattern(rule.pattern)
          const count = countForRule(rule)

          return (
            <div key={index} class="flex items-start gap-2">
              <label htmlFor={`auto-suspend-regex-${index}`} class="sr-only">
                Auto-suspend exception rule {index + 1}
              </label>
              <div class="flex-1 relative">
                <div class="flex rounded-md shadow-sm">
                  <select
                    value={rule.target}
                    onChange={(e) =>
                      handleTargetChange(
                        index,
                        (e.target as unknown as { value: string }).value as AutoSuspendTarget
                      )
                    }
                    class="inline-flex items-center px-2 py-1.5 text-sm border border-r-0 border-raft-300 rounded-l-md bg-raft-50 text-raft-700 focus:ring-raft-500 focus:border-raft-500"
                    aria-label={`Target for rule ${index + 1}`}
                  >
                    {TARGET_OPTIONS.map((opt) => (
                      <option value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <input
                    id={`auto-suspend-regex-${index}`}
                    type="text"
                    value={rule.pattern}
                    onInput={(e) =>
                      handlePatternChange(index, (e.target as HTMLInputElement).value)
                    }
                    placeholder={placeholderFor(rule.target)}
                    class={`flex-1 min-w-0 px-3 py-1.5 text-sm border rounded-r-md focus:ring-raft-500 focus:border-raft-500 ${
                      valid
                        ? 'border-raft-300'
                        : 'border-red-300 focus:ring-red-500 focus:border-red-500'
                    }`}
                    aria-invalid={!valid}
                    aria-describedby={!valid ? `regex-error-${index}` : undefined}
                  />
                </div>
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
                    aria-label={`${count} tab${count !== 1 ? 's' : ''} match rule ${index + 1}`}
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
                  aria-label={`Remove rule ${index + 1}`}
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
        title={`Tabs matching ${selectedRule?.pattern ?? ''}`}
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
                      {tab.groupName && (
                        <p class="text-xs text-raft-400 truncate" title={tab.groupName}>
                          Group: {tab.groupName}
                        </p>
                      )}
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
