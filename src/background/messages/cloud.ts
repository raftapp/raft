import { browser } from '@/shared/browser'
import { sessionsStorage } from '@/shared/storage'
import { ALARM_NAMES, CLOUD_SYNC_KEYS } from '@/shared/constants'
import { restoreFromSync, getSyncStatus, clearSyncData } from '@/shared/syncBackup'
import {
  syncEngine,
  gdrive,
  cloudSyncSettingsStorage,
  cloudCredentialsStorage,
  encryptionKeyStorage,
  syncStateStorage,
  clearAllCloudSyncData,
  launchGoogleOAuth,
  setupEncryption,
  encryptObject,
  decryptObject,
  revokeAccess,
  deriveKey,
  deriveKeyFromRecovery,
  generateRecoveryKey,
  generateSalt,
  createVerificationHash,
} from '@/shared/cloudSync'
import type { CloudTokens, EncryptedPayload } from '@/shared/cloudSync'
import { canUseCloudSync } from '@/shared/licensing'
import { setupCloudSyncAlarm } from '../alarms'
import type { MessageResponse, MessageType } from './types'

// The browser-sync messages share little with cloud sync mechanically (one
// uses chrome.storage.sync, the other Google Drive), but they're both
// "remote backup" message groups, so they live together.
type CloudMessage = Extract<
  MessageType,
  {
    type:
      | 'CLOUD_CONNECT'
      | 'CLOUD_DISCONNECT'
      | 'CLOUD_RECONNECT'
      | 'CLOUD_SETUP_ENCRYPTION'
      | 'CLOUD_UNLOCK'
      | 'CLOUD_REGENERATE_RECOVERY_KEY'
      | 'CLOUD_RECOVER_WITH_KEY'
      | 'CLOUD_LOCK'
      | 'CLOUD_SYNC'
      | 'CLOUD_GET_STATUS'
      | 'CLOUD_GET_SETTINGS'
      | 'CLOUD_UPDATE_SETTINGS'
      | 'CLOUD_GET_SYNCED_IDS'
      | 'GET_SYNC_STATUS'
      | 'RESTORE_FROM_SYNC'
      | 'CLEAR_SYNC_DATA'
  }
>

export async function handleCloudMessage(message: CloudMessage): Promise<MessageResponse> {
  switch (message.type) {
    case 'CLOUD_CONNECT': {
      // Check Pro status first
      if (!(await canUseCloudSync())) {
        return { success: false, error: 'Cloud sync requires Pro. Please upgrade.' }
      }

      // Launch OAuth flow and get tokens
      const result = await launchGoogleOAuth()

      // Tier 1: Check if encryption key data exists locally
      const existingKeyData = await encryptionKeyStorage.get()
      if (existingKeyData) {
        return {
          success: true,
          data: {
            needsUnlock: true,
            email: result.email,
            tokens: result.tokens,
          },
        }
      }

      // Tier 2: No local data — check Drive for key data from a previous install
      try {
        const driveKeyData = await gdrive.downloadKeyData(result.tokens.accessToken)
        if (driveKeyData) {
          // Restore key data locally so unlock flow works
          await encryptionKeyStorage.save({
            salt: driveKeyData.salt,
            verificationHash: driveKeyData.verificationHash,
          })
          return {
            success: true,
            data: {
              needsUnlock: true,
              email: result.email,
              tokens: result.tokens,
            },
          }
        }
      } catch (err) {
        // Drive failure is non-fatal — fall through to new setup
        console.warn('[Raft] Failed to check Drive for existing key data:', err)
      }

      // Tier 3: No data anywhere — truly new user
      return {
        success: true,
        data: {
          needsEncryptionSetup: true,
          email: result.email,
          tokens: result.tokens,
        },
      }
    }

    case 'CLOUD_SETUP_ENCRYPTION': {
      // Set up encryption with user's password
      const { keyData, recoveryKey, key } = await setupEncryption(message.password)

      // Get tokens from message parameter (passed directly from UI, never stored in plaintext)
      const pendingTokens = message.tokens
      const pendingEmail = message.email
      if (!pendingTokens || !pendingEmail) {
        return { success: false, error: 'No pending connection. Please reconnect.' }
      }

      // Encrypt and save tokens
      const encryptedTokens = await encryptObject(pendingTokens, key)
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: JSON.stringify(encryptedTokens),
        email: pendingEmail,
        connectedAt: Date.now(),
      })

      // Also encrypt tokens with recovery key for actual recovery support
      const recoveryDerivedKey = await deriveKeyFromRecovery(recoveryKey, keyData.salt)
      const recoveryEncrypted = await encryptObject(pendingTokens, recoveryDerivedKey)
      keyData.recoveryPayload = JSON.stringify(recoveryEncrypted)

      // Save key data (includes recovery payload)
      await encryptionKeyStorage.save(keyData)

      // Upload key data to Drive for future reinstall detection (non-fatal)
      try {
        await gdrive.uploadKeyData(pendingTokens.accessToken, {
          salt: keyData.salt,
          verificationHash: keyData.verificationHash,
        })
      } catch (err) {
        console.warn('[Raft] Failed to upload key data to Drive:', err)
      }

      // Enable cloud sync
      await cloudSyncSettingsStorage.update({ enabled: true })

      // Set up sync alarm
      const syncSettings = await cloudSyncSettingsStorage.get()
      await setupCloudSyncAlarm(syncSettings.intervalMinutes)

      return {
        success: true,
        data: { recoveryKey },
      }
    }

    case 'CLOUD_UNLOCK': {
      const unlocked = await syncEngine.unlock(message.password)
      if (!unlocked) {
        return { success: false, error: 'Incorrect password' }
      }

      // If tokens were passed (from a new connect flow), encrypt and save them
      if (message.tokens && message.email) {
        const unlockKey = syncEngine.getEncryptionKeyForSetup()
        if (unlockKey) {
          const encryptedTokens = await encryptObject(message.tokens, unlockKey)
          await cloudCredentialsStorage.save({
            provider: 'gdrive',
            encryptedTokens: JSON.stringify(encryptedTokens),
            email: message.email,
            connectedAt: Date.now(),
          })

          // Enable cloud sync
          await cloudSyncSettingsStorage.update({ enabled: true })
          const syncSettings = await cloudSyncSettingsStorage.get()
          await setupCloudSyncAlarm(syncSettings.intervalMinutes)
        }
      }

      // Process any pending queue items
      await syncEngine.processQueue()

      return { success: true }
    }

    case 'CLOUD_LOCK': {
      syncEngine.lock()
      return { success: true }
    }

    case 'CLOUD_REGENERATE_RECOVERY_KEY': {
      const keyData = await encryptionKeyStorage.get()
      if (!keyData) {
        return { success: false, error: 'Encryption not set up' }
      }

      // Verify password
      const key = await deriveKey(message.password, keyData.salt)
      const hash = await createVerificationHash(key, keyData.salt)
      if (hash !== keyData.verificationHash) {
        return { success: false, error: 'Incorrect password' }
      }

      // Decrypt tokens with password key
      const credentials = await cloudCredentialsStorage.get()
      if (!credentials) {
        return { success: false, error: 'No cloud credentials found' }
      }
      const payload = JSON.parse(credentials.encryptedTokens)
      const tokens = await decryptObject(payload, key)

      // Generate new recovery key and encrypt tokens with it
      const newRecoveryKey = generateRecoveryKey()
      const recoveryDerivedKey = await deriveKeyFromRecovery(newRecoveryKey, keyData.salt)
      const recoveryEncrypted = await encryptObject(tokens, recoveryDerivedKey)

      // Save updated key data with new recovery payload
      await encryptionKeyStorage.save({
        ...keyData,
        recoveryPayload: JSON.stringify(recoveryEncrypted),
      })

      return { success: true, data: { recoveryKey: newRecoveryKey } }
    }

    case 'CLOUD_RECOVER_WITH_KEY': {
      // Recovery flow: verify identity via recovery key, set new password, wipe & re-sync
      const keyData = await encryptionKeyStorage.get()
      if (!keyData || !keyData.recoveryPayload) {
        return { success: false, error: 'No recovery data available' }
      }

      // Step 1: Validate recovery key by decrypting the recovery payload
      let tokens: CloudTokens
      try {
        const recoveryDerivedKey = await deriveKeyFromRecovery(message.recoveryKey, keyData.salt)
        const recoveryPayload = JSON.parse(keyData.recoveryPayload) as EncryptedPayload
        tokens = await decryptObject<CloudTokens>(recoveryPayload, recoveryDerivedKey)
      } catch {
        return { success: false, error: 'Invalid recovery key' }
      }

      // Step 2: Derive new encryption key from new password with a fresh salt
      const newSalt = generateSalt()
      const newKey = await deriveKey(message.newPassword, newSalt)
      const newVerificationHash = await createVerificationHash(newKey, newSalt)

      // Step 3: Encrypt tokens with the new key
      const newEncryptedTokens = await encryptObject(tokens, newKey)

      // Step 4: Generate new recovery key + recovery payload
      const newRecoveryKey = generateRecoveryKey()
      const newRecoveryDerivedKey = await deriveKeyFromRecovery(newRecoveryKey, newSalt)
      const newRecoveryEncrypted = await encryptObject(tokens, newRecoveryDerivedKey)

      // Step 5: Save updated encryption key data
      await encryptionKeyStorage.save({
        salt: newSalt,
        verificationHash: newVerificationHash,
        recoveryPayload: JSON.stringify(newRecoveryEncrypted),
      })

      // Step 6: Save re-encrypted credentials
      const credentials = await cloudCredentialsStorage.get()
      if (credentials) {
        await cloudCredentialsStorage.save({
          ...credentials,
          encryptedTokens: JSON.stringify(newEncryptedTokens),
        })
      }

      // Step 7: Unlock sync engine with new key
      syncEngine.setEncryptionKey(newKey)

      // Step 8: Wipe old encrypted data from Drive & upload new key metadata
      try {
        await gdrive.clearAllData(tokens.accessToken)
        await gdrive.uploadKeyData(tokens.accessToken, {
          salt: newSalt,
          verificationHash: newVerificationHash,
        })
      } catch (err) {
        console.warn('[Raft] Recovery: failed to reset Drive data:', err)
      }

      // Step 9: Re-upload all local sessions with new encryption (fire-and-forget)
      syncEngine.performFullSync().catch((err: unknown) => {
        console.error('[Raft] Recovery: post-recovery sync failed:', err)
      })

      return { success: true, data: { recoveryKey: newRecoveryKey } }
    }

    case 'CLOUD_DISCONNECT': {
      // If unlocked, we can revoke tokens and optionally delete cloud data
      if (syncEngine.isUnlocked()) {
        try {
          const tokens = await syncEngine.getValidTokensForDisconnect()
          if (tokens) {
            // Delete cloud data if requested
            if (message.deleteCloudData) {
              await gdrive.clearAllData(tokens.accessToken)
            }
            // Revoke OAuth access (best-effort)
            try {
              await revokeAccess(tokens.accessToken)
            } catch {
              // User might have already revoked in Google settings
            }
          }
        } catch {
          // Don't block disconnect on cleanup errors
        }
      }

      // Clear all local cloud sync data
      await clearAllCloudSyncData()

      // Cancel sync alarm
      await browser.alarms.clear(ALARM_NAMES.CLOUD_SYNC)

      return { success: true }
    }

    case 'CLOUD_RECONNECT': {
      if (!(await syncEngine.isConfigured())) {
        return { success: false, error: 'Cloud sync not configured' }
      }
      if (!syncEngine.isUnlocked()) {
        return { success: false, error: 'Cloud sync is locked' }
      }

      // Launch fresh OAuth flow
      const reconnectResult = await launchGoogleOAuth()

      // Encrypt new tokens with existing encryption key
      const reconnectKey = syncEngine.getEncryptionKeyForSetup()
      if (!reconnectKey) {
        return { success: false, error: 'Encryption key not available' }
      }

      const reconnectEncrypted = await encryptObject(reconnectResult.tokens, reconnectKey)

      // Save new credentials, preserving existing connectedAt
      const existingCreds = await cloudCredentialsStorage.get()
      await cloudCredentialsStorage.save({
        provider: 'gdrive',
        encryptedTokens: JSON.stringify(reconnectEncrypted),
        email: reconnectResult.email,
        connectedAt: existingCreds?.connectedAt ?? Date.now(),
      })

      // Clear cached tokens so sync engine picks up new ones
      syncEngine.clearCachedTokens()

      // Clear auth error state
      await syncStateStorage.update({ authExpired: false, lastError: undefined })

      return { success: true, data: { email: reconnectResult.email } }
    }

    case 'CLOUD_SYNC': {
      if (!(await syncEngine.isConfigured())) {
        return { success: false, error: 'Cloud sync not configured' }
      }
      if (!syncEngine.isUnlocked()) {
        return { success: false, error: 'Cloud sync is locked' }
      }

      const result = await syncEngine.performFullSync()
      if (result.success) {
        return { success: true, data: result }
      } else {
        return { success: false, error: result.errors[0] || 'Sync failed' }
      }
    }

    case 'CLOUD_GET_STATUS': {
      const status = await syncEngine.getSyncStatus()
      return { success: true, data: status }
    }

    case 'CLOUD_GET_SETTINGS': {
      const settings = await cloudSyncSettingsStorage.get()
      return { success: true, data: settings }
    }

    case 'CLOUD_UPDATE_SETTINGS': {
      const settings = await cloudSyncSettingsStorage.update(message.settings)

      // Update sync alarm if interval changed
      if (settings.enabled) {
        await setupCloudSyncAlarm(settings.intervalMinutes)
      } else {
        await browser.alarms.clear(ALARM_NAMES.CLOUD_SYNC)
      }

      return { success: true, data: settings }
    }

    case 'CLOUD_GET_SYNCED_IDS': {
      const result = await browser.storage.local.get(CLOUD_SYNC_KEYS.SYNCED_IDS)
      const ids = (result[CLOUD_SYNC_KEYS.SYNCED_IDS] as string[] | undefined) ?? []
      return { success: true, data: ids }
    }

    case 'GET_SYNC_STATUS': {
      const status = await getSyncStatus()
      return { success: true, data: status }
    }

    case 'RESTORE_FROM_SYNC': {
      const restoredSessions = await restoreFromSync()
      for (const session of restoredSessions) {
        await sessionsStorage.save(session)
      }
      return { success: true, data: { count: restoredSessions.length } }
    }

    case 'CLEAR_SYNC_DATA': {
      await clearSyncData()
      return { success: true }
    }
  }
}
