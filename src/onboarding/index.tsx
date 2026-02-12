/**
 * Raft Onboarding Page
 *
 * Welcome page shown on first install.
 * Introduces users to Raft's features and gets them started.
 */

import { render } from 'preact'
import { Otter } from '@/shared/components/Otter'
import { SkipLink } from '@/shared/a11y'
import './styles.css'

function FeatureItem({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div class="flex gap-4 items-start" role="listitem">
      <div
        class="w-12 h-12 rounded-xl bg-raft-100 flex items-center justify-center text-2xl shrink-0"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div>
        <h3 class="font-semibold text-raft-900 mb-1">{title}</h3>
        <p class="text-sm text-raft-600">{description}</p>
      </div>
    </div>
  )
}

function App() {
  const handleGetStarted = () => {
    // Mark onboarding as complete
    chrome.storage.local.set({ onboardingComplete: true })
    // Navigate to options page instead of closing immediately
    // This allows users to reference onboarding info and configure settings
    chrome.runtime.openOptionsPage()
  }

  return (
    <div class="min-h-screen bg-gradient-to-b from-raft-50 to-white flex items-center justify-center p-8">
      {/* Skip link to main CTA */}
      <SkipLink href="#get-started">Skip to Get Started</SkipLink>

      <div class="max-w-2xl w-full">
        {/* Header with mascot */}
        <header class="text-center mb-12">
          <Otter className="w-32 h-32 mx-auto mb-6" />
          <h1 class="text-4xl font-bold text-raft-900 mb-3">Welcome to Raft</h1>
          <p class="text-xl text-raft-600">Keep your tabs safe</p>
        </header>

        {/* Tagline */}
        <div class="bg-white rounded-2xl shadow-sm border border-raft-200 p-8 mb-8">
          <p class="text-center text-raft-700 text-lg mb-8">
            Like otters holding hands while they sleep, Raft keeps your tabs together and protected.
          </p>

          {/* Features */}
          <div class="space-y-6" role="list" aria-label="Key features">
            <FeatureItem
              icon="💤"
              title="Suspend Inactive Tabs"
              description="Uses Chrome's built-in tab suspension to free memory from tabs you haven't used in a while. Your tabs stay safe and reload instantly when you click them."
            />
            <FeatureItem
              icon="💾"
              title="Save Sessions"
              description="Save your current windows and tabs as a session. Restore them anytime with all your tab groups intact."
            />
            <FeatureItem
              icon="🔍"
              title="Search Everything"
              description="Find any saved session by name, URL, or page title. Your browsing history, organized and searchable."
            />
            <FeatureItem
              icon="🔄"
              title="Import & Export"
              description="Bring your tabs from OneTab, Session Buddy, or other managers. Export your sessions anytime as backup."
            />
          </div>
        </div>

        {/* Quick tips */}
        <div class="bg-raft-100 rounded-xl p-6 mb-8">
          <h2 class="font-semibold text-raft-800 mb-3">Quick Tips</h2>
          <ul class="space-y-2 text-sm text-raft-700">
            <li class="flex items-center gap-2">
              <span class="w-5 h-5 rounded bg-raft-200 flex items-center justify-center text-xs">
                1
              </span>
              Click the Raft icon in your toolbar to suspend tabs or save sessions
            </li>
            <li class="flex items-center gap-2">
              <span class="w-5 h-5 rounded bg-raft-200 flex items-center justify-center text-xs">
                2
              </span>
              Use{' '}
              <kbd class="px-1.5 py-0.5 bg-white rounded border border-raft-300 text-xs">
                Alt+Shift+S
              </kbd>{' '}
              to quickly suspend the current tab
            </li>
            <li class="flex items-center gap-2">
              <span class="w-5 h-5 rounded bg-raft-200 flex items-center justify-center text-xs">
                3
              </span>
              Pinned tabs and tabs playing audio are never suspended automatically
            </li>
          </ul>
        </div>

        {/* Backup note */}
        <div class="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
          <h2 class="font-semibold text-blue-800 mb-3 flex items-center gap-2">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Keep Your Data Safe
          </h2>
          <div class="text-sm text-blue-700 space-y-2">
            <p>
              Your sessions sync across devices with the same Chrome profile. However,{' '}
              <strong>if you uninstall Raft or clear browser data, that sync data is gone.</strong>
            </p>
            <p>We'll remind you periodically to export backups. Your data, your control.</p>
            <p class="text-blue-600 font-medium">
              Want automatic cloud backup? Upgrade to Pro for Google Drive sync that survives
              anything.
            </p>
          </div>
        </div>

        {/* CTA */}
        <div class="text-center">
          <button
            id="get-started"
            onClick={handleGetStarted}
            class="px-8 py-4 bg-raft-600 text-white text-lg font-semibold rounded-xl hover:bg-raft-700 transition-colors shadow-sm"
          >
            Get Started
          </button>
          <p class="mt-4 text-sm text-raft-500">
            You can access settings anytime by right-clicking the Raft icon
          </p>
        </div>
      </div>
    </div>
  )
}

render(<App />, document.getElementById('app')!)
