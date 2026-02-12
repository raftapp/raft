/**
 * Core data models for Raft
 *
 * These interfaces are the foundation of the extension.
 * Session and Tab structures are designed to be:
 * - Serializable to chrome.storage
 * - Compatible with import/export formats
 * - Extensible for future features
 */

// Re-export chrome.tabGroups.Color for convenience
export type TabGroupColor = chrome.tabGroups.Color

/**
 * Represents a single browser tab
 */
export interface Tab {
  /** Unique identifier for this tab within a session */
  id: string
  /** The URL of the tab */
  url: string
  /** The title of the tab */
  title: string
  /** URL to the tab's favicon */
  favIconUrl?: string
  /** Position in the tab strip */
  index: number
  /** ID of the tab group this tab belongs to */
  groupId?: string
  /** Whether the tab is pinned */
  pinned: boolean
  /** Whether the tab was discarded (suspended) */
  discarded?: boolean
  /** Last time this tab was active (timestamp) */
  lastAccessed?: number
}

/**
 * Represents a Chrome tab group
 */
export interface TabGroup {
  /** Unique identifier for this group */
  id: string
  /** Display title of the group */
  title: string
  /** Color of the group in Chrome's UI */
  color: TabGroupColor
  /** Whether the group is collapsed */
  collapsed: boolean
}

/**
 * Represents a browser window containing tabs
 */
export interface Window {
  /** Unique identifier for this window */
  id: string
  /** Tabs in this window */
  tabs: Tab[]
  /** Tab groups in this window */
  tabGroups: TabGroup[]
  /** Whether this was the focused window */
  focused?: boolean
  /** Window state (normal, minimized, maximized, fullscreen) */
  state?: chrome.windows.WindowState
}

/**
 * Represents a saved browsing session
 */
export interface Session {
  /** Unique identifier for this session */
  id: string
  /** User-provided name for the session */
  name: string
  /** Timestamp when the session was created */
  createdAt: number
  /** Timestamp when the session was last modified */
  updatedAt: number
  /** Windows in this session */
  windows: Window[]
  /** User-assigned tags for organization */
  tags?: string[]
  /** ID of the folder this session belongs to */
  folderId?: string
  /** Source of the session (manual save, auto-save, import) */
  source?: SessionSource
  /** Timestamp when the session was last synced to cloud */
  lastSyncedAt?: number
}

/**
 * How a session was created
 */
export type SessionSource = 'manual' | 'auto' | 'import' | 'backup'

/**
 * A folder for organizing sessions
 */
export interface Folder {
  /** Unique identifier for this folder */
  id: string
  /** Display name of the folder */
  name: string
  /** ID of the parent folder (for nested folders) */
  parentId?: string
  /** Timestamp when the folder was created */
  createdAt: number
}

/**
 * User settings for the extension
 */
export interface Settings {
  /** Auto-suspend settings */
  suspension: {
    /** Whether auto-suspension is enabled */
    enabled: boolean
    /** Minutes of inactivity before suspending */
    inactivityMinutes: number
    /** Never suspend pinned tabs */
    neverSuspendPinned: boolean
    /** Never suspend tabs playing audio */
    neverSuspendAudio: boolean
    /** Never suspend tabs with unsaved form data */
    neverSuspendForms: boolean
    /** URL patterns to whitelist (never suspend) */
    whitelist: string[]
  }
  /** Auto-save settings */
  autoSave: {
    /** Whether auto-save is enabled */
    enabled: boolean
    /** Minutes between auto-saves */
    intervalMinutes: number
    /** Maximum number of auto-save slots */
    maxSlots: number
  }
  /** UI preferences */
  ui: {
    /** Theme preference */
    theme: 'light' | 'dark' | 'system'
    /** Show tab count in badge */
    showBadge: boolean
  }
  /** Backup reminder settings */
  exportReminder: {
    /** Whether export reminders are enabled */
    enabled: boolean
    /** Days between reminders */
    intervalDays: number
    /** Timestamp of last export */
    lastExportDate?: number
    /** Last session count milestone that triggered a reminder */
    lastMilestoneReached?: number
  }
}

/**
 * Default settings for new installations
 */
export const DEFAULT_SETTINGS: Settings = {
  suspension: {
    enabled: true,
    inactivityMinutes: 30,
    neverSuspendPinned: true,
    neverSuspendAudio: true,
    neverSuspendForms: true,
    whitelist: [],
  },
  autoSave: {
    enabled: false,
    intervalMinutes: 60,
    maxSlots: 5,
  },
  ui: {
    theme: 'system',
    showBadge: true,
  },
  exportReminder: {
    enabled: true, // Default to enabled for free users' protection
    intervalDays: 30,
  },
}

/**
 * Selection for partial session restore.
 * Maps window IDs to arrays of tab IDs to restore.
 */
export interface PartialRestoreSelection {
  /** Map of window ID -> tab IDs to restore */
  windows: Record<string, string[]>
}

/**
 * Standard message response type for background script communication
 */
export type MessageResponse = { success: true; data?: unknown } | { success: false; error: string }

/**
 * Recovery snapshot - lightweight backup for crash recovery
 * Captures ALL tabs (not just discarded) to provide a safety net
 */
export interface RecoverySnapshot {
  /** Unique identifier, e.g., "recovery:1706803200000" */
  id: string
  /** When snapshot was taken */
  timestamp: number
  /** Windows captured in this snapshot */
  windows: Window[]
  /** Summary statistics */
  stats: {
    windowCount: number
    tabCount: number
    groupCount: number
  }
}
