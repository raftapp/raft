/**
 * Pro Upgrade Component
 *
 * Shows the benefits of Pro tier, upgrade button, and license key entry.
 */

import { useState, useEffect } from 'preact/hooks'
import { PRO_PRICING } from '@/shared/constants'
import type { LicenseData } from '@/shared/licensing'

interface ProUpgradeProps {
  compact?: boolean
  onLicenseActivated?: () => void
}

export function ProUpgrade({ compact = false, onLicenseActivated }: ProUpgradeProps) {
  const [licenseKey, setLicenseKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [error, setError] = useState('')
  const [license, setLicense] = useState<LicenseData | null>(null)

  useEffect(() => {
    // Load existing license
    chrome.runtime.sendMessage({ type: 'PRO_GET_LICENSE' }).then((response) => {
      if (response.success && response.data.license) {
        setLicense(response.data.license)
      }
    })
  }, [])

  const handleCheckout = () => {
    chrome.runtime.sendMessage({ type: 'PRO_OPEN_CHECKOUT' })
  }

  const handleActivate = async () => {
    if (!licenseKey.trim()) return

    setActivating(true)
    setError('')

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'PRO_ACTIVATE_LICENSE',
        licenseKey: licenseKey.trim(),
      })

      if (response.success) {
        setLicense(response.data.license)
        setLicenseKey('')
        onLicenseActivated?.()
      } else {
        setError(response.error || 'Failed to activate license')
      }
    } catch {
      setError('Failed to activate license')
    } finally {
      setActivating(false)
    }
  }

  const handleDeactivate = async () => {
    if (!confirm('Are you sure you want to remove your license from this device?')) {
      return
    }

    await chrome.runtime.sendMessage({ type: 'PRO_CLEAR_LICENSE' })
    setLicense(null)
  }

  // If already Pro, show license info
  if (license?.status === 'active') {
    return (
      <section class="bg-green-50 rounded-lg shadow-sm border border-green-200 p-6">
        <div class="flex items-center gap-3 mb-3">
          <span class="text-2xl">🦦</span>
          <div>
            <h2 class="text-lg font-semibold text-green-900">Raft Pro Active</h2>
            <p class="text-sm text-green-700">Licensed to {license.email || 'you'}</p>
          </div>
        </div>
        <p class="text-sm text-green-600 mb-4">
          Thank you for supporting Raft! Cloud sync is enabled.
        </p>
        <button
          onClick={handleDeactivate}
          class="text-sm text-green-700 hover:text-green-800 underline"
        >
          Remove license from this device
        </button>
      </section>
    )
  }

  if (compact) {
    return (
      <div class="bg-gradient-to-r from-raft-100 to-orange-100 rounded-lg p-4 border border-raft-200">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-raft-900">Cloud Sync</p>
            <p class="text-xs text-raft-600">Sync sessions across devices</p>
          </div>
          <button
            onClick={handleCheckout}
            class="px-3 py-1.5 bg-raft-600 text-white text-sm rounded-lg hover:bg-raft-700"
          >
            Upgrade ${PRO_PRICING.PRICE_USD}
          </button>
        </div>
      </div>
    )
  }

  return (
    <section class="bg-gradient-to-br from-raft-50 to-orange-50 rounded-lg shadow-sm border border-raft-200 p-6">
      <div class="flex items-start gap-4">
        <img src="/mascot/sleeping.png" alt="" class="w-10 h-10 object-contain" draggable={false} />
        <div class="flex-1">
          <h2 class="text-lg font-semibold text-raft-900">Upgrade to Raft Pro</h2>
          <p class="text-sm text-raft-600 mt-1">
            Sync your sessions across all your devices with encrypted cloud storage.
          </p>

          <ul class="mt-4 space-y-2">
            <ProFeature>Google Drive cloud sync</ProFeature>
            <ProFeature>End-to-end encryption</ProFeature>
            <ProFeature>Sync across unlimited devices</ProFeature>
          </ul>

          <div class="mt-6 flex items-center gap-4">
            <button
              onClick={handleCheckout}
              class="px-6 py-2.5 bg-raft-600 text-white font-medium rounded-lg hover:bg-raft-700 transition-colors"
            >
              Upgrade for ${PRO_PRICING.PRICE_USD}
            </button>
            <span class="text-sm text-raft-500">One-time payment, lifetime access</span>
          </div>

          <p class="mt-4 text-xs text-raft-400">
            Secure payment via Lemon Squeezy. 14-day money-back guarantee.
          </p>

          {/* License Key Entry */}
          <div class="mt-6 pt-6 border-t border-raft-200">
            <p class="text-sm text-raft-700 mb-2">Already purchased? Enter your license key:</p>
            <div class="flex gap-2">
              <input
                type="text"
                value={licenseKey}
                onInput={(e) => setLicenseKey((e.target as HTMLInputElement).value)}
                onKeyPress={(e) => e.key === 'Enter' && handleActivate()}
                placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                class="flex-1 px-3 py-2 text-sm border border-raft-300 rounded-lg focus:ring-raft-500 focus:border-raft-500 font-mono"
              />
              <button
                onClick={handleActivate}
                disabled={!licenseKey.trim() || activating}
                class="px-4 py-2 bg-raft-600 text-white text-sm rounded-lg hover:bg-raft-700 disabled:opacity-50"
              >
                {activating ? 'Activating...' : 'Activate'}
              </button>
            </div>
            {error && <p class="mt-2 text-sm text-red-600">{error}</p>}
            <p class="mt-2 text-xs text-raft-400">
              You received your license key via email after purchase.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

function ProFeature({ children }: { children: preact.ComponentChildren }) {
  return (
    <li class="flex items-center gap-2 text-sm text-raft-700">
      <span class="text-green-600">✓</span>
      {children}
    </li>
  )
}
