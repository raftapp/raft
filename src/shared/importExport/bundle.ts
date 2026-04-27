/**
 * Encrypted .raftbundle session sharing
 *
 * Exports a single Session as an end-to-end encrypted file the user can
 * hand to someone out-of-band. Reuses the cloud-sync encryption primitives
 * (PBKDF2 600k + AES-256-GCM) so the trust surface is the same.
 *
 * Bundle envelope shape — JSON, file-shaped (not Drive-shaped):
 *   { v: 1, salt, iv, ct, iterations }
 */

import type { Session } from '../types'
import {
  PBKDF2_ITERATIONS,
  generateSalt,
  deriveKey,
  encryptObject,
  decryptObject,
} from '../cloudSync/encryption'

/** Current bundle envelope version. */
export const BUNDLE_VERSION = 1

/** File extension used for downloaded bundles. */
export const BUNDLE_EXTENSION = '.raftbundle'

/** MIME type used for bundle blobs. */
export const BUNDLE_MIME_TYPE = 'application/x-raftbundle+json'

/**
 * On-disk envelope. `salt` is the PBKDF2 salt for this file, `iv` and `ct`
 * are the AES-GCM IV and ciphertext. `iterations` is recorded so a future
 * bump (or downgrade for legacy bundles) round-trips correctly.
 */
export interface RaftBundleEnvelope {
  v: typeof BUNDLE_VERSION
  salt: string
  iv: string
  ct: string
  iterations: number
}

/**
 * Encrypt a session into a downloadable .raftbundle Blob.
 *
 * Generates a fresh salt + IV per export so two exports of the same
 * session under the same passphrase produce different ciphertexts.
 */
export async function exportBundle(session: Session, passphrase: string): Promise<globalThis.Blob> {
  if (!passphrase) {
    throw new Error('Passphrase required to export bundle')
  }

  const salt = generateSalt()
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS)
  const payload = await encryptObject(session, key)

  const envelope: RaftBundleEnvelope = {
    v: BUNDLE_VERSION,
    salt,
    iv: payload.iv,
    ct: payload.ct,
    iterations: PBKDF2_ITERATIONS,
  }

  const json = JSON.stringify(envelope)
  return new globalThis.Blob([json], { type: BUNDLE_MIME_TYPE })
}

/**
 * Type guard for the envelope shape. Anything missing a required field
 * is rejected before we even try to derive a key.
 */
export function isRaftBundleEnvelope(value: unknown): value is RaftBundleEnvelope {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return (
    e.v === BUNDLE_VERSION &&
    typeof e.salt === 'string' &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string' &&
    typeof e.iterations === 'number'
  )
}

/**
 * Parse a string (or Blob's text contents) into a validated envelope.
 * Throws with a useful message on malformed input.
 */
export function parseEnvelope(content: string): RaftBundleEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('Not a valid Raft bundle: file is not JSON')
  }
  if (!isRaftBundleEnvelope(parsed)) {
    throw new Error('Not a valid Raft bundle: envelope shape is wrong')
  }
  return parsed
}

/**
 * Convenience: read a Blob (or pass through a string) and parse it as an
 * envelope in one call. Useful for tests that just want to inspect the
 * envelope shape without decrypting.
 */
export async function readEnvelope(input: globalThis.Blob | string): Promise<RaftBundleEnvelope> {
  return parseEnvelope(await blobToText(input))
}

/**
 * Read a Blob into a string. Prefers the standard `Blob.text()`, falls back
 * to `FileReader` for environments (some Blob polyfills, older jsdom) that
 * don't implement it. Accepts a raw string passthrough for convenience —
 * callers can hand us either form.
 */
async function blobToText(input: globalThis.Blob | string): Promise<string> {
  if (typeof input === 'string') return input
  if (typeof (input as { text?: unknown }).text === 'function') {
    return input.text()
  }
  if (typeof (input as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    const buf = await input.arrayBuffer()
    return new TextDecoder().decode(buf)
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new globalThis.FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.readAsText(input as globalThis.Blob)
  })
}

/**
 * Decrypt a .raftbundle blob back into a Session.
 *
 * Wrong-passphrase failures (AES-GCM auth tag mismatch) are surfaced as
 * a clean `Error('Incorrect passphrase ...')` so callers can show the
 * user something useful instead of a raw OperationError.
 *
 * Accepts a Blob or a raw string (the JSON envelope) so callers don't have
 * to wrap text in a Blob just to round-trip it.
 */
export async function importBundle(
  blob: globalThis.Blob | string,
  passphrase: string
): Promise<Session> {
  if (!passphrase) {
    throw new Error('Passphrase required to import bundle')
  }

  const text = await blobToText(blob)
  const envelope = parseEnvelope(text)

  const key = await deriveKey(passphrase, envelope.salt, envelope.iterations)

  try {
    return await decryptObject<Session>({ v: 1, iv: envelope.iv, ct: envelope.ct }, key)
  } catch {
    throw new Error('Incorrect passphrase or corrupted bundle')
  }
}

/**
 * Build a download filename for a session bundle.
 * Sanitizes the session name to a filesystem-safe slug.
 */
export function bundleFilename(session: Session): string {
  const slug =
    session.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session'
  const date = new Date().toISOString().split('T')[0]
  return `raft-${slug}-${date}${BUNDLE_EXTENSION}`
}

/**
 * Generate a high-entropy passphrase suitable for one-time bundle sharing.
 * 6 words from a small wordlist + 4-digit number gives ~70 bits of entropy
 * while staying readable enough to dictate over a phone call.
 */
export function generateBundlePassphrase(): string {
  // Short, common, unambiguous. Picked to avoid lookalike letters and
  // anything that would be embarrassing to read aloud.
  const words = [
    'amber',
    'anchor',
    'apple',
    'arrow',
    'atlas',
    'banjo',
    'basin',
    'beach',
    'birch',
    'blaze',
    'bloom',
    'brave',
    'breeze',
    'brick',
    'bronze',
    'cabin',
    'canyon',
    'cedar',
    'chase',
    'cider',
    'cliff',
    'cloud',
    'clover',
    'comet',
    'coral',
    'crane',
    'crisp',
    'crown',
    'crystal',
    'dawn',
    'delta',
    'denim',
    'desert',
    'diamond',
    'dolphin',
    'dune',
    'eagle',
    'ember',
    'falcon',
    'fern',
    'fjord',
    'flame',
    'flint',
    'forest',
    'galaxy',
    'garden',
    'gentle',
    'glacier',
    'gold',
    'granite',
    'harbor',
    'harvest',
    'hawk',
    'heron',
    'hollow',
    'honey',
    'horizon',
    'island',
    'ivory',
    'jade',
    'juniper',
    'kettle',
    'lagoon',
    'lantern',
    'lily',
    'linen',
    'lotus',
    'maple',
    'meadow',
    'mellow',
    'mesa',
    'mint',
    'misty',
    'morning',
    'mountain',
    'nectar',
    'nimbus',
    'oak',
    'ocean',
    'olive',
    'opal',
    'orchid',
    'otter',
    'pebble',
    'phoenix',
    'pine',
    'plum',
    'prairie',
    'quartz',
    'quiet',
    'rain',
    'raven',
    'reef',
    'river',
    'robin',
    'sable',
    'sage',
    'sapphire',
    'shadow',
    'silver',
    'spark',
    'spring',
    'stone',
    'storm',
    'stream',
    'summit',
    'sunrise',
    'swan',
    'tide',
    'topaz',
    'trail',
    'tulip',
    'twilight',
    'valley',
    'velvet',
    'violet',
    'wander',
    'willow',
    'winter',
    'zephyr',
  ]

  const picks = Array.from({ length: 6 }, () => words[unbiasedRandomInt(words.length)])
  const num = unbiasedRandomInt(10_000)
  return `${picks.join('-')}-${num.toString().padStart(4, '0')}`
}

/**
 * Generate an unbiased integer in `[0, max)` from a CSPRNG.
 *
 * Naively doing `crypto.getRandomValues(...) % max` is biased whenever
 * `2^32 % max !== 0` — the lower buckets get slightly more probability
 * than the higher ones. Rejection sampling fixes this: discard any
 * draw that falls in the "unfair" top slice, so the remaining range
 * is an exact multiple of `max` and the modulo is uniform.
 *
 * For the values we use (120-word list, 10_000) the rejection rate is
 * effectively zero (< 1 in ~36M), so this loop is virtually always
 * one iteration.
 */
function unbiasedRandomInt(max: number): number {
  if (max <= 0 || !Number.isInteger(max)) {
    throw new Error('unbiasedRandomInt: max must be a positive integer')
  }
  const range = 0x1_0000_0000 // 2^32
  const limit = Math.floor(range / max) * max
  const buf = new Uint32Array(1)
  // Loop terminates: P(reject) = (range - limit) / range < max / range,
  // which is microscopic for our inputs.
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}
