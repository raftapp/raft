/**
 * Encryption Setup Component
 *
 * Guides users through setting up encryption for cloud sync.
 * Shows password requirements and recovery key.
 */

import { useState, useRef } from 'preact/hooks'
import { useFocusTrap, useFocusRestore } from '@/shared/a11y'

interface EncryptionSetupProps {
  email?: string
  pendingTokens?: { tokens: unknown; email: string } | null
  onComplete: (recoveryKey: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

export function EncryptionSetup({
  email,
  pendingTokens,
  onComplete,
  onCancel,
  onError,
}: EncryptionSetupProps) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  // Focus management
  const dialogRef = useRef<HTMLElement>(null)
  useFocusTrap(dialogRef, true)
  const restoreFocus = useFocusRestore(true)

  const handleCancel = () => {
    restoreFocus()
    onCancel()
  }

  const validatePassword = (pwd: string): string[] => {
    const errs: string[] = []
    if (pwd.length < 8) {
      errs.push('Password must be at least 8 characters')
    }
    if (!/[A-Z]/.test(pwd)) {
      errs.push('Password must contain an uppercase letter')
    }
    if (!/[a-z]/.test(pwd)) {
      errs.push('Password must contain a lowercase letter')
    }
    if (!/[0-9]/.test(pwd)) {
      errs.push('Password must contain a number')
    }
    return errs
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()

    const validationErrors = validatePassword(password)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    if (password !== confirmPassword) {
      setErrors(['Passwords do not match'])
      return
    }

    setSaving(true)
    setErrors([])

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLOUD_SETUP_ENCRYPTION',
        password,
        tokens: pendingTokens?.tokens,
        email: pendingTokens?.email,
      })

      if (!response.success) {
        onError(response.error || 'Failed to set up encryption')
        return
      }

      onComplete(response.data.recoveryKey)
    } catch (err) {
      onError('Failed to set up encryption: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  const passwordStrength = validatePassword(password)
  const isValid =
    passwordStrength.length === 0 && password === confirmPassword && password.length > 0

  // Generate unique IDs for ARIA relationships
  const passwordErrorId = 'setup-password-error'
  const requirementsId = 'password-requirements'

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Dialog Escape handler
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="encryption-setup-title"
      aria-describedby="encryption-setup-desc"
      class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) {
          handleCancel()
        }
      }}
    >
      <h2 id="encryption-setup-title" class="text-lg font-semibold text-raft-900 mb-2">
        Set Up Encryption
      </h2>
      <p id="encryption-setup-desc" class="text-sm text-raft-600 mb-4">
        {email && (
          <>
            Connected as <strong>{email}</strong>.{' '}
          </>
        )}
        Create a password to encrypt your synced sessions. This password never leaves your device.
      </p>

      <form onSubmit={handleSubmit} class="space-y-4">
        <div>
          <label htmlFor="setup-password" class="block text-sm text-raft-700 mb-1">
            Encryption Password
          </label>
          <input
            id="setup-password"
            type="password"
            value={password}
            onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
            class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
            placeholder="Create a strong password"
            autoComplete="new-password"
            aria-describedby={requirementsId}
            aria-invalid={errors.length > 0 ? 'true' : undefined}
            aria-errormessage={errors.length > 0 ? passwordErrorId : undefined}
          />

          {/* Password requirements */}
          <div id={requirementsId} class="mt-2 space-y-1" aria-label="Password requirements">
            <PasswordRequirement met={password.length >= 8}>
              At least 8 characters
            </PasswordRequirement>
            <PasswordRequirement met={/[A-Z]/.test(password)}>
              One uppercase letter
            </PasswordRequirement>
            <PasswordRequirement met={/[a-z]/.test(password)}>
              One lowercase letter
            </PasswordRequirement>
            <PasswordRequirement met={/[0-9]/.test(password)}>One number</PasswordRequirement>
          </div>
        </div>

        <div>
          <label htmlFor="setup-confirm-password" class="block text-sm text-raft-700 mb-1">
            Confirm Password
          </label>
          <input
            id="setup-confirm-password"
            type="password"
            value={confirmPassword}
            onInput={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
            class="w-full px-3 py-2 border border-raft-300 rounded-md focus:ring-raft-500 focus:border-raft-500"
            placeholder="Confirm your password"
            autoComplete="new-password"
          />
          {confirmPassword && password !== confirmPassword && (
            <p class="text-sm text-red-600 mt-1">Passwords do not match</p>
          )}
        </div>

        {errors.length > 0 && (
          <div
            id={passwordErrorId}
            role="alert"
            class="bg-red-50 border border-red-200 rounded-lg p-3"
          >
            <ul class="text-sm text-red-700 space-y-1" aria-label="Password errors">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p class="text-sm text-yellow-800 font-medium">Important</p>
          <p class="text-sm text-yellow-700 mt-1">
            If you forget this password, you will need the recovery key to access your synced
            sessions. You'll receive a recovery key after setup - save it somewhere safe!
          </p>
        </div>

        <div class="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={!isValid || saving}
            class="px-4 py-2 bg-raft-600 text-white rounded-lg hover:bg-raft-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Setting up...' : 'Set Up Encryption'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            class="px-4 py-2 border border-raft-300 text-raft-700 rounded-lg hover:bg-raft-50 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  )
}

interface PasswordRequirementProps {
  met: boolean
  children: preact.ComponentChildren
}

function PasswordRequirement({ met, children }: PasswordRequirementProps) {
  return (
    <p
      class={`text-xs flex items-center gap-1.5 ${met ? 'text-green-600' : 'text-raft-400'}`}
      aria-live="polite"
    >
      <span class="text-base" aria-hidden="true">
        {met ? '✓' : '○'}
      </span>
      <span class="sr-only">{met ? 'Met: ' : 'Not met: '}</span>
      {children}
    </p>
  )
}
