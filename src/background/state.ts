/**
 * Background service worker in-memory state.
 *
 * MV3 service workers terminate after ~30s of inactivity, so anything that
 * needs to outlive a single wake must be persisted to browser.storage.
 * The maps below are reloaded from storage during initialize().
 */

import { storage } from '@/shared/storage'
import { STORAGE_KEYS } from '@/shared/constants'

// Track previously active tab per window (for activity-on-leave tracking).
// When the user switches away from a tab, we touch it to record the departure
// time. Persisted to browser.storage so it survives service worker restarts.
export const previousActiveTab: Map<number, number> = new Map()

// Initialization promise — listeners await this before touching state that
// initialize() populates from storage.
let resolveInit: () => void
export const initReady: Promise<void> = new Promise((resolve) => {
  resolveInit = resolve
})

export function markInitReady(): void {
  resolveInit()
}

export async function loadPreviousActiveTabs(): Promise<void> {
  const stored = await storage.get<Record<string, number>>(STORAGE_KEYS.PREVIOUS_ACTIVE_TABS, {})
  previousActiveTab.clear()
  for (const [windowId, tabId] of Object.entries(stored)) {
    previousActiveTab.set(parseInt(windowId, 10), tabId)
  }
}

export async function savePreviousActiveTabs(): Promise<void> {
  const obj: Record<string, number> = {}
  for (const [windowId, tabId] of previousActiveTab) {
    obj[String(windowId)] = tabId
  }
  await storage.set(STORAGE_KEYS.PREVIOUS_ACTIVE_TABS, obj)
}
