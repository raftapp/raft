/**
 * Shared constants for Raft
 */

/** Storage keys for chrome.storage.local */
export const STORAGE_KEYS = {
  /** User settings */
  SETTINGS: 'raft:settings',
  /** Saved sessions */
  SESSIONS: 'raft:sessions',
  /** Session folders */
  FOLDERS: 'raft:folders',
  /** Tab activity tracking (for suspension timing) */
  TAB_ACTIVITY: 'raft:tabActivity',
  /** Last auto-save timestamp */
  LAST_AUTO_SAVE: 'raft:lastAutoSave',
  /** Previous active tab per window (for activity-on-leave tracking) */
  PREVIOUS_ACTIVE_TABS: 'raft:previousActiveTabs',
  /** Last sync backup status */
  LAST_BACKUP_STATUS: 'raft:lastBackupStatus',
  /** Recovery snapshots for crash recovery */
  RECOVERY_SNAPSHOTS: 'raft:recoverySnapshots',
  /** Export reminder state (pending notification info) */
  EXPORT_REMINDER_STATE: 'raft:exportReminderState',
  /** Last cloud sync trigger error */
  LAST_SYNC_ERROR: 'raft:lastSyncError',
} as const

/** Storage keys for chrome.storage.sync (backup) */
export const SYNC_STORAGE_KEYS = {
  /** Manifest of synced sessions */
  MANIFEST: 'raft:sync:manifest',
  /** Prefix for individual session backups */
  SESSION_PREFIX: 'raft:sync:s:',
  /** Recovery snapshot (single, most recent) */
  RECOVERY_SNAPSHOT: 'raft:sync:recovery',
} as const

/** Chrome storage.sync limits */
export const SYNC_LIMITS = {
  /** Total quota in bytes (~100KB) */
  QUOTA_BYTES: 102400,
  /** Max bytes per item (~8KB) */
  QUOTA_BYTES_PER_ITEM: 8192,
  /** Max number of items */
  MAX_ITEMS: 512,
  /** Safety margin (90% of quota) */
  QUOTA_SAFETY_MARGIN: 0.9,
} as const

/** Alarm names for chrome.alarms */
export const ALARM_NAMES = {
  /** Periodic check for tabs to suspend */
  SUSPENSION_CHECK: 'raft:suspensionCheck',
  /** Periodic auto-save */
  AUTO_SAVE: 'raft:autoSave',
  /** Periodic cloud sync */
  CLOUD_SYNC: 'raft:cloudSync',
  /** Periodic recovery snapshot */
  RECOVERY_SNAPSHOT: 'raft:recoverySnapshot',
  /** Daily check for export reminder */
  EXPORT_REMINDER: 'raft:exportReminder',
} as const

/** Extension version for migrations */
export const EXTENSION_VERSION = __EXTENSION_VERSION__

/** Minimum Chrome version required */
export const MIN_CHROME_VERSION = 88

/** Suspension check interval in minutes */
export const SUSPENSION_CHECK_INTERVAL_MINUTES = 1

/** URLs that should never be suspended */
export const PROTECTED_URL_PATTERNS = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'file://',
  'javascript:',
  'data:',
]

/** Maximum sessions that can be stored */
export const MAX_SESSIONS = 1000

/** Maximum tabs per session */
export const MAX_TABS_PER_SESSION = 5000

/** Cloud sync storage keys */
export const CLOUD_SYNC_KEYS = {
  /** Cloud credentials (encrypted tokens) */
  CREDENTIALS: 'raft:cloud:credentials',
  /** Encryption key data (salt, verification hash) */
  ENCRYPTION_KEY: 'raft:cloud:encryptionKey',
  /** Sync queue (pending operations) */
  SYNC_QUEUE: 'raft:cloud:syncQueue',
  /** Sync state (last sync time, errors) */
  SYNC_STATE: 'raft:cloud:syncState',
  /** Cloud sync settings */
  SYNC_SETTINGS: 'raft:cloud:settings',
  /** Device ID for this browser */
  DEVICE_ID: 'raft:cloud:deviceId',
  /** Cached encryption key (cleared on lock) */
  CACHED_KEY: 'raft:cloud:cachedKey',
  /** Cached IDs of sessions synced to cloud */
  SYNCED_IDS: 'raft:cloud:syncedIds',
} as const

/** Google OAuth configuration */
export const GOOGLE_OAUTH = {
  CLIENT_ID: __GOOGLE_OAUTH_CLIENT_ID__,
  CLIENT_SECRET: __GOOGLE_OAUTH_CLIENT_SECRET__,
  SCOPES: ['https://www.googleapis.com/auth/drive.appdata', 'email'],
  TOKEN_URL: 'https://oauth2.googleapis.com/token',
  AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  REVOKE_URL: 'https://oauth2.googleapis.com/revoke',
} as const

/** Google Drive API configuration */
export const GDRIVE_API = {
  /** Base URL for Drive API v3 */
  BASE_URL: 'https://www.googleapis.com/drive/v3',
  /** Upload URL for Drive API */
  UPLOAD_URL: 'https://www.googleapis.com/upload/drive/v3',
  /** App data folder ID */
  APP_DATA_FOLDER: 'appDataFolder',
  /** Manifest file name */
  MANIFEST_FILE: 'manifest.enc',
  /** Key data file name (salt + verification hash for reconnect detection) */
  KEYDATA_FILE: 'keydata.json',
  /** Sessions folder name */
  SESSIONS_FOLDER: 'sessions',
} as const

/** Cloud sync alarm name */
export const CLOUD_SYNC_ALARM = 'raft:cloudSync'

/** Tombstone retention period (30 days in milliseconds) */
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/** Sync retry configuration */
export const SYNC_RETRY = {
  /** Initial retry delay in ms */
  INITIAL_DELAY_MS: 1000,
  /** Maximum retry delay in ms (5 minutes) */
  MAX_DELAY_MS: 5 * 60 * 1000,
  /** Maximum retry attempts before giving up */
  MAX_RETRIES: 10,
  /** Backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
} as const

/** Pro tier pricing */
export const PRO_PRICING = {
  /** One-time price in USD */
  PRICE_USD: 25,
} as const

/** Lemon Squeezy configuration */
export const LEMONSQUEEZY = {
  /** Store ID (from Lemon Squeezy dashboard) */
  STORE_ID: '289757',
  /** Product variant ID for Pro tier */
  VARIANT_ID: '1294487',
  /** Checkout URL (replace with your actual checkout link) */
  CHECKOUT_URL:
    'https://raftapp.lemonsqueezy.com/checkout/buy/da856db1-d6fe-4347-a8e1-07c42bde0ae3',
  /** License validation endpoint */
  VALIDATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/validate',
  /** License activation endpoint */
  ACTIVATE_URL: 'https://api.lemonsqueezy.com/v1/licenses/activate',
} as const

/** License storage key */
export const LICENSE_STORAGE_KEY = 'raft:pro:license'

/** Dev tools storage key for tracking test windows */
export const DEV_TEST_WINDOWS_KEY = 'raft:dev:testWindows'

/** Dev tools storage key for Pro override toggle */
export const DEV_PRO_OVERRIDE_KEY = 'raft:dev:proOverride'

/** Recovery snapshot configuration */
export const RECOVERY_CONFIG = {
  /** Maximum number of snapshots to keep */
  MAX_SNAPSHOTS: 5,
  /** Interval between periodic snapshots (minutes) */
  INTERVAL_MINUTES: 5,
  /** Minimum time between snapshots (milliseconds) */
  DEBOUNCE_MS: 30000,
} as const

/** Sync storage chunking configuration for recovery snapshots */
export const SYNC_CHUNK_CONFIG = {
  /** Maximum bytes per chunk (with headroom below 8192 limit) */
  CHUNK_SIZE: 8000,
  /** Prefix for recovery snapshot chunks */
  CHUNK_PREFIX: 'raft_recovery_',
  /** Key for storing chunk count metadata */
  CHUNK_COUNT_KEY: 'raft_recovery_meta',
  /** Maximum number of chunks to use (~20 chunks × 8KB = ~160KB budget) */
  MAX_CHUNKS: 20,
} as const

/** Backup health indicator thresholds */
export const BACKUP_HEALTH_CONFIG = {
  /** Hours since last backup before "attention" level */
  STALE_ATTENTION_HOURS: 4,
  /** Hours since last backup before "warning" level */
  STALE_WARNING_HOURS: 24,
  /** Browser sync usage percent for "attention" */
  SYNC_ATTENTION_PERCENT: 80,
  /** Browser sync usage percent for "warning" */
  SYNC_WARNING_PERCENT: 95,
  /** Suggest cloud sync when session count exceeds this */
  SUGGEST_CLOUD_SESSION_COUNT: 10,
  /** Suggest export when session count exceeds this and never exported */
  SUGGEST_EXPORT_SESSION_COUNT: 20,
  /** Suggest export if last export was this many days ago */
  SUGGEST_EXPORT_DAYS: 60,
} as const

/** Export reminder configuration */
export const EXPORT_REMINDER_CONFIG = {
  /** Default reminder interval in days */
  DEFAULT_INTERVAL_DAYS: 30,
  /** Session count milestones to trigger reminders */
  MILESTONES: [50, 100, 200, 500, 1000],
} as const
