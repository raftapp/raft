/**
 * Type definitions for cloud sync
 */

import type { Session } from '../types'

/**
 * Cloud provider type
 */
export type CloudProvider = 'gdrive'

/**
 * OAuth tokens stored in chrome.storage
 */
export interface CloudTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // timestamp
  scope: string
}

/**
 * Cloud sync credentials (encrypted tokens + provider info)
 */
export interface CloudCredentials {
  provider: CloudProvider
  /** Encrypted OAuth tokens (encrypted with user's encryption key) */
  encryptedTokens: string
  /** User's email from OAuth (for display purposes) */
  email?: string
  /** When the connection was established */
  connectedAt: number
}

/**
 * Encryption key material (stored encrypted in chrome.storage)
 */
export interface EncryptionKeyData {
  /** PBKDF2 salt (base64) */
  salt: string
  /** Verification hash to check password correctness */
  verificationHash: string
  /** Tokens encrypted with recovery-derived key (JSON-stringified EncryptedPayload) */
  recoveryPayload?: string
}

/**
 * Encrypted payload format
 */
export interface EncryptedPayload {
  /** Version for future format changes */
  v: 1
  /** Initialization vector (base64) */
  iv: string
  /** Ciphertext (base64) */
  ct: string
  /** Auth tag (included in ct for AES-GCM) */
}

/**
 * Sync manifest stored in cloud
 * Contains metadata about all synced sessions without their content
 */
export interface SyncManifest {
  /** Manifest version */
  version: 1
  /** Last sync timestamp */
  lastSync: number
  /** Device ID that performed last sync */
  deviceId: string
  /** Session metadata */
  sessions: SyncSessionMeta[]
  /** Tombstones for deleted sessions (kept for 30 days) */
  tombstones: SyncTombstone[]
}

/**
 * Session metadata in the manifest
 */
export interface SyncSessionMeta {
  /** Session ID */
  id: string
  /** Session name (for display without decryption) */
  name: string
  /** Last modified timestamp */
  updatedAt: number
  /** Number of tabs (for display) */
  tabCount: number
  /** Checksum of encrypted content (to detect changes) */
  checksum: string
}

/**
 * Tombstone for deleted session
 */
export interface SyncTombstone {
  /** Session ID that was deleted */
  id: string
  /** When it was deleted */
  deletedAt: number
}

/**
 * Item in the sync queue
 */
export interface SyncQueueItem {
  /** Unique ID for this queue item */
  id: string
  /** Type of operation */
  type: 'upload' | 'delete'
  /** Session ID being synced */
  sessionId: string
  /** When the item was queued */
  queuedAt: number
  /** Number of retry attempts */
  retryCount: number
  /** Next retry time (for backoff) */
  nextRetryAt: number
  /** Last error message if any */
  lastError?: string
}

/**
 * Current sync state
 */
export interface SyncState {
  /** Whether sync is currently in progress */
  syncing: boolean
  /** Last successful sync timestamp */
  lastSyncAt?: number
  /** Last sync error */
  lastError?: string
  /** Number of pending operations */
  pendingCount: number
  /** Current operation description */
  currentOperation?: string
}

/**
 * Sync settings stored in user preferences
 */
export interface CloudSyncSettings {
  /** Whether cloud sync is enabled */
  enabled: boolean
  /** Sync interval in minutes */
  intervalMinutes: number
  /** Sync on session save */
  syncOnSave: boolean
}

/**
 * Default cloud sync settings
 */
export const DEFAULT_CLOUD_SYNC_SETTINGS: CloudSyncSettings = {
  enabled: false,
  intervalMinutes: 15,
  syncOnSave: true,
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean
  uploaded: number
  downloaded: number
  deleted: number
  errors: string[]
}

/**
 * Session data as stored in cloud (encrypted)
 */
export interface CloudSessionData {
  /** The full session object */
  session: Session
  /** Device ID that last updated */
  deviceId: string
  /** Timestamp of this version */
  timestamp: number
}
