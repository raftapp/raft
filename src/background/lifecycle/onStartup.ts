import { browser } from '@/shared/browser'
import { settingsStorage } from '@/shared/storage'
import {
  SESSION_KEYS,
  HIBERNATION_GUARD_DURATION_MS,
  PROTECTED_URL_PATTERNS,
} from '@/shared/constants'
import { suspendOtherTabs } from '../suspension'

/**
 * Handle browser startup — hibernate all tabs if the setting is enabled.
 */
export async function handleStartup(): Promise<void> {
  const settings = await settingsStorage.get()
  if (!settings.suspension.hibernateOnStartup) return

  console.log('[Raft] Hibernate on startup enabled, suspending all tabs')
  const allWindows = await browser.windows.getAll()
  const windows = allWindows.filter((w) => w.type === 'normal')
  const extensionOrigin = browser.runtime.getURL('')
  const hibernateTabIds: number[] = []

  for (const win of windows) {
    if (!win.id) continue
    // We need a Raft extension page as the active tab so browser.tabs.discard()
    // can suspend the user's previously-active tab. Reuse one if already open.
    const winTabs = await browser.tabs.query({ windowId: win.id })
    const raftTab = winTabs.find((t) => t.url?.startsWith(extensionOrigin))
    if (raftTab?.id) {
      await browser.tabs.update(raftTab.id, { active: true })
    } else {
      await browser.tabs.create({
        url: browser.runtime.getURL('src/options/index.html#sessions'),
        active: true,
        windowId: win.id,
      })
    }

    // Record all non-active, non-protected tabs for the hibernation guard
    for (const t of winTabs) {
      if (
        t.id &&
        !t.active &&
        t.url &&
        !t.url.startsWith(extensionOrigin) &&
        !PROTECTED_URL_PATTERNS.some((p) => t.url!.startsWith(p))
      ) {
        hibernateTabIds.push(t.id)
      }
    }

    const count = await suspendOtherTabs(win.id)
    console.log(`[Raft] Hibernated ${count} tabs in window ${win.id}`)
  }

  // Guard catches tabs that couldn't be discarded yet (no main frame),
  // tabs Chrome's startup loader undiscards, and normal windows that
  // appear after onStartup (e.g., PWA started Chrome first)
  await browser.storage.session.set({
    [SESSION_KEYS.HIBERNATION_GUARD]: {
      expiresAt: Date.now() + HIBERNATION_GUARD_DURATION_MS,
      tabIds: hibernateTabIds,
    },
  })
  console.log(
    `[Raft] Hibernation guard set for ${hibernateTabIds.length} tabs (${HIBERNATION_GUARD_DURATION_MS / 1000}s window)`
  )
}
