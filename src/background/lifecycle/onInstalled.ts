import { browser } from '@/shared/browser'
import { sessionsStorage } from '@/shared/storage'
import { shouldRestoreFromSync, restoreFromSync, backupSession } from '@/shared/syncBackup'
import { recoverySnapshotSync, recoverySnapshotsStorage } from '../recovery'

/**
 * Handle extension install/update lifecycle events.
 */
export async function handleInstalled(details: chrome.runtime.InstalledDetails): Promise<void> {
  console.log('[Raft] Extension installed/updated:', details.reason)

  if (details.reason === 'install') {
    // Check if we should restore sessions from sync (cross-device scenario)
    // Note: This works when installing on a new device with the same Chrome profile.
    // Sync storage does NOT survive uninstall, so this won't restore after reinstall.
    const localSessions = await sessionsStorage.getAll()
    if (await shouldRestoreFromSync(localSessions.length)) {
      console.log('[Raft] Found sync backup from another device, restoring sessions...')
      const restoredSessions = await restoreFromSync()

      for (const session of restoredSessions) {
        await sessionsStorage.save(session)
      }

      console.log(`[Raft] Restored ${restoredSessions.length} sessions from sync backup`)
    }

    // Check if we should restore recovery snapshot from sync (cross-device scenario)
    const localSnapshots = await recoverySnapshotsStorage.getAll()
    if (localSnapshots.length === 0) {
      const syncedSnapshot = await recoverySnapshotSync.get()
      if (syncedSnapshot) {
        await recoverySnapshotsStorage.save(syncedSnapshot)
        console.log(
          `[Raft] Restored recovery snapshot from sync (${syncedSnapshot.stats.tabCount} tabs)`
        )
      }
    }

    // Open onboarding page for new users
    const onboardingUrl = browser.runtime.getURL('src/onboarding/index.html')
    browser.tabs.create({ url: onboardingUrl })
  } else if (details.reason === 'update') {
    console.log('[Raft] Updated from version:', details.previousVersion)

    // Migration: Remove old live backup session (replaced by recovery snapshots)
    try {
      await sessionsStorage.delete('raft:live-backup')
      console.log('[Raft] Migrated: removed old live backup session')
    } catch {
      // Ignore if doesn't exist
    }

    // On update, ensure existing sessions are backed up to sync
    // This helps users who upgrade from before sync was added
    const sessions = await sessionsStorage.getAll()
    const manualSessions = sessions.filter((s) => s.source !== 'auto' && s.source !== 'backup')

    // Backup up to 10 most recent manual sessions (to not overwhelm sync)
    const toBackup = manualSessions.sort((a, b) => b.createdAt - a.createdAt).slice(0, 10)

    for (const session of toBackup) {
      await backupSession(session)
    }
  }
}
