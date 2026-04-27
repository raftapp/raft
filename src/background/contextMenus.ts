import { browser } from '@/shared/browser'

/**
 * Set up context menus for right-click actions.
 */
export async function setupContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll()

  try {
    browser.contextMenus.create(
      {
        id: 'suspend-tab',
        title: 'Suspend this tab',
        contexts: ['page'],
      },
      () => {
        if (browser.runtime.lastError) {
          console.warn('[Raft] Failed to create suspend-tab menu:', browser.runtime.lastError)
        }
      }
    )
  } catch (err) {
    console.warn('[Raft] Failed to create suspend-tab menu:', err)
  }

  try {
    browser.contextMenus.create(
      {
        id: 'suspend-other-tabs',
        title: 'Suspend other tabs in window',
        contexts: ['page'],
      },
      () => {
        if (browser.runtime.lastError) {
          console.warn(
            '[Raft] Failed to create suspend-other-tabs menu:',
            browser.runtime.lastError
          )
        }
      }
    )
  } catch (err) {
    console.warn('[Raft] Failed to create suspend-other-tabs menu:', err)
  }
}
