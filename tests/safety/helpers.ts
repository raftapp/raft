/**
 * Shared builders and assertion helpers for safety tests
 */

import { expect } from 'vitest'
import { nanoid } from 'nanoid'
import type { Session, Window, Tab, TabGroup, TabGroupColor } from '@/shared/types'
import {
  addMockWindow,
  addMockTab,
  addMockTabGroup,
} from '../mocks/chrome'

/** All 8 Chrome tab group colors */
const GROUP_COLORS: TabGroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
]

/**
 * Sets up 3 mock browser windows with 7 tab groups (all 8 colors),
 * 25+ tabs with mixed pinned/discarded/active states, diverse domains.
 */
export function buildRealisticBrowserState() {
  const domains = [
    'https://github.com/repo/issues',
    'https://docs.google.com/document/d/abc',
    'https://stackoverflow.com/questions/123',
    'https://www.notion.so/workspace/page',
    'https://slack.com/client/T123/C456',
    'https://mail.google.com/mail/u/0/#inbox',
    'https://calendar.google.com/calendar/r',
    'https://www.figma.com/file/abc',
    'https://app.linear.app/team/issue/PRJ-42',
    'https://developer.mozilla.org/en-US/docs/Web/API',
    'https://news.ycombinator.com/',
    'https://www.reddit.com/r/programming',
    'https://twitter.com/home',
    'https://www.youtube.com/watch?v=abc',
    'https://en.wikipedia.org/wiki/Tab_(interface)',
    'https://vercel.com/dashboard',
    'https://console.cloud.google.com/home',
    'https://aws.amazon.com/console/',
    'https://leetcode.com/problems/two-sum/',
    'https://codesandbox.io/s/abc',
    'https://jira.atlassian.com/browse/PRJ-100',
    'https://www.npmjs.com/package/vite',
    'https://vitejs.dev/guide/',
    'https://react.dev/learn',
    'https://tailwindcss.com/docs/installation',
    'https://preactjs.com/guide/v10/getting-started',
  ]

  // Window 1: Work - 10 tabs, 3 groups
  const win1 = addMockWindow({ focused: true, state: 'maximized' })
  const group1 = addMockTabGroup({ windowId: win1.id, title: 'Code Review', color: 'blue', collapsed: false })
  const group2 = addMockTabGroup({ windowId: win1.id, title: 'Docs', color: 'green', collapsed: true })
  const group3 = addMockTabGroup({ windowId: win1.id, title: 'Comms', color: 'yellow', collapsed: false })

  addMockTab({ windowId: win1.id, url: domains[0], title: 'GitHub Issues', pinned: true, active: true, groupId: -1 })
  addMockTab({ windowId: win1.id, url: domains[1], title: 'Project Spec', pinned: true, groupId: -1 })
  addMockTab({ windowId: win1.id, url: domains[2], title: 'SO: async/await', groupId: group1.id, favIconUrl: 'https://cdn.sstatic.net/Sites/stackoverflow/Img/favicon.ico' })
  addMockTab({ windowId: win1.id, url: domains[3], title: 'Notion Wiki', groupId: group2.id, discarded: true })
  addMockTab({ windowId: win1.id, url: domains[4], title: 'Slack #general', groupId: group3.id })
  addMockTab({ windowId: win1.id, url: domains[5], title: 'Gmail Inbox', groupId: group3.id })
  addMockTab({ windowId: win1.id, url: domains[6], title: 'Calendar', groupId: group3.id, discarded: true })
  addMockTab({ windowId: win1.id, url: domains[7], title: 'Figma Mockup', groupId: group1.id })
  addMockTab({ windowId: win1.id, url: domains[8], title: 'Linear Issue', groupId: group1.id })
  addMockTab({ windowId: win1.id, url: domains[9], title: 'MDN Web API', groupId: group2.id, discarded: true })

  // Window 2: Research - 9 tabs, 2 groups
  const win2 = addMockWindow({ state: 'normal' })
  const group4 = addMockTabGroup({ windowId: win2.id, title: 'Reading', color: 'red', collapsed: false })
  const group5 = addMockTabGroup({ windowId: win2.id, title: 'References', color: 'purple', collapsed: true })

  addMockTab({ windowId: win2.id, url: domains[10], title: 'Hacker News', groupId: group4.id })
  addMockTab({ windowId: win2.id, url: domains[11], title: 'r/programming', groupId: group4.id, discarded: true })
  addMockTab({ windowId: win2.id, url: domains[12], title: 'Twitter', groupId: -1 })
  addMockTab({ windowId: win2.id, url: domains[13], title: 'YouTube Tutorial', groupId: group4.id })
  addMockTab({ windowId: win2.id, url: domains[14], title: 'Wikipedia: Tabs', groupId: group5.id, discarded: true })
  addMockTab({ windowId: win2.id, url: domains[15], title: 'Vercel Dashboard', pinned: true, groupId: -1 })
  addMockTab({ windowId: win2.id, url: domains[16], title: 'GCP Console', groupId: group5.id })
  addMockTab({ windowId: win2.id, url: domains[17], title: 'AWS Console', groupId: group5.id })
  addMockTab({ windowId: win2.id, url: domains[18], title: 'LeetCode', groupId: -1 })

  // Window 3: Dev - 8 tabs, 2 groups
  const win3 = addMockWindow({ state: 'normal' })
  const group6 = addMockTabGroup({ windowId: win3.id, title: 'Framework Docs', color: 'cyan', collapsed: false })
  const group7 = addMockTabGroup({ windowId: win3.id, title: 'Packages', color: 'pink', collapsed: false })

  addMockTab({ windowId: win3.id, url: domains[19], title: 'CodeSandbox', groupId: -1 })
  addMockTab({ windowId: win3.id, url: domains[20], title: 'Jira Board', pinned: true, groupId: -1 })
  addMockTab({ windowId: win3.id, url: domains[21], title: 'npm: vite', groupId: group7.id })
  addMockTab({ windowId: win3.id, url: domains[22], title: 'Vite Guide', groupId: group6.id })
  addMockTab({ windowId: win3.id, url: domains[23], title: 'React Docs', groupId: group6.id })
  addMockTab({ windowId: win3.id, url: domains[24], title: 'Tailwind Docs', groupId: group6.id, discarded: true })
  addMockTab({ windowId: win3.id, url: domains[25], title: 'Preact Guide', groupId: group6.id })
  addMockTab({ windowId: win3.id, url: 'https://bundlephobia.com/package/preact', title: 'Bundlephobia', groupId: group7.id })

  return {
    windows: [win1, win2, win3],
    groups: [group1, group2, group3, group4, group5, group6, group7],
    tabCount: 27,
    groupColors: GROUP_COLORS.slice(0, 7), // 7 of 8 colors used
  }
}

/**
 * Build a large session data object for scale tests.
 */
export function buildLargeSession(
  windowCount: number,
  tabsPerWindow: number,
  groupsPerWindow = 0
): Session {
  const now = Date.now()
  const windows: Window[] = []

  for (let w = 0; w < windowCount; w++) {
    const tabGroups: TabGroup[] = []
    for (let g = 0; g < groupsPerWindow; g++) {
      tabGroups.push({
        id: nanoid(),
        title: `Group ${g + 1}`,
        color: GROUP_COLORS[g % GROUP_COLORS.length],
        collapsed: g % 3 === 0,
      })
    }

    const tabs: Tab[] = []
    for (let t = 0; t < tabsPerWindow; t++) {
      tabs.push({
        id: nanoid(),
        url: `https://example.com/window${w}/tab${t}`,
        title: `Tab ${t + 1} in Window ${w + 1}`,
        index: t,
        pinned: t < 2,
        favIconUrl: `https://example.com/favicon${t}.ico`,
        groupId: groupsPerWindow > 0 ? tabGroups[t % groupsPerWindow].id : undefined,
        discarded: t % 5 === 0,
      })
    }

    windows.push({
      id: nanoid(),
      tabs,
      tabGroups,
      focused: w === 0,
      state: 'normal',
    })
  }

  return {
    id: nanoid(),
    name: `Scale Test ${windowCount}x${tabsPerWindow}`,
    createdAt: now,
    updatedAt: now,
    windows,
    source: 'manual',
  }
}

/**
 * Build a simple session with optional overrides.
 */
export function buildSession(id?: string, overrides?: Partial<Session>): Session {
  const now = Date.now()
  return {
    id: id ?? nanoid(),
    name: 'Test Session',
    createdAt: now,
    updatedAt: now,
    windows: [
      {
        id: nanoid(),
        tabs: [
          {
            id: nanoid(),
            url: 'https://example.com',
            title: 'Example',
            index: 0,
            pinned: false,
          },
        ],
        tabGroups: [],
      },
    ],
    source: 'manual',
    ...overrides,
  }
}

/**
 * Deep-compare two sessions by value (URL, title, pinned, index, group color/title/collapsed),
 * not by ID (since IDs are regenerated on import).
 */
export function assertSessionFidelity(original: Session, restored: Session): void {
  expect(restored.name).toBe(original.name)
  expect(restored.windows.length).toBe(original.windows.length)

  for (let w = 0; w < original.windows.length; w++) {
    const origWin = original.windows[w]
    const restWin = restored.windows[w]

    expect(restWin.tabs.length).toBe(origWin.tabs.length)
    expect(restWin.tabGroups.length).toBe(origWin.tabGroups.length)
    expect(restWin.focused).toBe(origWin.focused)
    expect(restWin.state).toBe(origWin.state)

    // Build group-id-to-properties maps for comparison (IDs differ)
    const origGroupMap = new Map(origWin.tabGroups.map((g) => [g.id, g]))
    const restGroupMap = new Map(restWin.tabGroups.map((g) => [g.id, g]))

    // Compare tab groups by value
    const origGroups = [...origGroupMap.values()].sort((a, b) => a.title.localeCompare(b.title))
    const restGroups = [...restGroupMap.values()].sort((a, b) => a.title.localeCompare(b.title))

    for (let g = 0; g < origGroups.length; g++) {
      expect(restGroups[g].title).toBe(origGroups[g].title)
      expect(restGroups[g].color).toBe(origGroups[g].color)
      expect(restGroups[g].collapsed).toBe(origGroups[g].collapsed)
    }

    // Compare tabs by index
    const origTabs = [...origWin.tabs].sort((a, b) => a.index - b.index)
    const restTabs = [...restWin.tabs].sort((a, b) => a.index - b.index)

    for (let t = 0; t < origTabs.length; t++) {
      expect(restTabs[t].url).toBe(origTabs[t].url)
      expect(restTabs[t].title).toBe(origTabs[t].title)
      expect(restTabs[t].index).toBe(origTabs[t].index)
      expect(restTabs[t].pinned).toBe(origTabs[t].pinned)

      // Check favicon if present
      if (origTabs[t].favIconUrl) {
        expect(restTabs[t].favIconUrl).toBe(origTabs[t].favIconUrl)
      }

      // Check group membership by group title (since IDs change)
      if (origTabs[t].groupId) {
        const origGroup = origGroupMap.get(origTabs[t].groupId!)
        const restGroup = restGroupMap.get(restTabs[t].groupId!)
        expect(restGroup).toBeDefined()
        expect(restGroup!.title).toBe(origGroup!.title)
        expect(restGroup!.color).toBe(origGroup!.color)
      } else {
        expect(restTabs[t].groupId).toBeUndefined()
      }
    }
  }
}
