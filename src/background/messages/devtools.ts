import { browser } from '@/shared/browser'
import { storage } from '@/shared/storage'
import { DEV_TEST_WINDOWS_KEY } from '@/shared/constants'
import type { MessageResponse, MessageType } from './types'

type DevToolsMessage = Extract<
  MessageType,
  {
    type: 'DEV_CREATE_SCENARIO' | 'DEV_CLEANUP_TEST_WINDOWS' | 'DEV_GET_TEST_WINDOW_IDS'
  }
>

/**
 * Get the list of test window IDs, filtering out windows that no longer exist.
 */
async function getTestWindowIds(): Promise<number[]> {
  const windowIds = await storage.get<number[]>(DEV_TEST_WINDOWS_KEY, [])
  const existingWindows = await browser.windows.getAll()
  const existingIds = new Set(existingWindows.map((w) => w.id))
  const validIds = windowIds.filter((id) => existingIds.has(id))
  if (validIds.length !== windowIds.length) {
    await storage.set(DEV_TEST_WINDOWS_KEY, validIds)
  }
  return validIds
}

async function addTestWindowId(windowId: number): Promise<void> {
  const windowIds = await getTestWindowIds()
  if (!windowIds.includes(windowId)) {
    windowIds.push(windowId)
    await storage.set(DEV_TEST_WINDOWS_KEY, windowIds)
  }
}

async function createDevScenario(
  scenario: import('@/devtools/types').DevScenario
): Promise<{ windowCount: number; tabCount: number }> {
  let totalTabs = 0

  for (const windowSpec of scenario.windows) {
    const createdWindow = await browser.windows.create({
      url: 'about:blank',
      focused: windowSpec.focused ?? false,
    })

    const windowId = createdWindow?.id
    if (windowId === undefined) continue
    await addTestWindowId(windowId)

    const initialTabs = await browser.tabs.query({ windowId })
    const blankTabId = initialTabs[0]?.id

    if (windowSpec.tabs) {
      for (const tabSpec of windowSpec.tabs) {
        await browser.tabs.create({
          windowId,
          url: tabSpec.url,
          pinned: tabSpec.pinned ?? false,
          active: tabSpec.active ?? false,
        })
        totalTabs++
      }
    }

    if (windowSpec.groups) {
      for (const groupSpec of windowSpec.groups) {
        const tabIds: number[] = []

        for (const tabSpec of groupSpec.tabs) {
          const tab = await browser.tabs.create({
            windowId,
            url: tabSpec.url,
            pinned: tabSpec.pinned ?? false,
            active: tabSpec.active ?? false,
          })
          if (tab.id) {
            tabIds.push(tab.id)
            totalTabs++
          }
        }

        if (tabIds.length > 0) {
          const tabIdsForGroup = tabIds as [number, ...number[]]
          const groupId = await browser.tabs.group({
            tabIds: tabIdsForGroup,
            createProperties: { windowId },
          })

          await browser.tabGroups.update(groupId, {
            title: groupSpec.title,
            color: groupSpec.color as browser.tabGroups.Color,
            collapsed: groupSpec.collapsed ?? false,
          })
        }
      }
    }

    if (blankTabId) {
      try {
        await browser.tabs.remove(blankTabId)
      } catch {
        // Tab may already be closed
      }
    }
  }

  return { windowCount: scenario.windows.length, tabCount: totalTabs }
}

async function cleanupTestWindows(): Promise<{ closedCount: number }> {
  const windowIds = await getTestWindowIds()
  let closedCount = 0

  for (const windowId of windowIds) {
    try {
      await browser.windows.remove(windowId)
      closedCount++
    } catch {
      // Window may already be closed
    }
  }

  await storage.set(DEV_TEST_WINDOWS_KEY, [])

  return { closedCount }
}

export async function handleDevToolsMessage(message: DevToolsMessage): Promise<MessageResponse> {
  if (!import.meta.env.DEV) {
    return { success: false, error: 'Dev tools are only available in development mode' }
  }

  switch (message.type) {
    case 'DEV_CREATE_SCENARIO': {
      const result = await createDevScenario(message.scenario)
      return { success: true, data: result }
    }

    case 'DEV_CLEANUP_TEST_WINDOWS': {
      const result = await cleanupTestWindows()
      return { success: true, data: result }
    }

    case 'DEV_GET_TEST_WINDOW_IDS': {
      const windowIds = await getTestWindowIds()
      return { success: true, data: { windowIds } }
    }
  }
}
