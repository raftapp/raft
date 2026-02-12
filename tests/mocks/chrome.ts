/**
 * Chrome API Mock Library
 *
 * Comprehensive mocks for Chrome extension APIs used by Raft.
 * Designed for use with Vitest in a jsdom environment.
 */

import { vi } from 'vitest'

// Type definitions for mock state
interface MockTab {
  id: number
  url?: string
  title?: string
  favIconUrl?: string
  windowId: number
  index: number
  active: boolean
  pinned: boolean
  audible: boolean
  groupId: number
  lastAccessed?: number
  discarded?: boolean
}

interface MockWindow {
  id: number
  focused: boolean
  type: 'normal' | 'popup' | 'panel' | 'devtools'
  state: chrome.windows.WindowState
  tabs: MockTab[]
}

interface MockTabGroup {
  id: number
  windowId: number
  title?: string
  color: chrome.tabGroups.Color
  collapsed: boolean
}

interface MockAlarm {
  name: string
  scheduledTime: number
  periodInMinutes?: number
}

interface MockStorage {
  [key: string]: unknown
}

// Mock state - mutable for tests
let mockStorage: MockStorage = {}
let mockSyncStorage: MockStorage = {}
let mockTabs: Map<number, MockTab> = new Map()
let mockWindows: Map<number, MockWindow> = new Map()
let mockTabGroups: Map<number, MockTabGroup> = new Map()
let mockAlarms: Map<string, MockAlarm> = new Map()
let nextTabId = 1
let nextWindowId = 1
let nextGroupId = 1

// Storage change listeners
type StorageChangeListener = (
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string
) => void
let storageListeners: StorageChangeListener[] = []

// Alarm listener
type AlarmListener = (alarm: chrome.alarms.Alarm) => void
let alarmListeners: AlarmListener[] = []

/**
 * Reset all mock state - call in beforeEach
 */
export function resetMockChrome(): void {
  mockStorage = {}
  mockSyncStorage = {}
  mockTabs.clear()
  mockWindows.clear()
  mockTabGroups.clear()
  mockAlarms.clear()
  storageListeners = []
  alarmListeners = []
  nextTabId = 1
  nextWindowId = 1
  nextGroupId = 1
}

/**
 * Set mock storage values directly
 */
export function setMockStorage(data: MockStorage): void {
  mockStorage = { ...mockStorage, ...data }
}

/**
 * Get current mock storage (for assertions)
 */
export function getMockStorage(): MockStorage {
  return { ...mockStorage }
}

/**
 * Set mock sync storage values directly
 */
export function setMockSyncStorage(data: MockStorage): void {
  mockSyncStorage = { ...mockSyncStorage, ...data }
}

/**
 * Get current mock sync storage (for assertions)
 */
export function getMockSyncStorage(): MockStorage {
  return { ...mockSyncStorage }
}

/**
 * Add a mock tab
 */
export function addMockTab(tab: Partial<MockTab> & { windowId: number }): MockTab {
  const id = tab.id ?? nextTabId++
  const window = mockWindows.get(tab.windowId)
  const index = tab.index ?? (window?.tabs.length ?? 0)

  const mockTab: MockTab = {
    id,
    url: tab.url ?? 'about:blank',
    title: tab.title ?? 'New Tab',
    favIconUrl: tab.favIconUrl,
    windowId: tab.windowId,
    index,
    active: tab.active ?? false,
    pinned: tab.pinned ?? false,
    audible: tab.audible ?? false,
    groupId: tab.groupId ?? -1,
    lastAccessed: tab.lastAccessed ?? Date.now(),
    discarded: tab.discarded ?? false,
  }

  mockTabs.set(id, mockTab)

  if (window) {
    window.tabs.push(mockTab)
    // Re-sort by index
    window.tabs.sort((a, b) => a.index - b.index)
  }

  return mockTab
}

/**
 * Add a mock window
 */
export function addMockWindow(win?: Partial<MockWindow>): MockWindow {
  const id = win?.id ?? nextWindowId++

  const mockWindow: MockWindow = {
    id,
    focused: win?.focused ?? false,
    type: win?.type ?? 'normal',
    state: win?.state ?? 'normal',
    tabs: [],
  }

  mockWindows.set(id, mockWindow)
  return mockWindow
}

/**
 * Add a mock tab group
 */
export function addMockTabGroup(
  group: Partial<MockTabGroup> & { windowId: number }
): MockTabGroup {
  const id = group.id ?? nextGroupId++

  const mockGroup: MockTabGroup = {
    id,
    windowId: group.windowId,
    title: group.title ?? '',
    color: group.color ?? 'blue',
    collapsed: group.collapsed ?? false,
  }

  mockTabGroups.set(id, mockGroup)
  return mockGroup
}

/**
 * Create the mock chrome object
 */
export function createMockChrome() {
  return {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) {
            return { ...mockStorage }
          }
          const keyList = Array.isArray(keys) ? keys : [keys]
          const result: Record<string, unknown> = {}
          for (const key of keyList) {
            if (key in mockStorage) {
              result[key] = mockStorage[key]
            }
          }
          return result
        }),

        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: { [key: string]: chrome.storage.StorageChange } = {}
          for (const [key, value] of Object.entries(items)) {
            changes[key] = {
              oldValue: mockStorage[key],
              newValue: value,
            }
            mockStorage[key] = value
          }
          // Notify listeners
          for (const listener of storageListeners) {
            listener(changes, 'local')
          }
        }),

        remove: vi.fn(async (keys: string | string[]) => {
          const keyList = Array.isArray(keys) ? keys : [keys]
          const changes: { [key: string]: chrome.storage.StorageChange } = {}
          for (const key of keyList) {
            if (key in mockStorage) {
              changes[key] = { oldValue: mockStorage[key] }
              delete mockStorage[key]
            }
          }
          for (const listener of storageListeners) {
            listener(changes, 'local')
          }
        }),

        clear: vi.fn(async () => {
          mockStorage = {}
        }),
      },

      onChanged: {
        addListener: vi.fn((listener: StorageChangeListener) => {
          storageListeners.push(listener)
        }),
        removeListener: vi.fn((listener: StorageChangeListener) => {
          storageListeners = storageListeners.filter((l) => l !== listener)
        }),
      },

      sync: {
        get: vi.fn(async (keys: string | string[] | null) => {
          if (keys === null) {
            return { ...mockSyncStorage }
          }
          const keyList = Array.isArray(keys) ? keys : [keys]
          const result: Record<string, unknown> = {}
          for (const key of keyList) {
            if (key in mockSyncStorage) {
              result[key] = mockSyncStorage[key]
            }
          }
          return result
        }),

        set: vi.fn(async (items: Record<string, unknown>) => {
          const changes: { [key: string]: chrome.storage.StorageChange } = {}
          for (const [key, value] of Object.entries(items)) {
            changes[key] = {
              oldValue: mockSyncStorage[key],
              newValue: value,
            }
            mockSyncStorage[key] = value
          }
          // Notify listeners
          for (const listener of storageListeners) {
            listener(changes, 'sync')
          }
        }),

        remove: vi.fn(async (keys: string | string[]) => {
          const keyList = Array.isArray(keys) ? keys : [keys]
          const changes: { [key: string]: chrome.storage.StorageChange } = {}
          for (const key of keyList) {
            if (key in mockSyncStorage) {
              changes[key] = { oldValue: mockSyncStorage[key] }
              delete mockSyncStorage[key]
            }
          }
          for (const listener of storageListeners) {
            listener(changes, 'sync')
          }
        }),

        clear: vi.fn(async () => {
          mockSyncStorage = {}
        }),
      },
    },

    tabs: {
      get: vi.fn(async (tabId: number) => {
        const tab = mockTabs.get(tabId)
        if (!tab) throw new Error(`Tab ${tabId} not found`)
        return { ...tab }
      }),

      query: vi.fn(async (queryInfo: chrome.tabs.QueryInfo) => {
        let results = Array.from(mockTabs.values())

        if (queryInfo.windowId !== undefined) {
          results = results.filter((t) => t.windowId === queryInfo.windowId)
        }
        if (queryInfo.active !== undefined) {
          results = results.filter((t) => t.active === queryInfo.active)
        }
        if (queryInfo.pinned !== undefined) {
          results = results.filter((t) => t.pinned === queryInfo.pinned)
        }
        if (queryInfo.audible !== undefined) {
          results = results.filter((t) => t.audible === queryInfo.audible)
        }
        if (queryInfo.discarded !== undefined) {
          results = results.filter((t) => t.discarded === queryInfo.discarded)
        }
        if (queryInfo.url !== undefined) {
          const patterns = Array.isArray(queryInfo.url) ? queryInfo.url : [queryInfo.url]
          results = results.filter((t) =>
            patterns.some((p) => t.url?.includes(p.replace(/\*/g, '')))
          )
        }

        return results.map((t) => ({ ...t }))
      }),

      create: vi.fn(async (createProperties: chrome.tabs.CreateProperties) => {
        const windowId = createProperties.windowId ?? Array.from(mockWindows.keys())[0] ?? 1
        const tab = addMockTab({
          windowId,
          url: createProperties.url,
          index: createProperties.index,
          pinned: createProperties.pinned,
          active: createProperties.active ?? true,
        })
        return { ...tab }
      }),

      update: vi.fn(async (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => {
        const tab = mockTabs.get(tabId)
        if (!tab) throw new Error(`Tab ${tabId} not found`)

        if (updateProperties.url !== undefined) tab.url = updateProperties.url
        if (updateProperties.pinned !== undefined) tab.pinned = updateProperties.pinned
        if (updateProperties.active !== undefined) {
          if (updateProperties.active) {
            // Deactivate other tabs in same window
            for (const t of mockTabs.values()) {
              if (t.windowId === tab.windowId) t.active = false
            }
          }
          tab.active = updateProperties.active
        }

        return { ...tab }
      }),

      remove: vi.fn(async (tabIds: number | number[]) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds]
        for (const id of ids) {
          const tab = mockTabs.get(id)
          if (tab) {
            const win = mockWindows.get(tab.windowId)
            if (win) {
              win.tabs = win.tabs.filter((t) => t.id !== id)
            }
            mockTabs.delete(id)
          }
        }
      }),

      group: vi.fn(async (options: chrome.tabs.GroupOptions) => {
        const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds]
        let groupId = options.groupId

        if (groupId === undefined && options.createProperties) {
          // Create new group
          const firstTab = mockTabs.get(tabIds[0])
          const windowId = options.createProperties.windowId ?? firstTab?.windowId ?? 1
          const group = addMockTabGroup({ windowId })
          groupId = group.id
        }

        // Add tabs to group
        for (const tabId of tabIds) {
          const tab = mockTabs.get(tabId)
          if (tab && groupId !== undefined) {
            tab.groupId = groupId
          }
        }

        return groupId!
      }),

      ungroup: vi.fn(async (tabIds: number | number[]) => {
        const ids = Array.isArray(tabIds) ? tabIds : [tabIds]
        for (const id of ids) {
          const tab = mockTabs.get(id)
          if (tab) tab.groupId = -1
        }
      }),

      discard: vi.fn(async (tabId: number) => {
        const tab = mockTabs.get(tabId)
        if (!tab) throw new Error(`Tab ${tabId} not found`)
        tab.discarded = true
        return { ...tab }
      }),

      reload: vi.fn(async (tabId: number) => {
        const tab = mockTabs.get(tabId)
        if (!tab) throw new Error(`Tab ${tabId} not found`)
        tab.discarded = false
        return { ...tab }
      }),
    },

    windows: {
      get: vi.fn(async (windowId: number, getInfo?: chrome.windows.GetInfo) => {
        const win = mockWindows.get(windowId)
        if (!win) throw new Error(`Window ${windowId} not found`)

        const result: MockWindow & { tabs?: MockTab[] } = { ...win }
        if (getInfo?.populate) {
          result.tabs = win.tabs.map((t) => ({ ...t }))
        }
        return result
      }),

      getAll: vi.fn(async (getInfo?: chrome.windows.GetInfo) => {
        return Array.from(mockWindows.values()).map((win) => {
          const result: MockWindow & { tabs?: MockTab[] } = { ...win }
          if (getInfo?.populate) {
            result.tabs = win.tabs.map((t) => ({ ...t }))
          }
          return result
        })
      }),

      getCurrent: vi.fn(async () => {
        const focused = Array.from(mockWindows.values()).find((w) => w.focused)
        return focused ?? Array.from(mockWindows.values())[0] ?? { id: 1 }
      }),

      create: vi.fn(async (createData?: chrome.windows.CreateData) => {
        const win = addMockWindow({
          focused: createData?.focused ?? true,
          state: createData?.state,
          type: createData?.type as 'normal',
        })

        if (createData?.url) {
          const urls = Array.isArray(createData.url) ? createData.url : [createData.url]
          for (const url of urls) {
            addMockTab({ windowId: win.id, url, active: true })
          }
        }

        return { ...win, tabs: win.tabs.map((t) => ({ ...t })) }
      }),

      remove: vi.fn(async (windowId: number) => {
        const win = mockWindows.get(windowId)
        if (win) {
          for (const tab of win.tabs) {
            mockTabs.delete(tab.id)
          }
          mockWindows.delete(windowId)
        }
      }),
    },

    tabGroups: {
      query: vi.fn(async (queryInfo: chrome.tabGroups.QueryInfo) => {
        let results = Array.from(mockTabGroups.values())

        if (queryInfo.windowId !== undefined) {
          results = results.filter((g) => g.windowId === queryInfo.windowId)
        }
        if (queryInfo.collapsed !== undefined) {
          results = results.filter((g) => g.collapsed === queryInfo.collapsed)
        }
        if (queryInfo.color !== undefined) {
          results = results.filter((g) => g.color === queryInfo.color)
        }

        return results.map((g) => ({ ...g }))
      }),

      update: vi.fn(async (groupId: number, updateProperties: chrome.tabGroups.UpdateProperties) => {
        const group = mockTabGroups.get(groupId)
        if (!group) throw new Error(`Group ${groupId} not found`)

        if (updateProperties.title !== undefined) group.title = updateProperties.title
        if (updateProperties.color !== undefined) group.color = updateProperties.color
        if (updateProperties.collapsed !== undefined) group.collapsed = updateProperties.collapsed

        return { ...group }
      }),
    },

    alarms: {
      create: vi.fn((name: string, alarmInfo: chrome.alarms.AlarmCreateInfo) => {
        const now = Date.now()
        const alarm: MockAlarm = {
          name,
          scheduledTime: alarmInfo.when ?? now + (alarmInfo.delayInMinutes ?? 0) * 60000,
          periodInMinutes: alarmInfo.periodInMinutes,
        }
        mockAlarms.set(name, alarm)
      }),

      get: vi.fn(async (name: string) => {
        return mockAlarms.get(name) ?? null
      }),

      getAll: vi.fn(async () => {
        return Array.from(mockAlarms.values())
      }),

      clear: vi.fn(async (name: string) => {
        return mockAlarms.delete(name)
      }),

      clearAll: vi.fn(async () => {
        mockAlarms.clear()
        return true
      }),

      onAlarm: {
        addListener: vi.fn((listener: AlarmListener) => {
          alarmListeners.push(listener)
        }),
        removeListener: vi.fn((listener: AlarmListener) => {
          alarmListeners = alarmListeners.filter((l) => l !== listener)
        }),
      },
    },

    runtime: {
      getURL: vi.fn((path: string) => {
        return `chrome-extension://mock-extension-id/${path}`
      }),

      sendMessage: vi.fn(async () => {}),

      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },

      onInstalled: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },

      onStartup: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },

    action: {
      setBadgeText: vi.fn(async () => {}),
      setBadgeBackgroundColor: vi.fn(async () => {}),
      setIcon: vi.fn(async () => {}),
      setTitle: vi.fn(async () => {}),
    },

    contextMenus: {
      create: vi.fn(() => {}),
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      removeAll: vi.fn(async () => {}),

      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },

    commands: {
      onCommand: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  }
}

/**
 * Helper to trigger an alarm (for testing)
 */
export function triggerMockAlarm(name: string): void {
  const alarm = mockAlarms.get(name)
  if (alarm) {
    for (const listener of alarmListeners) {
      listener(alarm as chrome.alarms.Alarm)
    }
  }
}

/**
 * Get all mock tabs (for assertions)
 */
export function getMockTabs(): MockTab[] {
  return Array.from(mockTabs.values())
}

/**
 * Get all mock windows (for assertions)
 */
export function getMockWindows(): MockWindow[] {
  return Array.from(mockWindows.values())
}

/**
 * Get all mock tab groups (for assertions)
 */
export function getMockTabGroups(): MockTabGroup[] {
  return Array.from(mockTabGroups.values())
}

// Export the mock chrome object
export const mockChrome = createMockChrome()
