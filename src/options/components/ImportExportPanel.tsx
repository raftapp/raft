/**
 * Import/Export Panel component for the Options page
 *
 * Provides UI for:
 * - Importing sessions from other tab managers
 * - Exporting sessions as JSON or text
 */

import { useState, useRef } from 'preact/hooks'
import { nanoid } from 'nanoid'
import type { Session, Tab, Window } from '@/shared/types'
import {
  importSessions,
  exportSessions,
  downloadExport,
  getFormatDisplayName,
  MAX_IMPORT_SIZE,
  exportBundle,
  importBundle,
  bundleFilename,
  generateBundlePassphrase,
  BUNDLE_EXTENSION,
  detectImportFormat,
  type ImportResult,
  type ExportResult,
} from '@/shared/importExport'
import { sessionsStorage } from '@/shared/storage'

interface ImportExportPanelProps {
  sessions: Array<Session & { stats: { windows: number; tabs: number; groups: number } }>
  onImportComplete: () => void
  onExportComplete?: () => void
}

type ImportState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; result: ImportResult }
  | { status: 'error'; message: string }

type ExportState =
  | { status: 'idle' }
  | { status: 'success'; result: ExportResult }
  | { status: 'error'; message: string }

/** Modal for the encrypted-bundle export flow. Shows passphrase + download. */
type BundleExportDialog =
  | { status: 'closed' }
  | {
      status: 'open'
      session: Session
      passphrase: string
      blob: globalThis.Blob
      filename: string
      passphraseCopied: boolean
      downloaded: boolean
    }

/** Modal for the encrypted-bundle import flow. Passphrase entry → tab picker. */
type BundleImportDialog =
  | { status: 'closed' }
  | { status: 'awaitingPassphrase'; file: globalThis.File; passphrase: string; error?: string }
  | { status: 'decrypting'; file: globalThis.File }
  | {
      status: 'choosing'
      session: Session
      // tab id -> selected
      selected: Set<string>
    }

export function ImportExportPanel({
  sessions,
  onImportComplete,
  onExportComplete,
}: ImportExportPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [bundleExport, setBundleExport] = useState<BundleExportDialog>({ status: 'closed' })
  const [bundleImport, setBundleImport] = useState<BundleImportDialog>({ status: 'closed' })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = async (e: globalThis.Event) => {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]

    if (!file) {
      return
    }

    // Check file size
    if (file.size > MAX_IMPORT_SIZE) {
      setImportState({
        status: 'error',
        message: `File too large. Maximum size is ${MAX_IMPORT_SIZE / 1024 / 1024}MB`,
      })
      return
    }

    // Encrypted bundles need a passphrase before they can be parsed. Detect by
    // extension or by sniffing the JSON envelope shape and route to the
    // bundle-import flow instead of the auto-detect parser.
    if (file.name.toLowerCase().endsWith(BUNDLE_EXTENSION)) {
      setBundleImport({ status: 'awaitingPassphrase', file, passphrase: '' })
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    setImportState({ status: 'loading' })

    try {
      const content = await file.text()

      if (detectImportFormat(content) === 'raftbundle') {
        setBundleImport({ status: 'awaitingPassphrase', file, passphrase: '' })
        setImportState({ status: 'idle' })
        return
      }

      const result = importSessions(content)

      if (!result.success && result.errors.length > 0) {
        setImportState({
          status: 'error',
          message: result.errors[0].message,
        })
        return
      }

      if (result.sessions.length === 0) {
        setImportState({
          status: 'error',
          message: 'No valid sessions found in file',
        })
        return
      }

      // Save all imported sessions atomically via batch write
      const existing = await sessionsStorage.getAll()
      const existingMap = new Map(existing.map((s) => [s.id, s]))
      for (const session of result.sessions) {
        existingMap.set(session.id, session)
      }
      await sessionsStorage.saveAll(Array.from(existingMap.values()))

      setImportState({ status: 'success', result })
      onImportComplete()
    } catch (err) {
      setImportState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to read file',
      })
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleEncryptedExport = async (sessionId: string) => {
    const sessionWithStats = sessions.find((s) => s.id === sessionId)
    if (!sessionWithStats) return

    // Strip the UI-only stats wrapper before serializing.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { stats: _stats, ...session } = sessionWithStats
    const target = session as Session

    try {
      const passphrase = generateBundlePassphrase()
      const blob = await exportBundle(target, passphrase)
      setBundleExport({
        status: 'open',
        session: target,
        passphrase,
        blob,
        filename: bundleFilename(target),
        passphraseCopied: false,
        downloaded: false,
      })
    } catch (err) {
      setExportState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to encrypt bundle',
      })
    }
  }

  const handleCopyPassphrase = async () => {
    if (bundleExport.status !== 'open') return
    try {
      await globalThis.navigator.clipboard.writeText(bundleExport.passphrase)
      setBundleExport({ ...bundleExport, passphraseCopied: true })
    } catch {
      // Clipboard can fail in restricted contexts; the passphrase is still on screen.
    }
  }

  const handleDownloadBundle = () => {
    if (bundleExport.status !== 'open') return
    const url = URL.createObjectURL(bundleExport.blob)
    const link = document.createElement('a')
    link.href = url
    link.download = bundleExport.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setBundleExport({ ...bundleExport, downloaded: true })
    onExportComplete?.()
  }

  const closeBundleExport = () => setBundleExport({ status: 'closed' })

  const handleBundleDecrypt = async () => {
    if (bundleImport.status !== 'awaitingPassphrase') return
    const { file, passphrase } = bundleImport

    if (!passphrase) {
      setBundleImport({ ...bundleImport, error: 'Enter the passphrase to continue.' })
      return
    }

    setBundleImport({ status: 'decrypting', file })

    try {
      const session = await importBundle(file, passphrase)
      const allTabIds = new Set<string>(session.windows.flatMap((w) => w.tabs.map((t) => t.id)))
      setBundleImport({ status: 'choosing', session, selected: allTabIds })
    } catch (err) {
      setBundleImport({
        status: 'awaitingPassphrase',
        file,
        passphrase,
        error: err instanceof Error ? err.message : 'Failed to decrypt bundle',
      })
    }
  }

  const toggleBundleTab = (tabId: string) => {
    if (bundleImport.status !== 'choosing') return
    const next = new Set(bundleImport.selected)
    if (next.has(tabId)) next.delete(tabId)
    else next.add(tabId)
    setBundleImport({ ...bundleImport, selected: next })
  }

  const toggleAllBundleTabs = (select: boolean) => {
    if (bundleImport.status !== 'choosing') return
    if (select) {
      const all = new Set<string>(
        bundleImport.session.windows.flatMap((w) => w.tabs.map((t) => t.id))
      )
      setBundleImport({ ...bundleImport, selected: all })
    } else {
      setBundleImport({ ...bundleImport, selected: new Set() })
    }
  }

  const handleConfirmBundleImport = async () => {
    if (bundleImport.status !== 'choosing') return
    const { session, selected } = bundleImport

    // Filter the decrypted session down to selected tabs. Drop empty windows
    // and tab groups whose tabs were all deselected so the imported session
    // doesn't carry orphan groups.
    const newWindows: Window[] = []
    for (const window of session.windows) {
      const keptTabs: Tab[] = window.tabs
        .filter((t) => selected.has(t.id))
        .map((t, i) => ({ ...t, index: i }))
      if (keptTabs.length === 0) continue

      const usedGroupIds = new Set(keptTabs.map((t) => t.groupId).filter(Boolean) as string[])
      const keptGroups = window.tabGroups.filter((g) => usedGroupIds.has(g.id))
      newWindows.push({ ...window, id: nanoid(), tabs: keptTabs, tabGroups: keptGroups })
    }

    if (newWindows.length === 0) {
      setBundleImport({
        status: 'choosing',
        session,
        selected,
      })
      setImportState({ status: 'error', message: 'Select at least one tab to import.' })
      return
    }

    // Always assign a fresh session ID so a recipient with an existing copy
    // doesn't get their version silently overwritten.
    const importedSession: Session = {
      ...session,
      id: nanoid(),
      windows: newWindows,
      source: 'import',
      updatedAt: Date.now(),
    }

    try {
      const existing = await sessionsStorage.getAll()
      await sessionsStorage.saveAll([...existing, importedSession])

      const tabsImported = newWindows.reduce((sum, w) => sum + w.tabs.length, 0)
      const result: ImportResult = {
        success: true,
        sessions: [importedSession],
        errors: [],
        warnings: [],
        stats: {
          totalEntries: tabsImported,
          validUrls: tabsImported,
          skippedUrls: 0,
          sessionsCreated: 1,
          tabsImported,
        },
        format: 'raftbundle',
      }
      setImportState({ status: 'success', result })
      setBundleImport({ status: 'closed' })
      onImportComplete()
    } catch (err) {
      setImportState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to save imported session',
      })
    }
  }

  const closeBundleImport = () => setBundleImport({ status: 'closed' })

  const handleExport = (format: 'json' | 'text') => {
    const sessionIds = selectedSessionIds.size > 0 ? Array.from(selectedSessionIds) : undefined
    const sessionsToExport = sessions.map((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { stats, ...session } = s
      return session as Session
    })

    const result = exportSessions(sessionsToExport, { format, sessionIds })

    if (result.success) {
      downloadExport(result)
      setExportState({ status: 'success', result })
      // Notify parent that export completed (for tracking last export date)
      onExportComplete?.()
    } else {
      setExportState({ status: 'error', message: 'Export failed' })
    }
  }

  const toggleSession = (id: string) => {
    const newSelected = new Set(selectedSessionIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedSessionIds(newSelected)
  }

  const selectAll = () => {
    setSelectedSessionIds(new Set(sessions.map((s) => s.id)))
  }

  const clearSelection = () => {
    setSelectedSessionIds(new Set())
  }

  const dismissImportStatus = () => {
    setImportState({ status: 'idle' })
  }

  const dismissExportStatus = () => {
    setExportState({ status: 'idle' })
  }

  return (
    <>
      <div class="bg-white rounded-lg shadow-sm border border-raft-200 mb-4">
        {/* Header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-raft-50 transition-colors rounded-lg"
          aria-expanded={isExpanded}
          aria-controls="import-export-content"
        >
          <span class="font-medium text-raft-900">Import / Export</span>
          <svg
            class={`w-5 h-5 text-raft-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expandable content */}
        {isExpanded && (
          <div id="import-export-content" class="px-4 pb-4 border-t border-raft-100">
            {/* Import Section */}
            <div class="mt-4">
              <h3 class="text-sm font-medium text-raft-700 mb-2">Import Sessions</h3>
              <p class="text-xs text-raft-500 mb-3">
                Supports OneTab, Session Buddy, Tab Session Manager, Toby, and Raft backups. Import
                formats are based on best available documentation. If your import doesn't work,
                please{' '}
                <a
                  href="https://github.com/raftapp/raft/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="underline hover:text-raft-700"
                >
                  let us know
                </a>{' '}
                and we'll prioritize a fix.
              </p>

              <label class="inline-block">
                <span class="sr-only">Choose file to import</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.txt,.raftbundle,text/plain,application/json"
                  onChange={handleFileSelect}
                  class="sr-only"
                  aria-describedby="import-formats"
                />
                <span
                  role="button"
                  tabIndex={importState.status === 'loading' ? -1 : 0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  class={`inline-block px-4 py-2 text-sm bg-raft-100 text-raft-700 rounded-lg hover:bg-raft-200 transition-colors cursor-pointer ${
                    importState.status === 'loading' ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {importState.status === 'loading' ? 'Importing...' : 'Choose File...'}
                </span>
              </label>
              <span id="import-formats" class="sr-only">
                Accepts JSON and text files from OneTab, Session Buddy, Tab Session Manager, Toby,
                and Raft
              </span>

              {/* Import Status */}
              {importState.status === 'success' && (
                <div role="status" class="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="text-sm text-green-800 font-medium">Import successful!</p>
                      <p class="text-xs text-green-700 mt-1">
                        {importState.result.format && (
                          <>Format: {getFormatDisplayName(importState.result.format)} &middot; </>
                        )}
                        {importState.result.stats.sessionsCreated} session
                        {importState.result.stats.sessionsCreated !== 1 ? 's' : ''} &middot;{' '}
                        {importState.result.stats.tabsImported} tab
                        {importState.result.stats.tabsImported !== 1 ? 's' : ''}
                      </p>
                      {importState.result.warnings.length > 0 && (
                        <p class="text-xs text-yellow-700 mt-1">
                          {importState.result.warnings.length} warning
                          {importState.result.warnings.length !== 1 ? 's' : ''} (
                          {importState.result.stats.skippedUrls} skipped)
                        </p>
                      )}
                    </div>
                    <button
                      onClick={dismissImportStatus}
                      class="text-green-600 hover:text-green-800"
                      aria-label="Dismiss import success message"
                    >
                      <svg
                        class="w-4 h-4"
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
                    </button>
                  </div>
                </div>
              )}

              {importState.status === 'error' && (
                <div role="alert" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div class="flex items-start justify-between">
                    <div>
                      <p class="text-sm text-red-800 font-medium">Import failed</p>
                      <p class="text-xs text-red-700 mt-1">{importState.message}</p>
                    </div>
                    <button
                      onClick={dismissImportStatus}
                      class="text-red-600 hover:text-red-800"
                      aria-label="Dismiss import error message"
                    >
                      <svg
                        class="w-4 h-4"
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
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Export Section */}
            <div class="mt-6 pt-4 border-t border-raft-100">
              <h3 class="text-sm font-medium text-raft-700 mb-2">Export Sessions</h3>

              {sessions.length === 0 ? (
                <p class="text-xs text-raft-500">No sessions to export.</p>
              ) : (
                <>
                  <p class="text-xs text-raft-500 mb-3">
                    Select sessions to export, or export all if none selected.
                  </p>

                  {/* Session selection */}
                  <div class="max-h-40 overflow-y-auto border border-raft-200 rounded-lg mb-3">
                    {sessions.map((session) => (
                      <div
                        key={session.id}
                        class="flex items-center gap-2 px-3 py-2 hover:bg-raft-50 border-b border-raft-100 last:border-b-0"
                      >
                        <label class="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedSessionIds.has(session.id)}
                            onChange={() => toggleSession(session.id)}
                            class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                          />
                          <span class="text-sm text-raft-700 truncate flex-1">{session.name}</span>
                          <span class="text-xs text-raft-400">
                            {session.stats.tabs} tab{session.stats.tabs !== 1 ? 's' : ''}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => handleEncryptedExport(session.id)}
                          class="text-xs text-raft-600 hover:text-raft-800 underline whitespace-nowrap"
                          title="Export this session as an encrypted .raftbundle file"
                        >
                          Encrypt & share
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Selection controls */}
                  <div class="flex items-center gap-2 mb-3">
                    <button onClick={selectAll} class="text-xs text-raft-600 hover:text-raft-700">
                      Select All
                    </button>
                    <span class="text-raft-300">|</span>
                    <button
                      onClick={clearSelection}
                      class="text-xs text-raft-500 hover:text-raft-700"
                    >
                      Clear
                    </button>
                    {selectedSessionIds.size > 0 && (
                      <span class="text-xs text-raft-400 ml-auto">
                        {selectedSessionIds.size} selected
                      </span>
                    )}
                  </div>

                  {/* Export buttons */}
                  <div class="flex gap-2">
                    <button
                      onClick={() => handleExport('json')}
                      class="px-4 py-2 text-sm bg-raft-600 text-white rounded-lg hover:bg-raft-700 transition-colors"
                    >
                      Export JSON
                    </button>
                    <button
                      onClick={() => handleExport('text')}
                      class="px-4 py-2 text-sm border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50 transition-colors"
                    >
                      Export Text
                    </button>
                  </div>

                  {/* Export Status */}
                  {exportState.status === 'success' && (
                    <div
                      role="status"
                      class="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg"
                    >
                      <div class="flex items-start justify-between">
                        <div>
                          <p class="text-sm text-green-800 font-medium">Export complete!</p>
                          <p class="text-xs text-green-700 mt-1">
                            {exportState.result.stats.sessionsExported} session
                            {exportState.result.stats.sessionsExported !== 1
                              ? 's'
                              : ''} &middot; {exportState.result.stats.tabsExported} tab
                            {exportState.result.stats.tabsExported !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <button
                          onClick={dismissExportStatus}
                          class="text-green-600 hover:text-green-800"
                          aria-label="Dismiss export success message"
                        >
                          <svg
                            class="w-4 h-4"
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
                        </button>
                      </div>
                    </div>
                  )}

                  {exportState.status === 'error' && (
                    <div role="alert" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <div class="flex items-start justify-between">
                        <div>
                          <p class="text-sm text-red-800 font-medium">Export failed</p>
                          <p class="text-xs text-red-700 mt-1">{exportState.message}</p>
                        </div>
                        <button
                          onClick={dismissExportStatus}
                          class="text-red-600 hover:text-red-800"
                          aria-label="Dismiss export error message"
                        >
                          <svg
                            class="w-4 h-4"
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
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Encrypted bundle export dialog */}
      {bundleExport.status === 'open' && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-export-title"
        >
          <div class="bg-white rounded-lg shadow-lg border border-raft-200 max-w-md w-full p-6">
            <h2 id="bundle-export-title" class="text-lg font-semibold text-raft-900 mb-1">
              Encrypted bundle for "{bundleExport.session.name}"
            </h2>
            <p class="text-sm text-raft-600 mb-4">
              We've generated a one-time passphrase. The bundle is encrypted with AES-256-GCM and
              PBKDF2 (600,000 iterations) — without this passphrase, no one (including us) can read
              it.
            </p>

            <div class="bg-raft-50 border border-raft-200 rounded-lg p-3 mb-3">
              <p class="text-xs text-raft-500 mb-1">Passphrase (shown once)</p>
              <code class="block text-sm font-mono text-raft-900 break-all select-all">
                {bundleExport.passphrase}
              </code>
            </div>

            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p class="text-sm text-yellow-800 font-medium">Share through a different channel</p>
              <p class="text-xs text-yellow-700 mt-1">
                Send the passphrase through a different channel than the file (e.g. text the file,
                call with the passphrase). End-to-end encryption only protects you if the two halves
                don't travel together.
              </p>
            </div>

            <div class="flex flex-wrap gap-2 mb-2">
              <button
                type="button"
                onClick={handleCopyPassphrase}
                class="px-4 py-2 text-sm bg-raft-100 text-raft-700 rounded-lg hover:bg-raft-200 transition-colors"
              >
                {bundleExport.passphraseCopied ? 'Passphrase copied!' : 'Copy passphrase'}
              </button>
              <button
                type="button"
                onClick={handleDownloadBundle}
                class="px-4 py-2 text-sm bg-raft-600 text-white rounded-lg hover:bg-raft-700 transition-colors"
              >
                {bundleExport.downloaded ? 'Download again' : 'Download bundle'}
              </button>
            </div>
            <p class="text-xs text-raft-500 mb-4">
              Two separate clicks on purpose — so you don't accidentally share both at once.
            </p>

            <button
              type="button"
              onClick={closeBundleExport}
              class="text-sm text-raft-600 hover:text-raft-800 underline"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Encrypted bundle import dialog: passphrase entry */}
      {bundleImport.status === 'awaitingPassphrase' && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-import-title"
        >
          <div class="bg-white rounded-lg shadow-lg border border-raft-200 max-w-md w-full p-6">
            <h2 id="bundle-import-title" class="text-lg font-semibold text-raft-900 mb-1">
              Decrypt {bundleImport.file.name}
            </h2>
            <p class="text-sm text-raft-600 mb-4">
              Enter the passphrase the sender shared with you out-of-band.
            </p>

            <input
              type="password"
              value={bundleImport.passphrase}
              onInput={(e) =>
                setBundleImport({
                  ...bundleImport,
                  passphrase: (e.target as HTMLInputElement).value,
                  error: undefined,
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleBundleDecrypt()
                }
              }}
              placeholder="Passphrase"
              ref={(el) => {
                // Focus the passphrase field when the dialog mounts so the user
                // can type immediately. eslint complains about `autoFocus` so we
                // do this via ref instead.
                if (el && document.activeElement !== el) el.focus()
              }}
              class="w-full px-3 py-2 border border-raft-300 rounded-lg text-sm mb-2 focus:ring-2 focus:ring-raft-500 focus:border-raft-500"
            />

            {bundleImport.error && (
              <p role="alert" class="text-xs text-red-700 mb-2">
                {bundleImport.error}
              </p>
            )}

            <div class="flex gap-2">
              <button
                type="button"
                onClick={handleBundleDecrypt}
                class="px-4 py-2 text-sm bg-raft-600 text-white rounded-lg hover:bg-raft-700 transition-colors"
              >
                Decrypt
              </button>
              <button
                type="button"
                onClick={closeBundleImport}
                class="px-4 py-2 text-sm border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {bundleImport.status === 'decrypting' && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div class="bg-white rounded-lg shadow-lg border border-raft-200 px-6 py-4">
            <p class="text-sm text-raft-700">Decrypting bundle…</p>
          </div>
        </div>
      )}

      {/* Encrypted bundle import dialog: tab picker */}
      {bundleImport.status === 'choosing' && (
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-choose-title"
        >
          <div class="bg-white rounded-lg shadow-lg border border-raft-200 max-w-2xl w-full p-6 max-h-[80vh] flex flex-col">
            <h2 id="bundle-choose-title" class="text-lg font-semibold text-raft-900 mb-1">
              Pick tabs to import from "{bundleImport.session.name}"
            </h2>
            <p class="text-sm text-raft-600 mb-3">
              Decrypted successfully. Choose which tabs to add to your library — the original
              session isn't touched.
            </p>

            <div class="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => toggleAllBundleTabs(true)}
                class="text-xs text-raft-600 hover:text-raft-800 underline"
              >
                Select all
              </button>
              <span class="text-raft-300">|</span>
              <button
                type="button"
                onClick={() => toggleAllBundleTabs(false)}
                class="text-xs text-raft-500 hover:text-raft-700 underline"
              >
                Clear
              </button>
              <span class="text-xs text-raft-400 ml-auto">
                {bundleImport.selected.size} selected
              </span>
            </div>

            <div class="flex-1 overflow-y-auto border border-raft-200 rounded-lg mb-3">
              {bundleImport.session.windows.map((window, wIdx) => (
                <div key={window.id} class="border-b border-raft-100 last:border-b-0">
                  <p class="text-xs font-medium text-raft-500 px-3 py-2 bg-raft-50">
                    Window {wIdx + 1} ({window.tabs.length} tab{window.tabs.length !== 1 ? 's' : ''}
                    )
                  </p>
                  {window.tabs.map((tab) => (
                    <label
                      key={tab.id}
                      class="flex items-center gap-2 px-3 py-2 hover:bg-raft-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={bundleImport.selected.has(tab.id)}
                        onChange={() => toggleBundleTab(tab.id)}
                        class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
                      />
                      <span class="text-sm text-raft-700 truncate flex-1" title={tab.url}>
                        {tab.title || tab.url}
                      </span>
                      {tab.pinned && (
                        <span class="text-xs text-raft-400" aria-label="pinned">
                          📌
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              ))}
            </div>

            <div class="flex gap-2">
              <button
                type="button"
                onClick={handleConfirmBundleImport}
                disabled={bundleImport.selected.size === 0}
                class="px-4 py-2 text-sm bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Import {bundleImport.selected.size} tab
                {bundleImport.selected.size !== 1 ? 's' : ''}
              </button>
              <button
                type="button"
                onClick={closeBundleImport}
                class="px-4 py-2 text-sm border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
