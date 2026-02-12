/**
 * Dev Tools Types for Raft
 *
 * Used for creating test scenarios during development.
 * These types are only used in dev mode.
 */

/** Tab group colors supported by Chrome */
export type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange'

export interface DevTab {
  url: string
  pinned?: boolean
  active?: boolean
}

export interface DevTabGroup {
  title: string
  color: TabGroupColor
  collapsed?: boolean
  tabs: DevTab[]
}

export interface DevWindow {
  tabs?: DevTab[]
  groups?: DevTabGroup[]
  focused?: boolean
}

export interface DevScenario {
  id: string
  name: string
  description: string
  windows: DevWindow[]
}
