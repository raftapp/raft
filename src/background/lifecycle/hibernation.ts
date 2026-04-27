/**
 * Post-startup re-discard guard.
 *
 * After onStartup fires and Raft discards all eligible tabs, Chrome still
 * does two annoying things during the next ~30 seconds:
 *   1. Loads tabs that weren't discardable at the moment we asked (no main
 *      frame yet) — they come in fresh, un-discarded.
 *   2. Undiscards recently-used tabs via its BackgroundTabLoadingPolicy.
 *
 * The guard catches both by re-discarding any tab-in-the-watch-list whose
 * status transitions to 'complete' or whose `discarded` flag goes false
 * inside the window (see the tabs.onUpdated listener).
 *
 * PWA QUIRK (commit 50d3d7b, issue #6): when Chrome is cold-started by a
 * PWA, onStartup runs before any normal browser window exists. The regular
 * window gets restored later — AFTER onStartup has already finished. That
 * window's tabs never saw the initial discard pass, so `hibernateWindow()`
 * (called from browser.windows.onCreated during the guard window) sweeps
 * them up too.
 *
 * The 30s HIBERNATION_GUARD_DURATION_MS was tuned empirically against
 * Chrome 131 with PWA-started sessions. Do NOT shorten without retesting
 * the PWA path — shorter windows regress #6.
 */

import { browser } from '@/shared/browser'
import { settingsStorage } from '@/shared/storage'
import { SESSION_KEYS } from '@/shared/constants'
import { suspendOtherTabs } from '../suspension'

export async function maybeHibernateTab(tabId: number): Promise<void> {
  const result = await browser.storage.session.get(SESSION_KEYS.HIBERNATION_GUARD)
  const guard = result[SESSION_KEYS.HIBERNATION_GUARD] as
    | { expiresAt: number; tabIds: number[] }
    | undefined
  if (!guard) return

  if (Date.now() > guard.expiresAt) {
    await browser.storage.session.remove(SESSION_KEYS.HIBERNATION_GUARD)
    return
  }

  if (!guard.tabIds.includes(tabId)) return

  const tab = await browser.tabs.get(tabId)
  if (tab.active) return
  if (tab.discarded) return

  console.log(`[Raft] Hibernation guard: discarding tab ${tabId} (${tab.url})`)
  try {
    await browser.tabs.discard(tabId)
  } catch (e) {
    console.warn(`[Raft] Hibernation guard: failed to discard tab ${tabId}:`, e)
  }
}

/**
 * Hibernate all eligible tabs in a window. Used by the onCreated guard
 * when a normal browser window appears after onStartup already ran
 * (e.g., PWA started Chrome first, then the regular window restored).
 */
export async function hibernateWindow(windowId: number): Promise<void> {
  const settings = await settingsStorage.get()
  if (!settings.suspension.hibernateOnStartup) return

  const extensionOrigin = browser.runtime.getURL('')
  const winTabs = await browser.tabs.query({ windowId })

  // Open a Raft page as the active tab so we can discard the user's active tab
  const raftTab = winTabs.find((t) => t.url?.startsWith(extensionOrigin))
  if (raftTab?.id) {
    await browser.tabs.update(raftTab.id, { active: true })
  } else {
    await browser.tabs.create({
      url: browser.runtime.getURL('src/options/index.html#sessions'),
      active: true,
      windowId,
    })
  }

  const count = await suspendOtherTabs(windowId)
  console.log(`[Raft] Hibernation guard: hibernated ${count} tabs in late window ${windowId}`)
}
