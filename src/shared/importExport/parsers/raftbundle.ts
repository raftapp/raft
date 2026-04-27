/**
 * Encrypted .raftbundle import parser
 *
 * Unlike the other parsers, this one needs a passphrase — bundles are
 * end-to-end encrypted with PBKDF2 + AES-256-GCM. The signature is async
 * and takes the passphrase explicitly; the panel calls it directly rather
 * than going through `importSessions`, since auto-detect can't supply
 * a passphrase.
 */

import type { Session } from '../../types'
import type { ImportResult, ImportError, ImportStats } from '../types'
import { importBundle } from '../bundle'

/**
 * Decrypt a .raftbundle file and produce an ImportResult shaped like
 * the other parsers so the panel's success/error UI can reuse the same
 * code path.
 *
 * The Session inside the bundle is preserved as-is (IDs intact). The
 * caller decides what to do with it — the round-trip safety contract
 * is "bytes you put in, bytes you get out".
 */
export async function parseRaftbundle(
  content: string | globalThis.Blob,
  passphrase: string
): Promise<ImportResult> {
  const stats: ImportStats = {
    totalEntries: 0,
    validUrls: 0,
    skippedUrls: 0,
    sessionsCreated: 0,
    tabsImported: 0,
  }
  const errors: ImportError[] = []
  const warnings: ImportError[] = []

  let session: Session
  try {
    session = await importBundle(content, passphrase)
  } catch (e) {
    return {
      success: false,
      sessions: [],
      errors: [{ message: e instanceof Error ? e.message : 'Failed to decrypt bundle' }],
      warnings: [],
      stats,
      format: 'raftbundle',
    }
  }

  // Recompute stats from the decrypted session so the UI summary works.
  for (const window of session.windows) {
    stats.totalEntries += window.tabs.length
    stats.validUrls += window.tabs.length
  }
  stats.sessionsCreated = 1
  stats.tabsImported = stats.validUrls

  return {
    success: true,
    sessions: [session],
    errors,
    warnings,
    stats,
    format: 'raftbundle',
  }
}
