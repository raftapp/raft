import { browser } from '@/shared/browser'
import { settingsStorage } from '@/shared/storage'
import { getTabCounts } from './suspension'

/**
 * Update the extension badge with suspended tab count.
 */
export async function updateBadge(): Promise<void> {
  const settings = await settingsStorage.get()

  if (!settings.ui.showBadge) {
    await browser.action.setBadgeText({ text: '' })
    return
  }

  const counts = await getTabCounts()
  const text = counts.suspended > 0 ? counts.suspended.toString() : ''

  await browser.action.setBadgeText({ text })
  await browser.action.setBadgeBackgroundColor({ color: '#c07a42' }) // raft-500
}
