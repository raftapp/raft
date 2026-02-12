/**
 * Pre-defined Test Scenarios for Dev Tools
 *
 * These scenarios create various test configurations
 * of windows, tabs, and tab groups.
 */

import type { DevScenario } from './types'

/**
 * Basic scenario: Single window with 5 tabs
 */
export const basicScenario: DevScenario = {
  id: 'basic',
  name: 'Basic',
  description: 'Single window with 5 tabs',
  windows: [
    {
      tabs: [
        { url: 'https://example.com', active: true },
        { url: 'https://httpbin.org/html' },
        { url: 'https://en.wikipedia.org/wiki/Otter' },
        { url: 'https://github.com' },
        { url: 'https://stackoverflow.com' },
      ],
    },
  ],
}

/**
 * Tab Groups scenario: Single window with 3 tab groups
 */
export const groupsScenario: DevScenario = {
  id: 'groups',
  name: 'Tab Groups',
  description: 'Single window with 3 colored tab groups',
  windows: [
    {
      groups: [
        {
          title: 'Work',
          color: 'blue',
          tabs: [
            { url: 'https://github.com', active: true },
            { url: 'https://gitlab.com' },
            { url: 'https://bitbucket.org' },
          ],
        },
        {
          title: 'Research',
          color: 'green',
          tabs: [
            { url: 'https://en.wikipedia.org/wiki/Main_Page' },
            { url: 'https://developer.mozilla.org/' },
            { url: 'https://stackoverflow.com' },
          ],
        },
        {
          title: 'News',
          color: 'orange',
          tabs: [
            { url: 'https://news.ycombinator.com' },
            { url: 'https://reddit.com/r/programming' },
          ],
        },
      ],
    },
  ],
}

/**
 * Multi-window scenario: 3 windows with 4 tabs each
 */
export const multiWindowScenario: DevScenario = {
  id: 'multi-window',
  name: 'Multi-Window',
  description: '3 windows with 4 tabs each',
  windows: [
    {
      focused: true,
      tabs: [
        { url: 'https://example.com', active: true },
        { url: 'https://httpbin.org/html' },
        { url: 'https://jsonplaceholder.typicode.com/' },
        { url: 'https://reqres.in/' },
      ],
    },
    {
      tabs: [
        { url: 'https://github.com', active: true },
        { url: 'https://gitlab.com' },
        { url: 'https://bitbucket.org' },
        { url: 'https://codepen.io' },
      ],
    },
    {
      tabs: [
        { url: 'https://en.wikipedia.org/wiki/Main_Page', active: true },
        { url: 'https://developer.mozilla.org/' },
        { url: 'https://web.dev/' },
        { url: 'https://css-tricks.com/' },
      ],
    },
  ],
}

/**
 * Complex scenario: 2 windows with groups, pinned tabs, collapsed groups
 */
export const complexScenario: DevScenario = {
  id: 'complex',
  name: 'Complex',
  description: '2 windows with groups, pinned tabs, and collapsed groups',
  windows: [
    {
      focused: true,
      tabs: [
        { url: 'https://mail.google.com', pinned: true },
        { url: 'https://calendar.google.com', pinned: true },
      ],
      groups: [
        {
          title: 'Project A',
          color: 'blue',
          tabs: [
            { url: 'https://github.com/facebook/react', active: true },
            { url: 'https://react.dev/' },
            { url: 'https://reactrouter.com/' },
          ],
        },
        {
          title: 'Reference',
          color: 'grey',
          collapsed: true,
          tabs: [
            { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript' },
            { url: 'https://www.typescriptlang.org/docs/' },
          ],
        },
      ],
    },
    {
      tabs: [{ url: 'https://slack.com', pinned: true }],
      groups: [
        {
          title: 'Project B',
          color: 'purple',
          tabs: [
            { url: 'https://vuejs.org/', active: true },
            { url: 'https://router.vuejs.org/' },
            { url: 'https://pinia.vuejs.org/' },
          ],
        },
        {
          title: 'Docs',
          color: 'cyan',
          collapsed: true,
          tabs: [{ url: 'https://vitejs.dev/' }, { url: 'https://vitest.dev/' }],
        },
      ],
    },
  ],
}

/**
 * Stress test scenario: 5 windows with 10 tabs each (50 tabs total)
 */
export const stressTestScenario: DevScenario = {
  id: 'stress',
  name: 'Stress Test',
  description: '5 windows with 10 tabs each (50 tabs total)',
  windows: Array.from({ length: 5 }, (_, windowIndex) => ({
    focused: windowIndex === 0,
    tabs: Array.from({ length: 10 }, (_, tabIndex) => ({
      url: getStressTestUrl(windowIndex, tabIndex),
      active: tabIndex === 0,
    })),
  })),
}

/**
 * Get a URL for stress testing based on window and tab index
 */
function getStressTestUrl(windowIndex: number, tabIndex: number): string {
  const urls = [
    'https://example.com',
    'https://httpbin.org/html',
    'https://jsonplaceholder.typicode.com/',
    'https://en.wikipedia.org/wiki/Main_Page',
    'https://github.com',
    'https://stackoverflow.com',
    'https://developer.mozilla.org/',
    'https://news.ycombinator.com',
    'https://reddit.com',
    'https://codepen.io',
    'https://css-tricks.com/',
    'https://web.dev/',
    'https://smashingmagazine.com',
    'https://dev.to',
    'https://medium.com',
  ]
  const index = (windowIndex * 10 + tabIndex) % urls.length
  // Add query param to make each URL unique
  return `${urls[index]}?test=w${windowIndex}t${tabIndex}`
}

/**
 * All available scenarios
 */
export const allScenarios: DevScenario[] = [
  basicScenario,
  groupsScenario,
  multiWindowScenario,
  complexScenario,
  stressTestScenario,
]
