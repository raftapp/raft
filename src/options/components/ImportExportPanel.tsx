/**
 * Import/Export Panel component for the Options page
 *
 * Provides UI for:
 * - Importing sessions from other tab managers
 * - Exporting sessions as JSON or text
 */

import { useState, useRef } from 'preact/hooks'
import type { Session } from '@/shared/types'
import {
  importSessions,
  exportSessions,
  downloadExport,
  getFormatDisplayName,
  MAX_IMPORT_SIZE,
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

export function ImportExportPanel({
  sessions,
  onImportComplete,
  onExportComplete,
}: ImportExportPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [importState, setImportState] = useState<ImportState>({ status: 'idle' })
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
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

    setImportState({ status: 'loading' })

    try {
      const content = await file.text()
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
              formats are based on best available documentation. If your import doesn't work, please{' '}
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
                accept=".json,.txt,text/plain,application/json"
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
              Accepts JSON and text files from OneTab, Session Buddy, Tab Session Manager, Toby, and
              Raft
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
                    <label
                      key={session.id}
                      class="flex items-center gap-2 px-3 py-2 hover:bg-raft-50 cursor-pointer border-b border-raft-100 last:border-b-0"
                    >
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
                          {exportState.result.stats.sessionsExported !== 1 ? 's' : ''} &middot;{' '}
                          {exportState.result.stats.tabsExported} tab
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
  )
}
