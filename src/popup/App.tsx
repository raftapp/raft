/**
 * Raft Popup Component
 *
 * Main popup that appears when clicking the extension icon.
 * 1Password-inspired design with search, two-panel layout.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'preact/hooks'
import { useSessionsStore } from '@/shared/stores/sessionsStore'
import type { PartialRestoreSelection } from '@/shared/types'
import { SessionCard } from './components/SessionCard'
import { ToastContainer, useToast } from '@/shared/components/Toast'
import { Otter } from '@/shared/components/Otter'
import { BackupHealthBadge } from '@/shared/components/BackupHealth'
import { SkipLink, LiveRegion } from '@/shared/a11y'
import { useFocusTrap, useFocusRestore, useAnnounce } from '@/shared/a11y'
import { STORAGE_KEYS } from '@/shared/constants'
import type { MessageResponse } from '@/shared/types'

interface TabCounts {
  total: number
  suspended: number
  suspendable: number
}

interface CurrentTabStatus {
  tab: {
    id: number
    title: string
    url: string
    suspended: boolean
    pinned: boolean
    audible: boolean
  }
  canSuspend: boolean
  reason?: string
}

async function sendMessage<T>(message: unknown): Promise<T | null> {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse
  if (response.success) {
    return response.data as T
  }
  console.error('Message failed:', response.error)
  return null
}

export function App() {
  const [counts, setCounts] = useState<TabCounts>({ total: 0, suspended: 0, suspendable: 0 })
  const [currentTab, setCurrentTab] = useState<CurrentTabStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [confirmAction, setConfirmAction] = useState<
    'suspendOthers' | 'suspendAll' | 'closeDuplicates' | null
  >(null)
  const [duplicateCount, setDuplicateCount] = useState(0)
  const [syncedSessionIds, setSyncedSessionIds] = useState<Set<string>>(new Set())
  const [cloudSyncedIds, setCloudSyncedIds] = useState<Set<string>>(new Set())
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [sessionName, setSessionName] = useState('')

  // Refs for focus management
  const saveDialogRef = useRef<HTMLDivElement>(null)
  const saveButtonRef = useRef<HTMLButtonElement>(null)

  // Toast notifications
  const { toasts, dismissToast, success, error } = useToast()

  // Screen reader announcements
  const { announce, message: announceMessage, priority: announcePriority } = useAnnounce()

  // Focus trap for save dialog
  useFocusTrap(saveDialogRef, showSaveDialog)
  const restoreFocus = useFocusRestore(showSaveDialog)

  // Sessions store
  const {
    sessions,
    loading: sessionsLoading,
    error: sessionsError,
    loadSessions,
    saveCurrentSession,
    restoreSession,
    restoreSessionPartial,
  } = useSessionsStore()

  // Filter sessions based on search query
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const query = searchQuery.toLowerCase()
    return sessions.filter(
      (session) =>
        session.name.toLowerCase().includes(query) ||
        session.windows.some((w) =>
          w.tabs.some(
            (t) => t.title?.toLowerCase().includes(query) || t.url?.toLowerCase().includes(query)
          )
        )
    )
  }, [sessions, searchQuery])

  // Announce search results when they change
  useEffect(() => {
    if (searchQuery.trim()) {
      const count = filteredSessions.length
      announce(`${count} session${count !== 1 ? 's' : ''} found`)
    }
  }, [filteredSessions.length, searchQuery, announce])

  const refreshData = useCallback(async () => {
    const [tabCounts, tabStatus, dupCount] = await Promise.all([
      sendMessage<TabCounts>({ type: 'GET_TAB_COUNTS' }),
      sendMessage<CurrentTabStatus>({ type: 'GET_CURRENT_TAB_STATUS' }),
      sendMessage<{ count: number }>({ type: 'GET_DUPLICATE_COUNT' }),
    ])

    if (tabCounts) setCounts(tabCounts)
    if (tabStatus) setCurrentTab(tabStatus)
    if (dupCount) setDuplicateCount(dupCount.count)
    setLoading(false)
  }, [])

  const loadSyncStatus = useCallback(async () => {
    const status = await sendMessage<{ sessions: { id: string }[] }>({ type: 'GET_SYNC_STATUS' })
    if (status) {
      setSyncedSessionIds(new Set(status.sessions.map((s) => s.id)))
    }
  }, [])

  const loadCloudSyncedIds = useCallback(async () => {
    const ids = await sendMessage<string[]>({ type: 'CLOUD_GET_SYNCED_IDS' })
    if (ids) {
      setCloudSyncedIds(new Set(ids))
    }
  }, [])

  useEffect(() => {
    refreshData()
    loadSessions()
    loadSyncStatus()
    loadCloudSyncedIds()
  }, [refreshData, loadSessions, loadSyncStatus, loadCloudSyncedIds])

  const getDefaultSessionName = () => `Session ${new Date().toLocaleString()}`

  const handleSaveSession = async () => {
    setActionInProgress(true)
    try {
      const name = sessionName.trim() || undefined
      await saveCurrentSession(name)
      success('Session saved')
      announce('Session saved successfully')
      closeSaveDialog()

      // Check for backup/sync failures after a short delay
      // (backup and cloud sync are fire-and-forget during save)
      setTimeout(async () => {
        try {
          const result = await chrome.storage.local.get([
            STORAGE_KEYS.LAST_BACKUP_STATUS,
            STORAGE_KEYS.LAST_SYNC_ERROR,
          ])
          const now = Date.now()
          const backupStatus = result[STORAGE_KEYS.LAST_BACKUP_STATUS] as
            | { success: boolean; timestamp: number; error?: string }
            | undefined
          const syncError = result[STORAGE_KEYS.LAST_SYNC_ERROR] as
            | { timestamp: number; error?: string }
            | undefined

          if (backupStatus && !backupStatus.success && now - backupStatus.timestamp < 30_000) {
            error('Browser sync backup failed: ' + (backupStatus.error || 'unknown error'))
          }
          if (syncError && now - syncError.timestamp < 30_000) {
            error('Cloud sync failed: ' + (syncError.error || 'unknown error'))
          }
        } catch {
          // Don't fail if status check fails
        }
      }, 3000)
    } catch {
      error('Failed to save session')
      announce('Failed to save session', 'assertive')
    }
    setActionInProgress(false)
  }

  const closeSaveDialog = () => {
    setShowSaveDialog(false)
    setSessionName('')
    restoreFocus()
  }

  const handleRestoreSession = async (sessionId: string, asSuspended: boolean = false) => {
    setActionInProgress(true)
    try {
      const result = await restoreSession(sessionId, asSuspended)
      if (result) {
        if (result.windowsFailed > 0) {
          error(
            `Restored ${result.tabsCreated} tabs but ${result.windowsFailed} window${result.windowsFailed !== 1 ? 's' : ''} failed`
          )
        } else {
          success(`Restored ${result.tabsCreated} tabs`)
        }
      }
    } catch {
      error('Failed to restore session')
    }
    setActionInProgress(false)
  }

  const handleRestorePartial = async (
    sessionId: string,
    selection: PartialRestoreSelection,
    asSuspended: boolean = false
  ) => {
    setActionInProgress(true)
    try {
      const result = await restoreSessionPartial(sessionId, selection, asSuspended)
      if (result) {
        if (result.windowsFailed > 0) {
          error(
            `Restored ${result.tabsCreated} tabs but ${result.windowsFailed} window${result.windowsFailed !== 1 ? 's' : ''} failed`
          )
        } else {
          success(`Restored ${result.tabsCreated} tabs`)
        }
      }
    } catch {
      error('Failed to restore session')
    }
    setActionInProgress(false)
  }

  const handleSuspendTab = async () => {
    if (!currentTab?.tab.id || !currentTab.canSuspend) return

    setActionInProgress(true)
    await sendMessage({ type: 'SUSPEND_TAB', tabId: currentTab.tab.id })
    window.close()
  }

  const handleSuspendOthers = async () => {
    setActionInProgress(true)
    const result = await sendMessage<{ suspended: number }>({ type: 'SUSPEND_OTHER_TABS' })
    await refreshData()
    setActionInProgress(false)

    if (result && result.suspended > 0) {
      success(`Suspended ${result.suspended} tab${result.suspended !== 1 ? 's' : ''}`)
    } else {
      error('No tabs to suspend')
    }
  }

  const handleCloseDuplicates = async () => {
    setActionInProgress(true)
    const result = await sendMessage<{
      duplicatesFound: number
      tabsClosed: number
      protected: number
    }>({
      type: 'CLOSE_DUPLICATES',
    })
    await refreshData()
    setActionInProgress(false)

    if (result && result.tabsClosed > 0) {
      success(`Closed ${result.tabsClosed} duplicate tab${result.tabsClosed !== 1 ? 's' : ''}`)
      announce(`Closed ${result.tabsClosed} duplicate tabs`)
    } else {
      error('No duplicate tabs to close')
    }
  }

  const handleSuspendAll = async () => {
    setActionInProgress(true)
    const result = await sendMessage<{ suspended: number }>({ type: 'SUSPEND_ALL_TABS' })
    await refreshData()
    setActionInProgress(false)

    if (result && result.suspended > 0) {
      success(`Suspended ${result.suspended} tab${result.suspended !== 1 ? 's' : ''}`)
    } else {
      error('No tabs to suspend')
    }
  }

  if (loading) {
    return (
      <div
        class="w-[550px] h-[560px] bg-raft-50 flex items-center justify-center"
        role="status"
        aria-busy="true"
        aria-label="Loading Raft"
      >
        <p class="text-raft-600">Loading...</p>
      </div>
    )
  }

  return (
    <div class="w-[550px] h-[560px] bg-raft-50 flex flex-col overflow-hidden">
      {/* Skip link for keyboard navigation */}
      <SkipLink href="#sessions-list">Skip to sessions</SkipLink>

      {/* Live region for screen reader announcements */}
      <LiveRegion message={announceMessage} priority={announcePriority} />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Header Bar */}
      <header class="flex items-center gap-3 px-3 py-2 bg-white border-b border-raft-200">
        {/* Otter Logo */}
        <div class="w-8 h-8 shrink-0">
          <Otter className="w-full h-full" />
        </div>

        {/* Search Bar */}
        <div class="flex-1 relative">
          <label htmlFor="popup-session-search" class="sr-only">
            Search sessions
          </label>
          <svg
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-raft-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            id="popup-session-search"
            type="text"
            value={searchQuery}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            placeholder="Search sessions..."
            class="w-full pl-9 pr-3 py-2 text-sm bg-raft-50 border border-raft-200 rounded-lg focus:outline-none focus:border-raft-400 focus:bg-white transition-colors"
          />
        </div>

        {/* Save Button */}
        <button
          ref={saveButtonRef}
          onClick={() => setShowSaveDialog(!showSaveDialog)}
          disabled={actionInProgress || sessionsLoading}
          class={`w-8 h-8 rounded-lg text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
            showSaveDialog ? 'bg-green-700' : 'bg-green-600 hover:bg-green-700'
          }`}
          aria-label="Save current session"
          aria-expanded={showSaveDialog}
          aria-controls="save-session-dialog"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>

        {/* Settings Button */}
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          class="w-8 h-8 rounded-lg bg-raft-100 text-raft-600 flex items-center justify-center hover:bg-raft-200 transition-colors shrink-0"
          title="Settings"
          aria-label="Open settings"
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </header>

      {/* Save Session Dialog */}
      {showSaveDialog && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
        <div
          ref={saveDialogRef}
          id="save-session-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-dialog-title"
          class="px-3 py-2 bg-white border-b border-raft-200"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              closeSaveDialog()
            }
          }}
        >
          <h2 id="save-dialog-title" class="sr-only">
            Save current session
          </h2>
          <div class="flex items-center gap-2">
            <label htmlFor="session-name-input" class="sr-only">
              Session name
            </label>
            <input
              id="session-name-input"
              type="text"
              value={sessionName}
              onInput={(e) => setSessionName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSaveSession()
                }
              }}
              placeholder={getDefaultSessionName()}
              class="flex-1 px-3 py-1.5 text-sm border border-raft-300 rounded-lg focus:outline-none focus:border-raft-500"
            />
            <button
              onClick={closeSaveDialog}
              class="px-3 py-1.5 text-sm text-raft-600 hover:text-raft-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveSession}
              disabled={actionInProgress}
              class="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
            >
              {sessionName.trim()
                ? 'Save'
                : `Save (${getDefaultSessionName().substring(0, 20)}...)`}
            </button>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {sessionsError && (
        <div
          role="alert"
          class="mx-3 mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
        >
          Failed to load sessions. Try reopening the popup.
        </div>
      )}

      {/* Current Tab Row */}
      {currentTab &&
        (() => {
          const tabContent = (
            <>
              <div class="flex-1 min-w-0">
                <div
                  class="text-sm font-medium text-raft-800 truncate"
                  title={currentTab.tab.title}
                >
                  {currentTab.tab.title || 'Untitled'}
                </div>
                <div class="text-xs text-raft-600 truncate" title={currentTab.tab.url}>
                  {currentTab.tab.url}
                </div>
              </div>
              {currentTab.tab.suspended ? (
                <span class="shrink-0 px-2 py-1 text-xs bg-green-100 text-green-700 rounded font-medium">
                  Suspended
                </span>
              ) : currentTab.canSuspend ? (
                <span class="shrink-0 px-2 py-1 text-xs bg-amber-200 text-amber-800 rounded font-medium">
                  Click to suspend
                </span>
              ) : (
                <span class="shrink-0 px-2 py-1 text-xs bg-raft-100 text-raft-600 rounded">
                  {currentTab.reason}
                </span>
              )}
            </>
          )

          return currentTab.canSuspend ? (
            <button
              onClick={handleSuspendTab}
              aria-label={`Suspend tab: ${currentTab.tab.title}`}
              class="mx-3 mt-2 px-3 py-2 rounded-lg border flex items-center gap-3 border-amber-300 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 w-auto text-left"
            >
              {tabContent}
            </button>
          ) : (
            <div
              aria-label={`Current tab: ${currentTab.tab.title}`}
              class="mx-3 mt-2 px-3 py-2 rounded-lg border flex items-center gap-3 border-raft-200 bg-white"
            >
              {tabContent}
            </div>
          )
        })()}

      {/* Main Content - Two Panel Layout */}
      <div class="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Panel: Sessions */}
        <div class="w-[340px] border-r border-raft-200 flex flex-col bg-white overflow-hidden">
          {/* Sessions Header */}
          <div class="px-3 pt-3 pb-2 flex items-center justify-between">
            <span class="text-xs font-semibold text-raft-700 uppercase tracking-wide">
              Sessions ({filteredSessions.length})
            </span>
          </div>

          {/* Sessions List */}
          <div id="sessions-list" class="flex-1 overflow-y-auto px-3 pb-4 min-h-0" tabIndex={-1}>
            {filteredSessions.length > 0 ? (
              <div class="space-y-2" role="list" aria-label="Saved sessions">
                {filteredSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    isSynced={syncedSessionIds.has(session.id)}
                    isCloudSynced={cloudSyncedIds.has(session.id)}
                    expanded={expandedSessionId === session.id}
                    onToggleExpand={() =>
                      setExpandedSessionId(expandedSessionId === session.id ? null : session.id)
                    }
                    disabled={actionInProgress}
                    onRestore={(asSuspended) => handleRestoreSession(session.id, asSuspended)}
                    onRestorePartial={(selection, asSuspended) =>
                      handleRestorePartial(session.id, selection, asSuspended)
                    }
                  />
                ))}
              </div>
            ) : searchQuery ? (
              <div class="text-center py-8">
                <p class="text-sm text-raft-600">No sessions match "{searchQuery}"</p>
              </div>
            ) : (
              <div class="text-center py-8">
                <p class="text-sm text-raft-600">No saved sessions yet</p>
                <p class="text-xs text-raft-500 mt-1">Click + to save your current session</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Stats + Actions */}
        <div class="flex-1 p-4 flex flex-col overflow-hidden">
          {/* Stats - shrink-0 to keep fixed size */}
          <div class="space-y-3 shrink-0">
            <div class="flex items-center justify-between">
              <span class="text-sm text-raft-600">Total Tabs</span>
              <span class="text-2xl font-bold text-raft-700">{counts.total}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-raft-600">Suspended</span>
              <span class="text-2xl font-bold text-green-600">{counts.suspended}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-raft-600">Suspendable</span>
              <span class="text-2xl font-bold text-amber-600">{counts.suspendable}</span>
            </div>
            {duplicateCount > 0 && (
              <div class="flex items-center justify-between">
                <span class="text-sm text-red-600">Duplicates</span>
                <span class="text-2xl font-bold text-red-600">{duplicateCount}</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div class="border-t border-raft-200 my-4 shrink-0" />

          {/* Suspend Actions - scrollable if needed */}
          <div class="space-y-3 overflow-y-auto flex-1 min-h-0">
            {confirmAction === 'suspendOthers' ? (
              <div class="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmAction(null)
                    handleSuspendOthers()
                  }}
                  class="flex-1 px-3 py-3 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  class="flex-1 px-3 py-3 text-sm font-medium border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction('suspendOthers')}
                disabled={actionInProgress || counts.suspendable === 0}
                class={`w-full px-4 py-3 text-sm font-medium border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmAction ? 'opacity-30 pointer-events-none' : ''}`}
              >
                Suspend Other Tabs
              </button>
            )}
            {confirmAction === 'suspendAll' ? (
              <div class="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmAction(null)
                    handleSuspendAll()
                  }}
                  class="flex-1 px-3 py-3 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  class="flex-1 px-3 py-3 text-sm font-medium border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction('suspendAll')}
                disabled={actionInProgress || counts.suspendable === 0}
                class={`w-full px-4 py-3 text-sm font-medium bg-raft-600 text-white rounded-lg hover:bg-raft-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmAction ? 'opacity-30 pointer-events-none' : ''}`}
              >
                Suspend All Tabs
              </button>
            )}
            {confirmAction === 'closeDuplicates' ? (
              <div class="flex gap-2">
                <button
                  onClick={() => {
                    setConfirmAction(null)
                    handleCloseDuplicates()
                  }}
                  class="flex-1 px-3 py-3 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmAction(null)}
                  class="flex-1 px-3 py-3 text-sm font-medium border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-100 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmAction('closeDuplicates')}
                disabled={actionInProgress || duplicateCount === 0}
                class={`w-full px-4 py-3 text-sm font-medium border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmAction ? 'opacity-30 pointer-events-none' : ''}`}
              >
                Close Duplicates{duplicateCount > 0 ? ` (${duplicateCount})` : ''}
              </button>
            )}
          </div>

          {/* Footer - shrink-0 to always remain visible */}
          <div class="shrink-0">
            {/* Footer hint */}
            {counts.suspended > 0 && (
              <p class="text-xs text-raft-500 text-center pt-2">
                {counts.suspended} tab{counts.suspended !== 1 && 's'} resting
              </p>
            )}

            {/* Backup Health */}
            <div class="mt-3 pt-3 border-t border-raft-200 flex justify-center">
              <BackupHealthBadge onNavigate={() => chrome.runtime.openOptionsPage()} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
