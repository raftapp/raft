/**
 * Cloud Sync Panel
 *
 * Settings panel for Google Drive cloud sync configuration.
 * Handles connection, encryption setup, and sync status display.
 */

import { useState, useEffect, useCallback, useRef } from 'preact/hooks'
import type { CloudSyncSettings, SyncState } from '@/shared/cloudSync'
import { DEFAULT_CLOUD_SYNC_SETTINGS } from '@/shared/cloudSync'
import { formatRelativeTime } from '@/shared/utils'
import { EncryptionSetup } from './EncryptionSetup'
import { ProUpgrade } from './ProUpgrade'
import { useFocusTrap, useFocusRestore } from '@/shared/a11y'

interface CloudSyncStatus extends SyncState {
  configured: boolean
  enabled: boolean
  unlocked: boolean
  email?: string
}

interface CloudSyncPanelProps {
  isPro: boolean
  onProStatusChange: () => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
}

export function CloudSyncPanel({
  isPro,
  onProStatusChange,
  onSuccess,
  onError,
}: CloudSyncPanelProps) {
  const [status, setStatus] = useState<CloudSyncStatus | null>(null)
  const [settings, setSettings] = useState<CloudSyncSettings>(DEFAULT_CLOUD_SYNC_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Encryption setup flow
  const [showEncryptionSetup, setShowEncryptionSetup] = useState(false)
  const [pendingTokens, setPendingTokens] = useState<{ tokens: unknown; email: string } | null>(
    null
  )
  const [showUnlock, setShowUnlock] = useState(false)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockError, setUnlockError] = useState('')
  const [unlocking, setUnlocking] = useState(false)

  // Recovery key modal
  const [recoveryKeyToShow, setRecoveryKeyToShow] = useState<string | null>(null)
  const [recoveryKeySaved, setRecoveryKeySaved] = useState(false)
  const [recoveryKeyCopied, setRecoveryKeyCopied] = useState(false)

  // Recovery key regeneration
  const [showRegenRecovery, setShowRegenRecovery] = useState(false)
  const [regenPassword, setRegenPassword] = useState('')
  const [regenError, setRegenError] = useState('')
  const [regenLoading, setRegenLoading] = useState(false)

  // Password recovery via recovery key
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryStep, setRecoveryStep] = useState<'enter-key' | 'set-password'>('enter-key')
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('')
  const [recoveryNewPassword, setRecoveryNewPassword] = useState('')
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('')
  const [recoveryError, setRecoveryError] = useState('')
  const [recoveryLoading, setRecoveryLoading] = useState(false)

  // Focus management for unlock dialog
  const unlockDialogRef = useRef<HTMLElement>(null)
  useFocusTrap(unlockDialogRef, showUnlock)
  const restoreFocus = useFocusRestore(showUnlock)

  // Focus management for recovery key modal
  const recoveryKeyDialogRef = useRef<HTMLElement>(null)
  useFocusTrap(recoveryKeyDialogRef, recoveryKeyToShow !== null)

  // Focus management for recovery key regeneration dialog
  const regenDialogRef = useRef<HTMLElement>(null)
  useFocusTrap(regenDialogRef, showRegenRecovery)
  const restoreRegenFocus = useFocusRestore(showRegenRecovery)

  // Focus management for password recovery dialog
  const recoveryDialogRef = useRef<HTMLElement>(null)
  useFocusTrap(recoveryDialogRef, showRecovery)
  const restoreRecoveryFocus = useFocusRestore(showRecovery)

  const loadStatus = useCallback(async () => {
    try {
      const [statusResponse, settingsResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'CLOUD_GET_STATUS' }),
        chrome.runtime.sendMessage({ type: 'CLOUD_GET_SETTINGS' }),
      ])

      if (statusResponse.success) {
        setStatus(statusResponse.data)
      }
      if (settingsResponse.success) {
        setSettings(settingsResponse.data)
      }
    } catch (err) {
      console.error('Failed to load cloud sync status:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    // Refresh status every 10 seconds
    const interval = setInterval(loadStatus, 10000)
    return () => clearInterval(interval)
  }, [loadStatus])

  const handleConnect = async () => {
    if (!isPro) return

    setConnecting(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLOUD_CONNECT' })

      if (!response.success) {
        onError(response.error || 'Failed to connect')
        return
      }

      if (response.data.needsEncryptionSetup) {
        // Keep tokens in component state only (never written to storage)
        setPendingTokens({ tokens: response.data.tokens, email: response.data.email })
        setShowEncryptionSetup(true)
      } else if (response.data.needsUnlock) {
        // Keep tokens in component state only (never written to storage)
        setPendingTokens({ tokens: response.data.tokens, email: response.data.email })
        setShowUnlock(true)
      } else {
        // Connected successfully
        onSuccess('Connected to Google Drive')
        loadStatus()
      }
    } catch (err) {
      onError('Connection failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setConnecting(false)
    }
  }

  const handleEncryptionSetupComplete = async (recoveryKey: string) => {
    setShowEncryptionSetup(false)
    setPendingTokens(null)
    setRecoveryKeyToShow(recoveryKey)
    setRecoveryKeySaved(false)
    setRecoveryKeyCopied(false)
    loadStatus()
  }

  const handleCopyRecoveryKey = async () => {
    if (!recoveryKeyToShow) return
    try {
      await globalThis.navigator.clipboard.writeText(recoveryKeyToShow)
      setRecoveryKeyCopied(true)
    } catch {
      onError('Failed to copy to clipboard')
    }
  }

  const handleDismissRecoveryKey = () => {
    const wasRegen = showRegenRecovery
    setRecoveryKeyToShow(null)
    setRecoveryKeySaved(false)
    setRecoveryKeyCopied(false)
    if (!wasRegen) {
      onSuccess('Cloud sync is ready')
    }
  }

  const handleRegenerateRecoveryKey = async () => {
    setRegenError('')
    setRegenLoading(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLOUD_REGENERATE_RECOVERY_KEY',
        password: regenPassword,
      })
      if (response.success) {
        setShowRegenRecovery(false)
        setRegenPassword('')
        restoreRegenFocus()
        setRecoveryKeyToShow(response.data.recoveryKey)
        setRecoveryKeySaved(false)
        setRecoveryKeyCopied(false)
      } else {
        setRegenError(response.error || 'Failed to generate recovery key')
      }
    } catch {
      setRegenError('Failed to generate recovery key')
    } finally {
      setRegenLoading(false)
    }
  }

  const cancelRegenRecovery = () => {
    setShowRegenRecovery(false)
    setRegenPassword('')
    setRegenError('')
    restoreRegenFocus()
  }

  const handleVerifyRecoveryKey = () => {
    if (!recoveryKeyInput.trim()) {
      setRecoveryError('Please enter your recovery key')
      return
    }
    setRecoveryError('')
    setRecoveryStep('set-password')
  }

  const handleRecoverWithKey = async () => {
    if (recoveryNewPassword.length < 8) {
      setRecoveryError('Password must be at least 8 characters')
      return
    }
    if (recoveryNewPassword !== recoveryConfirmPassword) {
      setRecoveryError('Passwords do not match')
      return
    }

    setRecoveryError('')
    setRecoveryLoading(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLOUD_RECOVER_WITH_KEY',
        recoveryKey: recoveryKeyInput.trim(),
        newPassword: recoveryNewPassword,
      })
      if (response.success) {
        setShowRecovery(false)
        setShowUnlock(false)
        setRecoveryKeyInput('')
        setRecoveryNewPassword('')
        setRecoveryConfirmPassword('')
        setRecoveryStep('enter-key')
        restoreRecoveryFocus()
        // Show the new recovery key
        setRecoveryKeyToShow(response.data.recoveryKey)
        setRecoveryKeySaved(false)
        setRecoveryKeyCopied(false)
        loadStatus()
      } else {
        // If the recovery key was wrong, go back to step 1
        if (response.error === 'Invalid recovery key') {
          setRecoveryStep('enter-key')
        }
        setRecoveryError(response.error || 'Recovery failed')
      }
    } catch {
      setRecoveryError('Recovery failed')
    } finally {
      setRecoveryLoading(false)
    }
  }

  const cancelRecovery = () => {
    setShowRecovery(false)
    setRecoveryKeyInput('')
    setRecoveryNewPassword('')
    setRecoveryConfirmPassword('')
    setRecoveryError('')
    setRecoveryStep('enter-key')
    restoreRecoveryFocus()
  }

  const handleUnlock = async () => {
    setUnlockError('')
    setUnlocking(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLOUD_UNLOCK',
        password: unlockPassword,
        tokens: pendingTokens?.tokens,
        email: pendingTokens?.email,
      })

      if (!response.success) {
        setUnlockError(response.error || 'Incorrect password')
        return
      }

      setShowUnlock(false)
      setUnlockPassword('')
      restoreFocus()
      onSuccess('Cloud sync unlocked')
      loadStatus()
    } catch {
      setUnlockError('Failed to unlock')
    } finally {
      setUnlocking(false)
    }
  }

  const cancelUnlock = () => {
    setShowUnlock(false)
    setUnlockPassword('')
    setPendingTokens(null)
    restoreFocus()
  }

  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)
  const disconnectDialogRef = useRef<HTMLElement>(null)
  useFocusTrap(disconnectDialogRef, showDisconnectDialog)
  const restoreDisconnectFocus = useFocusRestore(showDisconnectDialog)

  const handleDisconnect = async (deleteCloudData: boolean) => {
    setShowDisconnectDialog(false)
    restoreDisconnectFocus()
    setDisconnecting(true)
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLOUD_DISCONNECT',
        deleteCloudData,
      })
      if (response.success) {
        onSuccess(
          deleteCloudData ? 'Disconnected and deleted cloud data' : 'Disconnected from Google Drive'
        )
        loadStatus()
      } else {
        onError(response.error || 'Failed to disconnect')
      }
    } catch {
      onError('Disconnect failed')
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLOUD_SYNC' })
      if (response.success) {
        const result = response.data
        onSuccess(
          `Synced: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.deleted} deleted`
        )
        loadStatus()
      } else {
        onError(response.error || 'Sync failed')
      }
    } catch {
      onError('Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handleRemoveLicense = async () => {
    if (!confirm('Are you sure you want to remove your license from this device?')) {
      return
    }
    await chrome.runtime.sendMessage({ type: 'PRO_CLEAR_LICENSE' })
    onProStatusChange()
  }

  const handleSettingChange = async (updates: Partial<CloudSyncSettings>) => {
    const updated = { ...settings, ...updates }
    setSettings(updated)
    await chrome.runtime.sendMessage({ type: 'CLOUD_UPDATE_SETTINGS', settings: updates })
  }

  if (loading) {
    return (
      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <p class="text-raft-500">Loading cloud sync status...</p>
      </section>
    )
  }

  // Show Pro upgrade prompt if not Pro
  if (!isPro) {
    return <ProUpgrade onLicenseActivated={onProStatusChange} />
  }

  // Show encryption setup modal
  if (showEncryptionSetup) {
    return (
      <EncryptionSetup
        email={pendingTokens?.email}
        pendingTokens={pendingTokens}
        onComplete={handleEncryptionSetupComplete}
        onCancel={() => {
          setShowEncryptionSetup(false)
          setPendingTokens(null)
        }}
        onError={onError}
      />
    )
  }

  // Show recovery key modal
  if (recoveryKeyToShow) {
    return (
      <section
        ref={recoveryKeyDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-key-dialog-title"
        aria-describedby="recovery-key-dialog-desc"
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
      >
        <h2 id="recovery-key-dialog-title" class="text-lg font-semibold text-raft-900 mb-2">
          Save Your Recovery Key
        </h2>
        <p id="recovery-key-dialog-desc" class="text-sm text-raft-600 mb-4">
          Save this recovery key somewhere safe. You will need it if you forget your encryption
          password. You can generate a new key later from the cloud sync settings.
        </p>

        <div class="bg-raft-50 border border-raft-200 rounded-lg p-4 mb-4">
          <code class="block text-sm font-mono text-raft-900 break-all select-all">
            {recoveryKeyToShow}
          </code>
        </div>

        <button
          onClick={handleCopyRecoveryKey}
          class="mb-4 px-4 py-2 text-sm bg-raft-100 text-raft-700 rounded-lg hover:bg-raft-200 transition-colors"
        >
          {recoveryKeyCopied ? 'Copied!' : 'Copy to Clipboard'}
        </button>

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p class="text-sm text-yellow-800 font-medium">Warning</p>
          <p class="text-sm text-yellow-700 mt-1">
            If you lose this key and forget your password, your synced sessions cannot be recovered.
            Store it in a password manager or other secure location.
          </p>
        </div>

        <label class="flex items-center gap-3 mb-4">
          <input
            type="checkbox"
            checked={recoveryKeySaved}
            onChange={(e) => setRecoveryKeySaved((e.target as HTMLInputElement).checked)}
            class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
          />
          <span class="text-sm text-raft-700">I have saved my recovery key</span>
        </label>

        <button
          onClick={handleDismissRecoveryKey}
          disabled={!recoveryKeySaved}
          class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </section>
    )
  }

  // Show disconnect confirmation dialog
  if (showDisconnectDialog) {
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
      <section
        ref={disconnectDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-dialog-title"
        aria-describedby="disconnect-dialog-desc"
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setShowDisconnectDialog(false)
            restoreDisconnectFocus()
          }
        }}
      >
        <h2 id="disconnect-dialog-title" class="text-lg font-semibold text-raft-900 mb-2">
          Disconnect from Google Drive
        </h2>
        <p id="disconnect-dialog-desc" class="text-sm text-raft-600 mb-4">
          Would you like to keep your data on Google Drive, or delete it?
        </p>

        <div class="space-y-3 mb-4">
          <button
            onClick={() => handleDisconnect(false)}
            class="w-full text-left px-4 py-3 border border-raft-200 rounded-lg hover:bg-raft-50 transition-colors"
          >
            <p class="text-sm font-medium text-raft-900">Keep cloud data</p>
            <p class="text-xs text-raft-500 mt-0.5">
              This device will stop syncing. Your cloud data stays available if you reconnect later.
            </p>
          </button>
          <button
            onClick={() => handleDisconnect(true)}
            class="w-full text-left px-4 py-3 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
          >
            <p class="text-sm font-medium text-red-700">Delete cloud data</p>
            <p class="text-xs text-red-500 mt-0.5">
              Permanently delete all synced sessions from Google Drive. Local sessions are not
              affected.
            </p>
          </button>
        </div>

        {!status?.unlocked && (
          <p class="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-4">
            Cloud sync is locked. Unlock with your password first to delete cloud data or revoke
            access.
          </p>
        )}

        <button
          onClick={() => {
            setShowDisconnectDialog(false)
            restoreDisconnectFocus()
          }}
          class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50"
        >
          Cancel
        </button>
      </section>
    )
  }

  // Show password recovery dialog
  if (showRecovery) {
    const recoveryErrorId = 'recovery-error'
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
      <section
        ref={recoveryDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-dialog-title"
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancelRecovery()
        }}
      >
        <h2 id="recovery-dialog-title" class="text-lg font-semibold text-raft-900 mb-2">
          Reset Encryption Password
        </h2>

        {recoveryStep === 'enter-key' ? (
          <div class="space-y-4">
            <p class="text-sm text-raft-600">
              Enter the recovery key you saved when you first set up cloud sync.
            </p>

            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p class="text-sm text-yellow-800 font-medium">Warning</p>
              <p class="text-sm text-yellow-700 mt-1">
                Resetting your password will re-encrypt all cloud data. Any sessions that exist only
                in the cloud (e.g., from another device not yet synced here) will be permanently
                lost.
              </p>
            </div>

            <div>
              <label htmlFor="recovery-key-input" class="block text-sm text-raft-600 mb-1">
                Recovery Key
              </label>
              <input
                id="recovery-key-input"
                type="text"
                value={recoveryKeyInput}
                onInput={(e) => setRecoveryKeyInput((e.target as HTMLInputElement).value)}
                onKeyPress={(e) =>
                  e.key === 'Enter' && recoveryKeyInput.trim() && handleVerifyRecoveryKey()
                }
                class="w-full px-3 py-2 border border-raft-300 rounded-md font-mono text-sm focus:ring-raft-500 focus:border-raft-500"
                placeholder="XXXX-XXXX-XXXX-..."
                aria-invalid={recoveryError ? 'true' : undefined}
                aria-errormessage={recoveryError ? recoveryErrorId : undefined}
              />
              {recoveryError && (
                <p id={recoveryErrorId} role="alert" class="text-sm text-red-600 mt-1">
                  {recoveryError}
                </p>
              )}
            </div>

            <div class="flex gap-3">
              <button
                onClick={handleVerifyRecoveryKey}
                disabled={!recoveryKeyInput.trim()}
                class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50"
              >
                Continue
              </button>
              <button
                onClick={cancelRecovery}
                class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div class="space-y-4">
            <p class="text-sm text-raft-600">
              Set a new encryption password. This will re-encrypt all your cloud data.
            </p>

            <div>
              <label htmlFor="recovery-new-password" class="block text-sm text-raft-600 mb-1">
                New Password
              </label>
              <input
                id="recovery-new-password"
                type="password"
                value={recoveryNewPassword}
                onInput={(e) => setRecoveryNewPassword((e.target as HTMLInputElement).value)}
                class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
                placeholder="At least 8 characters"
                aria-invalid={recoveryError ? 'true' : undefined}
                aria-errormessage={recoveryError ? recoveryErrorId : undefined}
              />
            </div>

            <div>
              <label htmlFor="recovery-confirm-password" class="block text-sm text-raft-600 mb-1">
                Confirm Password
              </label>
              <input
                id="recovery-confirm-password"
                type="password"
                value={recoveryConfirmPassword}
                onInput={(e) => setRecoveryConfirmPassword((e.target as HTMLInputElement).value)}
                onKeyPress={(e) =>
                  e.key === 'Enter' &&
                  recoveryNewPassword &&
                  recoveryConfirmPassword &&
                  handleRecoverWithKey()
                }
                class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
                placeholder="Re-enter your password"
              />
              {recoveryError && (
                <p id={recoveryErrorId} role="alert" class="text-sm text-red-600 mt-1">
                  {recoveryError}
                </p>
              )}
            </div>

            <div class="flex gap-3">
              <button
                onClick={handleRecoverWithKey}
                disabled={!recoveryNewPassword || !recoveryConfirmPassword || recoveryLoading}
                class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50"
              >
                {recoveryLoading ? 'Resetting...' : 'Reset Password'}
              </button>
              <button
                onClick={() => {
                  setRecoveryStep('enter-key')
                  setRecoveryError('')
                  setRecoveryNewPassword('')
                  setRecoveryConfirmPassword('')
                }}
                class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </section>
    )
  }

  // Show recovery key regeneration dialog
  if (showRegenRecovery) {
    const regenErrorId = 'regen-password-error'
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
      <section
        ref={regenDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="regen-dialog-title"
        aria-describedby="regen-dialog-desc"
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancelRegenRecovery()
        }}
      >
        <h2 id="regen-dialog-title" class="text-lg font-semibold text-raft-900 mb-2">
          Generate New Recovery Key
        </h2>
        <p id="regen-dialog-desc" class="text-sm text-raft-600 mb-4">
          Enter your encryption password to generate a new recovery key. Your current recovery key
          will be permanently invalidated and can no longer be used for password recovery.
        </p>

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p class="text-sm text-yellow-800 font-medium">Warning</p>
          <p class="text-sm text-yellow-700 mt-1">
            After generating a new key, you must save it immediately. Your previous recovery key
            will stop working permanently.
          </p>
        </div>

        <div class="space-y-4">
          <div>
            <label htmlFor="regen-password" class="block text-sm text-raft-600 mb-1">
              Encryption Password
            </label>
            <input
              id="regen-password"
              type="password"
              value={regenPassword}
              onInput={(e) => setRegenPassword((e.target as HTMLInputElement).value)}
              onKeyPress={(e) =>
                e.key === 'Enter' && regenPassword && handleRegenerateRecoveryKey()
              }
              class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
              placeholder="Enter your password"
              aria-invalid={regenError ? 'true' : undefined}
              aria-errormessage={regenError ? regenErrorId : undefined}
            />
            {regenError && (
              <p id={regenErrorId} role="alert" class="text-sm text-red-600 mt-1">
                {regenError}
              </p>
            )}
          </div>

          <div class="flex gap-3">
            <button
              onClick={handleRegenerateRecoveryKey}
              disabled={!regenPassword || regenLoading}
              class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50"
            >
              {regenLoading ? 'Generating...' : 'Generate'}
            </button>
            <button
              onClick={cancelRegenRecovery}
              class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    )
  }

  // Show unlock prompt
  if (showUnlock) {
    const unlockErrorId = 'unlock-password-error'
    return (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
      <section
        ref={unlockDialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-dialog-title"
        aria-describedby="unlock-dialog-desc"
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            cancelUnlock()
          }
        }}
      >
        <h2 id="unlock-dialog-title" class="text-lg font-semibold text-raft-900 mb-4">
          Unlock Cloud Sync
        </h2>
        <p id="unlock-dialog-desc" class="text-sm text-raft-600 mb-4">
          Enter your encryption password to access your synced sessions.
        </p>

        <div class="space-y-4">
          <div>
            <label htmlFor="unlock-password" class="block text-sm text-raft-600 mb-1">
              Encryption Password
            </label>
            <input
              id="unlock-password"
              type="password"
              value={unlockPassword}
              onInput={(e) => setUnlockPassword((e.target as HTMLInputElement).value)}
              onKeyPress={(e) => e.key === 'Enter' && handleUnlock()}
              class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
              placeholder="Enter your password"
              aria-invalid={unlockError ? 'true' : undefined}
              aria-errormessage={unlockError ? unlockErrorId : undefined}
            />
            {unlockError && (
              <p id={unlockErrorId} role="alert" class="text-sm text-red-600 mt-1">
                {unlockError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setShowUnlock(false)
                setUnlockPassword('')
                setUnlockError('')
                setShowRecovery(true)
              }}
              class="text-sm text-raft-500 hover:text-raft-700 underline"
            >
              Forgot password?
            </button>
          </div>

          <div class="flex gap-3">
            <button
              onClick={handleUnlock}
              disabled={!unlockPassword || unlocking}
              class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50"
            >
              {unlocking ? 'Unlocking...' : 'Unlock'}
            </button>
            <button
              onClick={cancelUnlock}
              class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
      <h2 class="text-lg font-semibold text-raft-900 mb-4">Cloud Sync</h2>

      {!status?.configured ? (
        // Not connected state
        <div class="space-y-4">
          <p class="text-sm text-raft-600">
            Connect to Google Drive to sync your sessions across devices. Your data is encrypted
            with a password only you know.
          </p>

          <button
            onClick={handleConnect}
            disabled={connecting}
            class="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {connecting ? (
              <>
                <span class="animate-spin">⏳</span>
                Connecting...
              </>
            ) : (
              <>
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z" />
                </svg>
                Connect Google Drive
              </>
            )}
          </button>

          <p class="text-xs text-raft-400">
            Raft only accesses its own app folder. We cannot see your other Drive files.
          </p>

          <button
            onClick={handleRemoveLicense}
            class="text-sm text-raft-400 hover:text-raft-600 underline"
          >
            Remove license from this device
          </button>
        </div>
      ) : (
        // Connected state
        <div class="space-y-4">
          {/* Connection status */}
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-green-500"></span>
              <span class="text-sm text-raft-700">Connected as {status.email}</span>
            </div>
            <button
              onClick={() => setShowDisconnectDialog(true)}
              disabled={disconnecting}
              class="text-sm text-red-600 hover:text-red-700"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>

          {/* Lock status */}
          {!status.unlocked && (
            <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p class="text-sm text-yellow-800">
                Cloud sync is locked. Enter your password to sync.
              </p>
              <div class="mt-2 flex gap-3">
                <button
                  onClick={() => setShowUnlock(true)}
                  class="text-sm text-yellow-700 hover:text-yellow-800 underline"
                >
                  Unlock now
                </button>
                <button
                  onClick={() => setShowRecovery(true)}
                  class="text-sm text-yellow-600 hover:text-yellow-700 underline"
                >
                  Forgot password?
                </button>
              </div>
            </div>
          )}

          {/* Sync status */}
          <div
            class="bg-raft-50 rounded-lg p-3 space-y-2"
            role="status"
            aria-live="polite"
            aria-busy={status.syncing}
          >
            <div class="flex items-center justify-between">
              <span class="text-sm text-raft-600">
                {status.syncing ? (
                  <span class="flex items-center gap-2">
                    <span class="animate-spin" aria-hidden="true">
                      ⏳
                    </span>
                    {status.currentOperation || 'Syncing...'}
                  </span>
                ) : status.lastSyncAt ? (
                  `Last synced ${formatRelativeTime(status.lastSyncAt)}`
                ) : (
                  'Never synced'
                )}
              </span>
              <button
                onClick={handleSync}
                disabled={syncing || status.syncing || !status.unlocked}
                class="px-3 py-1 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 disabled:opacity-50"
              >
                {syncing ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>

            {status.pendingCount > 0 && (
              <p class="text-xs text-raft-500">
                {status.pendingCount} {status.pendingCount === 1 ? 'change' : 'changes'} pending
              </p>
            )}

            {status.lastError && (
              <p role="alert" class="text-xs text-red-600">
                Last error: {status.lastError}
              </p>
            )}
          </div>

          {/* Sync settings */}
          <div class="space-y-3 pt-2 border-t border-raft-100">
            <label class="flex items-center gap-3">
              <input
                type="checkbox"
                checked={settings.syncOnSave}
                onChange={(e) =>
                  handleSettingChange({ syncOnSave: (e.target as HTMLInputElement).checked })
                }
                class="w-4 h-4 rounded border-raft-300 text-raft-600 focus:ring-raft-500"
              />
              <span class="text-sm text-raft-700">Sync when saving sessions</span>
            </label>

            <div>
              <label htmlFor="sync-interval" class="block text-sm text-raft-600 mb-1">
                Auto-sync interval (minutes)
              </label>
              <input
                id="sync-interval"
                type="number"
                min="5"
                max="120"
                value={settings.intervalMinutes}
                onChange={(e) =>
                  handleSettingChange({
                    intervalMinutes: Math.max(
                      5,
                      Math.min(120, parseInt((e.target as HTMLInputElement).value, 10) || 15)
                    ),
                  })
                }
                class="w-24 px-3 py-1.5 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
              />
            </div>

            <button
              onClick={() => setShowRegenRecovery(true)}
              class="text-sm text-raft-600 hover:text-raft-800 underline"
            >
              Generate new recovery key
            </button>

            <button
              onClick={handleRemoveLicense}
              class="text-sm text-raft-400 hover:text-raft-600 underline"
            >
              Remove license from this device
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
