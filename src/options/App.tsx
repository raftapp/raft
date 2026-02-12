/**
 * Raft Options Page
 *
 * Settings page with tabbed interface for:
 * - Suspension settings
 * - Session management
 * - About information
 */

import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import type { Settings, RecoverySnapshot } from '@/shared/types'
import { DEFAULT_SETTINGS } from '@/shared/types'
import { settingsStorage, sessionsStorage } from '@/shared/storage'
import { EXTENSION_VERSION, STORAGE_KEYS, CLOUD_SYNC_KEYS, SYNC_LIMITS } from '@/shared/constants'
import { useSessionsStore, type SessionWithStats } from '@/shared/stores/sessionsStore'
import { ImportExportPanel } from './components/ImportExportPanel'
import { CloudSyncPanel } from './components/CloudSyncPanel'
import { DevToolsPanel } from './components/DevToolsPanel'
import { BackupDashboard } from './components/BackupDashboard'
import { ToastContainer, useToast } from '@/shared/components/Toast'
import { Otter } from '@/shared/components/Otter'
import {
  formatRelativeTime,
  isSafeFaviconUrl,
  getFallbackFaviconDataUri,
  debounce,
} from '@/shared/utils'
import { SkipLink, LiveRegion } from '@/shared/a11y'
import { useAnnounce, useFocusTrap, useFocusRestore } from '@/shared/a11y'

type TabType = 'general' | 'sessions' | 'browser-sync' | 'cloud' | 'about' | 'dev'

const TABS: { id: TabType; label: string; badge?: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'browser-sync', label: 'Backup' },
  { id: 'cloud', label: 'Cloud Sync' },
  { id: 'about', label: 'About' },
]

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('general')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [isPro, setIsPro] = useState(false) // Checked asynchronously via checkProStatus()
  const [syncStatus, setSyncStatus] = useState<{
    sessionCount: number
    totalBytes: number
    maxBytes: number
    percentUsed: number
    sessions: { id: string; name: string; createdAt: number; tabCount: number; size: number }[]
    manifestBytes: number
    sessionsBytes: number
    itemCount: number
    maxItems: number
    maxBytesPerItem: number
    compressionEnabled: boolean
    recoverySnapshot: {
      exists: boolean
      bytes: number
      timestamp: number | null
      tabCount: number | null
    }
  } | null>(null)
  const [syncedSessionIds, setSyncedSessionIds] = useState<Set<string>>(new Set())
  const [cloudSyncedIds, setCloudSyncedIds] = useState<Set<string>>(new Set())
  const [cloudSyncStatus, setCloudSyncStatus] = useState<{
    configured: boolean
    enabled: boolean
    lastSyncAt?: number
    email?: string
  } | null>(null)
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([])
  const [recoveryLoading, setRecoveryLoading] = useState(false)
  const [exportReminderState, setExportReminderState] = useState<{
    pending: boolean
    reason: 'time' | 'milestone'
    daysSinceExport?: number
    milestone?: number
    triggeredAt: number
  } | null>(null)
  const [restoringSync, setRestoringSync] = useState(false)
  const [clearingSync, setClearingSync] = useState(false)

  // Toast notifications
  const { toasts, dismissToast, success, error: showError } = useToast()

  // Screen reader announcements
  const { message: announceMessage, priority: announcePriority } = useAnnounce()

  // Tab navigation refs
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Sessions store
  const {
    sessions,
    loading: sessionsLoading,
    searchQuery,
    loadSessions,
    saveCurrentSession,
    restoreSession,
    deleteSession,
    renameSession,
    setSearchQuery,
  } = useSessionsStore()

  // Debounced settings save to reduce storage writes
  const debouncedSaveSettings = useRef(
    debounce(async (updated: Settings) => {
      await settingsStorage.save(updated)
      await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: updated })
      success('Settings saved')
    }, 500)
  ).current

  const loadSyncStatus = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: 'GET_SYNC_STATUS' })
      .then((response) => {
        if (response.success) {
          setSyncStatus(response.data)
          setSyncedSessionIds(new Set(response.data.sessions.map((s: { id: string }) => s.id)))
        }
      })
      .catch(() => {
        // Sync status check failed, ignore
      })
  }, [])

  const loadCloudSyncedIds = useCallback(() => {
    Promise.all([
      chrome.runtime.sendMessage({ type: 'CLOUD_GET_SYNCED_IDS' }),
      chrome.runtime.sendMessage({ type: 'CLOUD_GET_STATUS' }),
    ])
      .then(([idsResponse, statusResponse]) => {
        if (idsResponse.success) {
          setCloudSyncedIds(new Set(idsResponse.data as string[]))
        }
        if (statusResponse.success) {
          setCloudSyncStatus(statusResponse.data)
        }
      })
      .catch(() => {
        // Cloud sync check failed, ignore
      })
  }, [])

  const loadRecoverySnapshots = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: 'GET_RECOVERY_SNAPSHOTS' })
      .then((response) => {
        if (response.success) {
          setRecoverySnapshots(response.data)
        }
      })
      .catch(() => {
        // Recovery snapshots check failed, ignore
      })
  }, [])

  const loadExportReminderState = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: 'GET_EXPORT_REMINDER_STATE' })
      .then((response) => {
        if (response.success) {
          setExportReminderState(response.data)
        }
      })
      .catch(() => {
        // Export reminder check failed, ignore
      })
  }, [])

  const dismissExportReminder = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: 'DISMISS_EXPORT_REMINDER' })
      .then(() => {
        setExportReminderState(null)
        success('Reminder dismissed')
      })
      .catch(() => {
        showError('Failed to dismiss reminder')
      })
  }, [success, showError])

  const markExportComplete = useCallback(() => {
    chrome.runtime
      .sendMessage({ type: 'MARK_EXPORT_COMPLETE' })
      .then(() => {
        setExportReminderState(null)
        // Refresh settings to show updated lastExportDate
        settingsStorage.get().then(setSettings)
      })
      .catch(() => {
        // Ignore error
      })
  }, [])

  useEffect(() => {
    settingsStorage.get().then((s) => {
      setSettings(s)
      setLoading(false)
    })
    loadSessions()
    loadSyncStatus()
    loadCloudSyncedIds()
    loadRecoverySnapshots()
    loadExportReminderState()

    // Check Pro status
    checkProStatus()

    // Listen for storage changes to refresh data in real-time
    const handleLocalStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes[STORAGE_KEYS.SESSIONS]) {
        loadSessions()
      }
      if (changes[STORAGE_KEYS.LAST_BACKUP_STATUS]) {
        loadSyncStatus()
      }
      if (changes[STORAGE_KEYS.RECOVERY_SNAPSHOTS]) {
        loadRecoverySnapshots()
      }
      if (changes[STORAGE_KEYS.EXPORT_REMINDER_STATE]) {
        loadExportReminderState()
      }
      if (changes[CLOUD_SYNC_KEYS.SYNCED_IDS]) {
        loadCloudSyncedIds()
      }
    }

    // Listen for sync storage changes to refresh Browser Sync tab
    const handleSyncStorageChange = () => {
      loadSyncStatus()
    }

    chrome.storage.local.onChanged.addListener(handleLocalStorageChange)
    chrome.storage.sync.onChanged.addListener(handleSyncStorageChange)
    return () => {
      chrome.storage.local.onChanged.removeListener(handleLocalStorageChange)
      chrome.storage.sync.onChanged.removeListener(handleSyncStorageChange)
    }
  }, [
    loadSessions,
    loadSyncStatus,
    loadCloudSyncedIds,
    loadRecoverySnapshots,
    loadExportReminderState,
  ])

  const checkProStatus = () => {
    chrome.runtime
      .sendMessage({ type: 'PRO_CHECK_STATUS' })
      .then((response) => {
        if (response.success) {
          setIsPro(response.data.isPro)
        }
      })
      .catch(() => {
        // Pro check failed, default to false
        setIsPro(false)
      })
  }

  // Get current tab index for arrow navigation
  const getCurrentTabIndex = () => {
    const allTabs = import.meta.env.DEV
      ? [...TABS, { id: 'dev' as TabType, label: 'Dev Tools' }]
      : TABS
    return allTabs.findIndex((t) => t.id === activeTab)
  }

  // Handle arrow key navigation for tabs
  const handleTabKeyDown = (e: KeyboardEvent) => {
    const allTabs = import.meta.env.DEV
      ? [...TABS, { id: 'dev' as TabType, label: 'Dev Tools' }]
      : TABS
    const currentIndex = getCurrentTabIndex()
    let newIndex = currentIndex

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault()
        newIndex = currentIndex === 0 ? allTabs.length - 1 : currentIndex - 1
        break
      case 'ArrowRight':
        e.preventDefault()
        newIndex = currentIndex === allTabs.length - 1 ? 0 : currentIndex + 1
        break
      case 'Home':
        e.preventDefault()
        newIndex = 0
        break
      case 'End':
        e.preventDefault()
        newIndex = allTabs.length - 1
        break
      default:
        return
    }

    if (newIndex !== currentIndex) {
      setActiveTab(allTabs[newIndex].id)
      tabRefs.current[newIndex]?.focus()
    }
  }

  const handleSettingChange = (update: {
    suspension?: Partial<Settings['suspension']>
    autoSave?: Partial<Settings['autoSave']>
    ui?: Partial<Settings['ui']>
    exportReminder?: Partial<Settings['exportReminder']>
  }) => {
    const updated: Settings = {
      ...settings,
      suspension: { ...settings.suspension, ...(update.suspension || {}) },
      autoSave: { ...settings.autoSave, ...(update.autoSave || {}) },
      ui: { ...settings.ui, ...(update.ui || {}) },
      exportReminder: { ...settings.exportReminder, ...(update.exportReminder || {}) },
    }
    setSettings(updated)
    debouncedSaveSettings(updated)
  }

  const handleSaveSession = async () => {
    try {
      await saveCurrentSession()
      success('Session saved')
    } catch {
      showError('Failed to save session')
    }
  }

  const handleRestoreSession = async (sessionId: string, asSuspended: boolean) => {
    try {
      const result = await restoreSession(sessionId, asSuspended)
      if (result) {
        if (result.windowsFailed > 0) {
          showError(
            `Restored ${result.tabsCreated} tabs but ${result.windowsFailed} window${result.windowsFailed !== 1 ? 's' : ''} failed`
          )
        } else {
          success(`Restored ${result.tabsCreated} tabs`)
        }
      }
    } catch {
      showError('Failed to restore session')
    }
  }

  const handleDeleteSession = async (id: string) => {
    try {
      // Save session data for potential undo
      const sessionToDelete = sessions.find((s) => s.id === id)
      await deleteSession(id)
      setDeleteConfirm(null)

      if (sessionToDelete) {
        success('Session deleted', 8000, {
          label: 'Undo',
          onClick: () => {
            sessionsStorage
              .save(sessionToDelete)
              .then(() => {
                loadSessions()
                success('Session restored')
              })
              .catch(() => {
                showError('Failed to undo deletion')
              })
          },
        })
      } else {
        success('Session deleted')
      }
    } catch {
      showError('Failed to delete session')
    }
  }

  const handleRestoreRecoverySnapshot = async (snapshotId: string) => {
    setRecoveryLoading(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RESTORE_RECOVERY_SNAPSHOT',
        snapshotId,
      })
      if (response.success) {
        success(
          `Restored ${response.data.tabsCreated} tabs in ${response.data.windowsCreated} windows`
        )
      } else {
        showError(response.error || 'Failed to restore snapshot')
      }
    } catch {
      showError('Failed to restore snapshot')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const handleDeleteRecoverySnapshot = async (snapshotId: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_RECOVERY_SNAPSHOT',
        snapshotId,
      })
      if (response.success) {
        setRecoverySnapshots((prev) => prev.filter((s) => s.id !== snapshotId))
        success('Snapshot deleted')
      } else {
        showError(response.error || 'Failed to delete snapshot')
      }
    } catch {
      showError('Failed to delete snapshot')
    }
  }

  const handleRenameSession = async (sessionId: string, name: string) => {
    const ok = await renameSession(sessionId, name)
    if (ok) {
      success('Session renamed')
    } else {
      showError('Failed to rename session')
    }
  }

  if (loading) {
    return (
      <div
        class="min-h-screen bg-raft-50 flex items-center justify-center"
        role="status"
        aria-busy="true"
        aria-label="Loading settings"
      >
        <p class="text-raft-500">Loading...</p>
      </div>
    )
  }

  return (
    <div class="min-h-screen bg-raft-50">
      {/* Skip link for keyboard navigation */}
      <SkipLink href="#main-content">Skip to main content</SkipLink>

      {/* Live region for screen reader announcements */}
      <LiveRegion message={announceMessage} priority={announcePriority} />

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <div class="max-w-3xl mx-auto py-8 px-4">
        <header class="mb-6 flex items-center gap-3">
          <Otter className="w-10 h-10 shrink-0" />
          <div>
            <h1 class="text-2xl font-bold text-raft-900">Raft Settings</h1>
            <p class="text-raft-600 mt-1">Your tabs, holding hands</p>
          </div>
        </header>

        {/* Tab Navigation - uses arrow keys for navigation (WCAG tablist pattern) */}
        <nav
          class="flex border-b border-raft-200 mb-6"
          role="tablist"
          aria-label="Settings sections"
          onKeyDown={handleTabKeyDown}
        >
          <button
            ref={(el) => {
              tabRefs.current[0] = el
            }}
            onClick={() => setActiveTab('general')}
            role="tab"
            aria-selected={activeTab === 'general'}
            aria-controls="panel-general"
            id="tab-general"
            tabIndex={activeTab === 'general' ? 0 : -1}
            class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
              activeTab === 'general'
                ? 'border-raft-600 text-raft-600'
                : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
            }`}
          >
            General
          </button>
          <button
            ref={(el) => {
              tabRefs.current[1] = el
            }}
            onClick={() => setActiveTab('sessions')}
            role="tab"
            aria-selected={activeTab === 'sessions'}
            aria-controls="panel-sessions"
            id="tab-sessions"
            tabIndex={activeTab === 'sessions' ? 0 : -1}
            class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
              activeTab === 'sessions'
                ? 'border-raft-600 text-raft-600'
                : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
            }`}
          >
            Sessions
            {sessions.length > 0 && (
              <span
                class="ml-2 px-1.5 py-0.5 text-xs bg-raft-100 text-raft-600 rounded"
                aria-label={`${sessions.length} sessions`}
              >
                {sessions.length}
              </span>
            )}
          </button>
          <button
            ref={(el) => {
              tabRefs.current[2] = el
            }}
            onClick={() => setActiveTab('browser-sync')}
            role="tab"
            aria-selected={activeTab === 'browser-sync'}
            aria-controls="panel-browser-sync"
            id="tab-browser-sync"
            tabIndex={activeTab === 'browser-sync' ? 0 : -1}
            class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
              activeTab === 'browser-sync'
                ? 'border-raft-600 text-raft-600'
                : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
            }`}
          >
            Backup
          </button>
          <button
            ref={(el) => {
              tabRefs.current[3] = el
            }}
            onClick={() => setActiveTab('cloud')}
            role="tab"
            aria-selected={activeTab === 'cloud'}
            aria-controls="panel-cloud"
            id="tab-cloud"
            tabIndex={activeTab === 'cloud' ? 0 : -1}
            class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
              activeTab === 'cloud'
                ? 'border-raft-600 text-raft-600'
                : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
            }`}
          >
            Cloud Sync
            {!isPro && (
              <span
                class="ml-2 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded"
                aria-hidden="true"
              >
                Pro
              </span>
            )}
          </button>
          <button
            ref={(el) => {
              tabRefs.current[4] = el
            }}
            onClick={() => setActiveTab('about')}
            role="tab"
            aria-selected={activeTab === 'about'}
            aria-controls="panel-about"
            id="tab-about"
            tabIndex={activeTab === 'about' ? 0 : -1}
            class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
              activeTab === 'about'
                ? 'border-raft-600 text-raft-600'
                : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
            }`}
          >
            About
          </button>
          {import.meta.env.DEV && (
            <button
              ref={(el) => {
                tabRefs.current[5] = el
              }}
              onClick={() => setActiveTab('dev')}
              role="tab"
              aria-selected={activeTab === 'dev'}
              aria-controls="panel-dev"
              id="tab-dev"
              tabIndex={activeTab === 'dev' ? 0 : -1}
              class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors focus:outline-none focus:ring-2 focus:ring-raft-400 focus:ring-offset-2 ${
                activeTab === 'dev'
                  ? 'border-raft-600 text-raft-600'
                  : 'border-transparent text-raft-500 hover:text-raft-700 hover:border-raft-300'
              }`}
            >
              Dev Tools
              <span
                class="ml-2 px-1.5 py-0.5 text-xs bg-orange-100 text-orange-600 rounded"
                aria-hidden="true"
              >
                DEV
              </span>
            </button>
          )}
        </nav>

        <main id="main-content" tabIndex={-1}>
          {/* General Tab */}
          {activeTab === 'general' && (
            <div id="panel-general" role="tabpanel" aria-labelledby="tab-general" class="space-y-6">
              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Auto-Suspend</h2>
                <p class="text-sm text-raft-500 mb-3">
                  Uses Chrome's native tab suspension to free memory. Suspended tabs reload
                  instantly when clicked.
                </p>

                <div class="space-y-4">
                  <label class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.suspension.enabled}
                      onChange={(e) =>
                        handleSettingChange({
                          suspension: { enabled: (e.target as HTMLInputElement).checked },
                        })
                      }
                      class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                    />
                    <span class="text-raft-700">Auto-suspend inactive tabs</span>
                  </label>

                  <div class={`pl-7 space-y-3 ${!settings.suspension.enabled ? 'opacity-50' : ''}`}>
                    <div>
                      <label htmlFor="inactivity-minutes" class="block text-sm text-raft-600 mb-1">
                        Suspend after inactivity (minutes)
                      </label>
                      <input
                        id="inactivity-minutes"
                        type="number"
                        min="1"
                        max="1440"
                        value={settings.suspension.inactivityMinutes}
                        onChange={(e) =>
                          handleSettingChange({
                            suspension: {
                              inactivityMinutes: Math.max(
                                1,
                                Math.min(
                                  1440,
                                  parseInt((e.target as HTMLInputElement).value, 10) || 30
                                )
                              ),
                            },
                          })
                        }
                        disabled={!settings.suspension.enabled}
                        class="w-24 px-3 py-1.5 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500 disabled:bg-raft-100"
                      />
                    </div>

                    <label class="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={settings.suspension.neverSuspendPinned}
                        onChange={(e) =>
                          handleSettingChange({
                            suspension: {
                              neverSuspendPinned: (e.target as HTMLInputElement).checked,
                            },
                          })
                        }
                        disabled={!settings.suspension.enabled}
                        class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                      />
                      <span class="text-sm text-raft-600">Never suspend pinned tabs</span>
                    </label>

                    <label class="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={settings.suspension.neverSuspendAudio}
                        onChange={(e) =>
                          handleSettingChange({
                            suspension: {
                              neverSuspendAudio: (e.target as HTMLInputElement).checked,
                            },
                          })
                        }
                        disabled={!settings.suspension.enabled}
                        class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                      />
                      <span class="text-sm text-raft-600">Never suspend tabs playing audio</span>
                    </label>

                    {/* Form detection feature hidden until implemented */}
                  </div>
                </div>
              </section>

              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Auto-Save Sessions</h2>

                <div class="space-y-4">
                  <label class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.autoSave.enabled}
                      onChange={(e) =>
                        handleSettingChange({
                          autoSave: { enabled: (e.target as HTMLInputElement).checked },
                        })
                      }
                      class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                    />
                    <span class="text-raft-700">Periodically save current session</span>
                  </label>

                  <div class={`pl-7 space-y-3 ${!settings.autoSave.enabled ? 'opacity-50' : ''}`}>
                    <div>
                      <label htmlFor="save-interval" class="block text-sm text-raft-600 mb-1">
                        Save interval (minutes)
                      </label>
                      <input
                        id="save-interval"
                        type="number"
                        min="5"
                        max="1440"
                        value={settings.autoSave.intervalMinutes}
                        onChange={(e) =>
                          handleSettingChange({
                            autoSave: {
                              intervalMinutes: Math.max(
                                5,
                                Math.min(
                                  1440,
                                  parseInt((e.target as HTMLInputElement).value, 10) || 60
                                )
                              ),
                            },
                          })
                        }
                        disabled={!settings.autoSave.enabled}
                        class="w-24 px-3 py-1.5 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500 disabled:bg-raft-100"
                      />
                    </div>

                    <div>
                      <label htmlFor="max-slots" class="block text-sm text-raft-600 mb-1">
                        Maximum auto-save slots
                      </label>
                      <input
                        id="max-slots"
                        type="number"
                        min="1"
                        max="20"
                        value={settings.autoSave.maxSlots}
                        onChange={(e) =>
                          handleSettingChange({
                            autoSave: {
                              maxSlots: Math.max(
                                1,
                                Math.min(
                                  20,
                                  parseInt((e.target as HTMLInputElement).value, 10) || 5
                                )
                              ),
                            },
                          })
                        }
                        disabled={!settings.autoSave.enabled}
                        class="w-24 px-3 py-1.5 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500 disabled:bg-raft-100"
                      />
                    </div>
                  </div>
                </div>
              </section>

              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">UI Preferences</h2>

                <div class="space-y-4">
                  <label class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.ui.showBadge}
                      onChange={(e) =>
                        handleSettingChange({
                          ui: { showBadge: (e.target as HTMLInputElement).checked },
                        })
                      }
                      class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                    />
                    <span class="text-raft-700">Show suspended tab count in badge</span>
                  </label>
                </div>
              </section>

              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Backup Reminders</h2>

                <div class="text-sm text-raft-600 mb-4">
                  <p>
                    Browser sync keeps your sessions on devices with the same Chrome profile, but{' '}
                    <strong>does not survive extension uninstall</strong>. Export backups
                    periodically to keep your data safe.
                  </p>
                  {isPro && (
                    <p class="text-green-600 mt-2">
                      You have Pro! Cloud Sync automatically backs up to Google Drive.
                    </p>
                  )}
                </div>

                <div class="space-y-4">
                  <label class="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.exportReminder.enabled}
                      onChange={(e) =>
                        handleSettingChange({
                          exportReminder: { enabled: (e.target as HTMLInputElement).checked },
                        })
                      }
                      class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                    />
                    <span class="text-raft-700">Enable periodic backup reminders</span>
                  </label>

                  <div
                    class={`pl-7 space-y-3 ${!settings.exportReminder.enabled ? 'opacity-50' : ''}`}
                  >
                    <div>
                      <label htmlFor="reminder-interval" class="block text-sm text-raft-600 mb-1">
                        Remind me every (days)
                      </label>
                      <input
                        id="reminder-interval"
                        type="number"
                        min="7"
                        max="365"
                        value={settings.exportReminder.intervalDays}
                        onChange={(e) =>
                          handleSettingChange({
                            exportReminder: {
                              intervalDays: Math.max(
                                7,
                                Math.min(
                                  365,
                                  parseInt((e.target as HTMLInputElement).value, 10) || 30
                                )
                              ),
                            },
                          })
                        }
                        disabled={!settings.exportReminder.enabled}
                        class="w-24 px-3 py-1.5 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500 disabled:bg-raft-100"
                      />
                    </div>

                    {settings.exportReminder.lastExportDate && (
                      <p class="text-sm text-raft-500">
                        Last export: {formatRelativeTime(settings.exportReminder.lastExportDate)}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Sessions Tab */}
          {activeTab === 'sessions' && (
            <div
              id="panel-sessions"
              role="tabpanel"
              aria-labelledby="tab-sessions"
              class="space-y-4"
            >
              {/* Export Reminder Banner */}
              {exportReminderState?.pending && !isPro && (
                <div
                  role="alert"
                  class="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3"
                >
                  <svg
                    class="w-5 h-5 text-amber-500 shrink-0 mt-0.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div class="flex-1">
                    <p class="font-medium text-amber-800">
                      {exportReminderState.reason === 'time'
                        ? `It's been ${exportReminderState.daysSinceExport} days since your last export`
                        : `You have ${exportReminderState.milestone} sessions!`}
                    </p>
                    <p class="text-sm text-amber-700 mt-1">
                      {exportReminderState.reason === 'time'
                        ? `Export your sessions to keep them safe. Browser sync doesn't survive uninstall.`
                        : `Great milestone! Consider exporting a backup to keep your data safe.`}
                    </p>
                    <div class="flex gap-2 mt-3">
                      <button
                        onClick={() => {
                          // Scroll to export panel or click export
                          setActiveTab('sessions')
                          success('Use the Export button above to download your sessions')
                        }}
                        class="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
                      >
                        Export Now
                      </button>
                      <button
                        onClick={dismissExportReminder}
                        class="px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 rounded transition-colors"
                      >
                        Remind Me Later
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Import/Export Panel */}
              <ImportExportPanel
                sessions={sessions}
                onImportComplete={loadSessions}
                onExportComplete={markExportComplete}
              />

              {/* Header with Save and Search */}
              <div class="flex items-center gap-4">
                <button
                  onClick={handleSaveSession}
                  disabled={sessionsLoading}
                  class="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  Save Current Session
                </button>
                <div class="flex-1">
                  <label htmlFor="options-session-search" class="sr-only">
                    Search sessions
                  </label>
                  <input
                    id="options-session-search"
                    type="text"
                    placeholder="Search sessions..."
                    value={searchQuery}
                    onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                    class="w-full px-3 py-2 text-sm border border-raft-300 rounded-lg focus:ring-raft-500 focus:border-raft-500"
                  />
                </div>
              </div>

              {/* Session List */}
              {sessionsLoading ? (
                <div class="text-center py-8 text-raft-500">Loading sessions...</div>
              ) : sessions.length === 0 ? (
                <div class="bg-white rounded-lg shadow-sm border border-raft-200 p-8 text-center">
                  <p class="text-raft-500">
                    {searchQuery ? 'No sessions match your search.' : 'No saved sessions yet.'}
                  </p>
                  <p class="text-raft-400 text-sm mt-1">
                    Click "Save Current Session" to save your current windows and tabs.
                  </p>
                </div>
              ) : (
                <div class="space-y-3">
                  {sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      isSynced={syncedSessionIds.has(session.id)}
                      isCloudSynced={cloudSyncedIds.has(session.id)}
                      onRestore={(asSuspended) => handleRestoreSession(session.id, asSuspended)}
                      onRename={(name) => handleRenameSession(session.id, name)}
                      onDelete={() => setDeleteConfirm(session.id)}
                      deleteConfirm={deleteConfirm === session.id}
                      onDeleteConfirm={() => handleDeleteSession(session.id)}
                      onDeleteCancel={() => setDeleteConfirm(null)}
                    />
                  ))}
                </div>
              )}

              {/* Recovery Snapshots Section */}
              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6 mt-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-2">Recovery Snapshots</h2>
                <p class="text-sm text-raft-500 mb-4">
                  Automatic snapshots of your browser state for crash recovery. Raft captures all
                  your tabs every 5 minutes, keeping the last 5 snapshots.
                </p>

                {recoverySnapshots.length === 0 ? (
                  <p class="text-sm text-raft-400 italic">
                    No recovery snapshots yet. Snapshots are captured automatically.
                  </p>
                ) : (
                  <ul class="space-y-2">
                    {recoverySnapshots.map((snapshot) => (
                      <li
                        key={snapshot.id}
                        class="flex items-center justify-between py-2 px-3 bg-raft-50 rounded-lg"
                      >
                        <div class="flex-1">
                          <p class="text-sm font-medium text-raft-700">
                            {formatRelativeTime(snapshot.timestamp)}
                          </p>
                          <p class="text-xs text-raft-500">
                            {snapshot.stats.windowCount}{' '}
                            {snapshot.stats.windowCount === 1 ? 'window' : 'windows'},{' '}
                            {snapshot.stats.tabCount}{' '}
                            {snapshot.stats.tabCount === 1 ? 'tab' : 'tabs'}
                            {snapshot.stats.groupCount > 0 && (
                              <>
                                , {snapshot.stats.groupCount}{' '}
                                {snapshot.stats.groupCount === 1 ? 'group' : 'groups'}
                              </>
                            )}
                          </p>
                        </div>
                        <div class="flex items-center gap-2">
                          <button
                            onClick={() => handleRestoreRecoverySnapshot(snapshot.id)}
                            disabled={recoveryLoading}
                            class="px-3 py-1.5 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 transition-colors disabled:opacity-50"
                            aria-label={`Restore snapshot from ${formatRelativeTime(snapshot.timestamp)}`}
                          >
                            {recoveryLoading ? 'Restoring...' : 'Restore'}
                          </button>
                          <button
                            onClick={() => handleDeleteRecoverySnapshot(snapshot.id)}
                            disabled={recoveryLoading}
                            class="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                            aria-label={`Delete snapshot from ${formatRelativeTime(snapshot.timestamp)}`}
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {/* Backup Tab */}
          {activeTab === 'browser-sync' && (
            <div
              id="panel-browser-sync"
              role="tabpanel"
              aria-labelledby="tab-browser-sync"
              class="space-y-6"
            >
              <BackupDashboard
                isPro={isPro}
                onNavigateTab={setActiveTab as (tab: string) => void}
              />

              {/* Cloud Sync Backup Section */}
              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Cloud Sync Backup</h2>

                {cloudSyncStatus?.configured ? (
                  <div class="space-y-4">
                    <div class="flex items-center gap-3 text-sm">
                      <span
                        class={`w-2 h-2 rounded-full shrink-0 ${cloudSyncStatus.enabled ? 'bg-green-500' : 'bg-raft-300'}`}
                      />
                      <span class="text-raft-700">
                        {cloudSyncStatus.enabled ? 'Connected' : 'Disabled'}
                      </span>
                      {cloudSyncStatus.email && (
                        <span class="text-raft-500">{cloudSyncStatus.email}</span>
                      )}
                    </div>

                    {cloudSyncStatus.lastSyncAt && (
                      <p class="text-sm text-raft-500">
                        Last synced: {formatRelativeTime(cloudSyncStatus.lastSyncAt)}
                      </p>
                    )}

                    <div class="border-t border-raft-100 pt-4">
                      <h3 class="text-sm font-medium text-raft-700 mb-3">
                        Cloud Sessions ({cloudSyncedIds.size})
                      </h3>

                      {cloudSyncedIds.size > 0 ? (
                        <ul class="space-y-2">
                          {sessions
                            .filter((s) => cloudSyncedIds.has(s.id))
                            .map((session) => (
                              <li key={session.id} class="flex items-center gap-2 text-sm">
                                <svg
                                  class="w-4 h-4 text-blue-500 shrink-0"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                  stroke-width="1.5"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                                  />
                                </svg>
                                <span class="text-raft-700 truncate flex-1">{session.name}</span>
                                <span class="text-raft-500 shrink-0">
                                  {session.stats.tabs} tab{session.stats.tabs !== 1 ? 's' : ''}
                                </span>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p class="text-sm text-raft-500">
                          No sessions synced to cloud yet. Sessions will appear here after the next
                          sync.
                        </p>
                      )}
                    </div>

                    <div class="border-t border-raft-100 pt-3">
                      <button
                        onClick={() => setActiveTab('cloud' as TabType)}
                        class="text-sm text-raft-600 hover:text-raft-800 transition-colors"
                      >
                        Manage cloud sync settings &rarr;
                      </button>
                    </div>
                  </div>
                ) : (
                  <div class="text-sm text-raft-500 space-y-3">
                    <p>
                      Cloud sync backs up your sessions to Google Drive with end-to-end encryption.
                      Requires Raft Pro.
                    </p>
                    <button
                      onClick={() => setActiveTab('cloud' as TabType)}
                      class="text-sm text-raft-600 hover:text-raft-800 transition-colors"
                    >
                      Set up cloud sync &rarr;
                    </button>
                  </div>
                )}
              </section>

              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Browser Sync Backup</h2>

                <div class="text-sm text-raft-600 space-y-3 mb-6">
                  <p>
                    Chrome automatically syncs your most recent sessions across devices using the
                    same Chrome profile. This happens automatically when you save sessions.
                  </p>
                  <p class="text-raft-500">
                    Note: Limited to ~{Math.round(SYNC_LIMITS.QUOTA_BYTES / 1024)}KB total,{' '}
                    {Math.round(SYNC_LIMITS.QUOTA_BYTES_PER_ITEM / 1024)}KB per item. When full,
                    oldest sessions are removed to make room for new ones.
                  </p>
                </div>

                <div class="border-t border-raft-100 pt-4">
                  <h3 class="text-sm font-medium text-raft-700 mb-3">
                    Synced Sessions ({syncStatus?.sessionCount ?? 0})
                  </h3>

                  {syncStatus && syncStatus.sessions.length > 0 ? (
                    <>
                      <ul class="space-y-2 mb-4">
                        {syncStatus.sessions.map((session) => (
                          <li key={session.id} class="flex items-center gap-2 text-sm">
                            <svg
                              class="w-4 h-4 text-green-500 shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                              />
                            </svg>
                            <span class="text-raft-700 truncate flex-1">{session.name}</span>
                            <span class="text-raft-500 shrink-0">
                              {session.tabCount} tab{session.tabCount !== 1 ? 's' : ''}
                            </span>
                            <span class="text-raft-400 shrink-0">
                              {(session.size / 1024).toFixed(2)} KB
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div class="flex gap-2 mb-6">
                        <button
                          onClick={() => {
                            setRestoringSync(true)
                            chrome.runtime
                              .sendMessage({ type: 'RESTORE_FROM_SYNC' })
                              .then((response) => {
                                if (response.success) {
                                  const count = response.data.count as number
                                  success(
                                    `Restored ${count} session${count !== 1 ? 's' : ''} from sync`
                                  )
                                  loadSessions()
                                  loadSyncStatus()
                                } else {
                                  showError(response.error || 'Failed to restore from sync')
                                }
                              })
                              .catch(() => showError('Failed to restore from sync'))
                              .finally(() => setRestoringSync(false))
                          }}
                          disabled={restoringSync}
                          class="px-3 py-1.5 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 transition-colors disabled:opacity-50"
                        >
                          {restoringSync ? 'Restoring...' : 'Restore to this device'}
                        </button>
                        <button
                          onClick={() => {
                            if (
                              !globalThis.confirm(
                                'Clear all synced session data? This removes sessions from browser sync across all your Chrome devices.'
                              )
                            ) {
                              return
                            }
                            setClearingSync(true)
                            chrome.runtime
                              .sendMessage({ type: 'CLEAR_SYNC_DATA' })
                              .then((response) => {
                                if (response.success) {
                                  success('Sync data cleared')
                                  loadSyncStatus()
                                } else {
                                  showError(response.error || 'Failed to clear sync data')
                                }
                              })
                              .catch(() => showError('Failed to clear sync data'))
                              .finally(() => setClearingSync(false))
                          }}
                          disabled={clearingSync}
                          class="px-3 py-1.5 text-sm border border-raft-300 text-raft-600 rounded hover:bg-raft-50 transition-colors disabled:opacity-50"
                        >
                          {clearingSync ? 'Clearing...' : 'Clear sync data'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p class="text-sm text-raft-500 mb-6">
                      No sessions synced yet. Save a session to enable automatic backup across your
                      Chrome devices.
                    </p>
                  )}

                  {syncStatus && (
                    <>
                      {/* Storage Progress Bar */}
                      <div class="border-t border-raft-100 pt-4">
                        <div class="flex items-center justify-between text-sm mb-2">
                          <span class="text-raft-600">Storage Used</span>
                          <span class="text-raft-700 font-medium">
                            {(syncStatus.totalBytes / 1024).toFixed(2)} KB /{' '}
                            {Math.round(syncStatus.maxBytes / 1024)} KB (
                            {syncStatus.percentUsed.toFixed(1)}%)
                          </span>
                        </div>
                        <div class="h-2 bg-raft-100 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-green-500 rounded-full transition-all"
                            style={{ width: `${Math.min(syncStatus.percentUsed, 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Storage Breakdown */}
                      <div class="border-t border-raft-100 pt-4 mt-4">
                        <h3 class="text-sm font-medium text-raft-700 mb-3">Storage Breakdown</h3>
                        <div class="grid grid-cols-2 gap-4 text-sm">
                          <div class="bg-raft-50 rounded-lg p-3">
                            <p class="text-raft-500 text-xs mb-1">Manifest</p>
                            <p class="text-raft-700 font-medium">
                              {(syncStatus.manifestBytes / 1024).toFixed(2)} KB
                            </p>
                            <p class="text-raft-400 text-xs">Index of synced sessions</p>
                          </div>
                          <div class="bg-raft-50 rounded-lg p-3">
                            <p class="text-raft-500 text-xs mb-1">Session Data</p>
                            <p class="text-raft-700 font-medium">
                              {(syncStatus.sessionsBytes / 1024).toFixed(2)} KB
                            </p>
                            <p class="text-raft-400 text-xs">
                              {syncStatus.sessionCount} session
                              {syncStatus.sessionCount !== 1 ? 's' : ''} (compressed)
                            </p>
                          </div>
                          <div
                            class={`rounded-lg p-3 ${syncStatus.recoverySnapshot.exists ? 'bg-blue-50' : 'bg-raft-50'}`}
                          >
                            <p class="text-raft-500 text-xs mb-1">Recovery Snapshot</p>
                            <p class="text-raft-700 font-medium">
                              {syncStatus.recoverySnapshot.exists
                                ? `${(syncStatus.recoverySnapshot.bytes / 1024).toFixed(2)} KB`
                                : 'None'}
                            </p>
                            <p class="text-raft-400 text-xs">
                              {syncStatus.recoverySnapshot.exists
                                ? `${syncStatus.recoverySnapshot.tabCount ?? '?'} tabs (syncs across devices)`
                                : 'Waiting for capture...'}
                            </p>
                          </div>
                          <div class="bg-raft-50 rounded-lg p-3">
                            <p class="text-raft-500 text-xs mb-1">Items Used</p>
                            <p class="text-raft-700 font-medium">
                              {syncStatus.itemCount} / {syncStatus.maxItems}
                            </p>
                            <p class="text-raft-400 text-xs">
                              {((syncStatus.itemCount / syncStatus.maxItems) * 100).toFixed(1)}% of
                              item slots
                            </p>
                          </div>
                        </div>
                        {syncStatus.compressionEnabled && (
                          <p class="text-xs text-green-600 mt-3 flex items-center gap-1">
                            <svg
                              class="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              stroke-width="2"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            LZ-String compression enabled (~50% space savings)
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Cloud Sync Tab */}
          {activeTab === 'cloud' && (
            <div id="panel-cloud" role="tabpanel" aria-labelledby="tab-cloud" class="space-y-6">
              <CloudSyncPanel
                isPro={isPro}
                onProStatusChange={checkProStatus}
                onSuccess={success}
                onError={showError}
              />
            </div>
          )}

          {/* About Tab */}
          {activeTab === 'about' && (
            <div id="panel-about" role="tabpanel" aria-labelledby="tab-about" class="space-y-6">
              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">About Raft</h2>

                <div class="text-sm text-raft-600 space-y-3">
                  <p>
                    <strong>Version:</strong> {EXTENSION_VERSION}
                  </p>
                  <p>
                    Raft keeps your tabs safe. Like otters holding hands while they sleep, your tabs
                    stay together and protected. Suspend inactive tabs to save memory, and save your
                    browsing sessions for later.
                  </p>
                  <p>
                    <strong>Features:</strong>
                  </p>
                  <ul class="list-disc list-inside ml-2 space-y-1">
                    <li>Auto-suspend inactive tabs using Chrome's built-in suspension</li>
                    <li>Manual tab suspension with keyboard shortcuts</li>
                    <li>Save and restore complete sessions with tab groups</li>
                    <li>Search across all saved sessions</li>
                    <li>Restore sessions with tabs suspended to save memory</li>
                  </ul>
                </div>
              </section>

              <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
                <h2 class="text-lg font-semibold text-raft-900 mb-4">Keyboard Shortcuts</h2>

                <div class="text-sm text-raft-600 space-y-2">
                  <p>
                    <kbd class="px-2 py-1 bg-raft-100 rounded border text-xs">Alt+Shift+S</kbd>
                    <span class="ml-3">Suspend current tab</span>
                  </p>
                  <p>
                    <kbd class="px-2 py-1 bg-raft-100 rounded border text-xs">Alt+Shift+O</kbd>
                    <span class="ml-3">Suspend other tabs in window</span>
                  </p>
                </div>
              </section>
            </div>
          )}

          {/* Dev Tools Tab (dev mode only) */}
          {import.meta.env.DEV && activeTab === 'dev' && (
            <div id="panel-dev" role="tabpanel" aria-labelledby="tab-dev" class="space-y-6">
              <DevToolsPanel onSuccess={success} onError={showError} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

interface SessionCardProps {
  session: SessionWithStats
  isSynced?: boolean
  isCloudSynced?: boolean
  onRestore: (asSuspended: boolean) => void
  onRename: (name: string) => void
  onDelete: () => void
  deleteConfirm: boolean
  onDeleteConfirm: () => void
  onDeleteCancel: () => void
}

function SessionCard({
  session,
  isSynced,
  isCloudSynced,
  onRestore,
  onRename,
  onDelete,
  deleteConfirm,
  onDeleteConfirm,
  onDeleteCancel,
}: SessionCardProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(session.name)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const deleteConfirmRef = useRef<HTMLDivElement>(null)

  // Focus trap and restore for delete confirmation
  useFocusTrap(deleteConfirmRef, deleteConfirm)
  const restoreFocus = useFocusRestore(deleteConfirm)

  const handleDeleteCancel = () => {
    onDeleteCancel()
    restoreFocus()
  }

  const handleDeleteConfirm = () => {
    onDeleteConfirm()
    restoreFocus()
  }

  const startEditing = () => {
    setEditName(session.name)
    setEditing(true)
    requestAnimationFrame(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    })
  }

  const commitRename = () => {
    setEditing(false)
    const trimmed = editName.trim()
    if (trimmed && trimmed !== session.name) {
      onRename(trimmed)
    }
  }

  const cancelRename = () => {
    setEditing(false)
    setEditName(session.name)
  }

  return (
    <article
      class="bg-white rounded-lg shadow-sm border border-raft-200 p-4"
      aria-label={`Session: ${session.name}, ${session.stats.tabs} tabs, ${session.stats.windows} windows`}
    >
      <div class="flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            {editing ? (
              <input
                ref={nameInputRef}
                type="text"
                value={editName}
                onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') cancelRename()
                }}
                onBlur={commitRename}
                class="font-medium text-raft-900 bg-transparent border-b-2 border-raft-400 focus:border-raft-600 outline-none px-0 py-0 w-full max-w-xs"
                aria-label="Session name"
              />
            ) : (
              <h3
                class="font-medium text-raft-900 truncate cursor-pointer hover:text-raft-600 transition-colors"
                onClick={startEditing}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    startEditing()
                  }
                }}
                role="button"
                tabIndex={0}
                title="Click to rename"
              >
                {session.name}
              </h3>
            )}
            {session.source === 'auto' && (
              <span
                class="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded"
                aria-label="Auto-saved"
              >
                Auto
              </span>
            )}
            {isSynced && (
              <span
                class="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-green-100 text-green-700 rounded"
                aria-label="Backed up via browser sync"
              >
                <svg
                  class="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Synced
              </span>
            )}
            {isCloudSynced && (
              <span
                class="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 rounded"
                aria-label="Backed up to Google Drive"
              >
                <svg
                  class="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  stroke-width="1.5"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M2.25 15a4.5 4.5 0 004.5 4.5H18a3.75 3.75 0 001.332-7.257 3 3 0 00-3.758-3.848 5.25 5.25 0 00-10.233 2.33A4.502 4.502 0 002.25 15z"
                  />
                </svg>
                Cloud
              </span>
            )}
          </div>
          <p class="text-sm text-raft-500 mt-0.5">
            {formatRelativeTime(session.createdAt)} &middot; {session.stats.windows}{' '}
            {session.stats.windows === 1 ? 'window' : 'windows'}, {session.stats.tabs}{' '}
            {session.stats.tabs === 1 ? 'tab' : 'tabs'}
            {session.stats.groups > 0 && (
              <>
                , {session.stats.groups} {session.stats.groups === 1 ? 'group' : 'groups'}
              </>
            )}
          </p>
        </div>

        <div
          class="flex items-center gap-2 ml-4"
          role="group"
          aria-label={`Actions for ${session.name}`}
        >
          {deleteConfirm ? (
            // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- AlertDialog Escape handler
            <div
              ref={deleteConfirmRef}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby={`delete-confirm-${session.id}`}
              aria-describedby={`delete-desc-${session.id}`}
              class="flex items-center gap-2"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleDeleteCancel()
                }
              }}
            >
              <span id={`delete-confirm-${session.id}`} class="text-sm text-red-600">
                Delete?
              </span>
              <span id={`delete-desc-${session.id}`} class="sr-only">
                Confirm deletion of session {session.name}
              </span>
              <button
                onClick={handleDeleteConfirm}
                class="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                aria-label={`Confirm delete ${session.name}`}
              >
                Yes
              </button>
              <button
                onClick={handleDeleteCancel}
                class="px-3 py-1.5 text-sm border border-raft-300 text-raft-700 rounded hover:bg-raft-50 transition-colors"
                aria-label="Cancel deletion"
              >
                No
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowDetails(!showDetails)}
                class="px-3 py-1.5 text-sm text-raft-500 hover:text-raft-700 transition-colors"
                aria-expanded={showDetails}
                aria-controls={`details-${session.id}`}
              >
                {showDetails ? 'Hide' : 'Details'}
              </button>
              <button
                onClick={() => onRestore(false)}
                class="px-3 py-1.5 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 transition-colors"
                aria-label={`Restore ${session.name}`}
              >
                Restore
              </button>
              <button
                onClick={() => onRestore(true)}
                class="px-3 py-1.5 text-sm border border-raft-300 text-raft-700 rounded hover:bg-raft-50 transition-colors"
                aria-label={`Restore ${session.name} with tabs suspended`}
              >
                Restore Suspended
              </button>
              <button
                onClick={onDelete}
                class="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                aria-label={`Delete ${session.name}`}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Session Details */}
      {showDetails && (
        <div id={`details-${session.id}`} class="mt-4 pt-4 border-t border-raft-100">
          <p class="text-xs text-raft-500 mb-3">Created: {formatDate(session.createdAt)}</p>
          {session.windows.map((window, windowIndex) => (
            <div key={window.id} class="mb-3 last:mb-0">
              <p class="text-sm font-medium text-raft-700 mb-1">
                Window {windowIndex + 1}
                {window.focused && <span class="text-raft-400 ml-1">(focused)</span>}
              </p>
              <ul class="ml-4 space-y-0.5">
                {window.tabs.slice(0, 10).map((tab) => {
                  const group = tab.groupId
                    ? window.tabGroups.find((g) => g.id === tab.groupId)
                    : undefined
                  return (
                    <li
                      key={tab.id}
                      class="text-xs text-raft-500 truncate flex items-center gap-1.5"
                    >
                      {tab.favIconUrl && isSafeFaviconUrl(tab.favIconUrl) && (
                        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Favicon fallback, not interactive
                        <img
                          src={tab.favIconUrl}
                          alt=""
                          class="w-3 h-3"
                          onError={(e) => {
                            const img = e.target as HTMLImageElement
                            img.src = getFallbackFaviconDataUri()
                            img.onerror = null
                          }}
                        />
                      )}
                      <span class={tab.pinned ? 'font-medium' : ''}>{tab.title || tab.url}</span>
                      {tab.pinned && <span class="text-blue-400">[pinned]</span>}
                      {group && (
                        <span class="text-purple-400">[{group.title || 'unnamed group'}]</span>
                      )}
                    </li>
                  )
                })}
                {window.tabs.length > 10 && (
                  <li class="text-xs text-raft-400">...and {window.tabs.length - 10} more tabs</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}
