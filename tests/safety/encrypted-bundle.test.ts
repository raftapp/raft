/**
 * Encrypted Bundle Safety Tests
 *
 * Asserts that `.raftbundle` export/import:
 *   1. Never touches the network (no fetch / XHR / WebSocket calls).
 *   2. Round-trips a realistic session (50 tabs + groups) bit-for-bit.
 *   3. Surfaces a clean, useful error on the wrong passphrase.
 *   4. Uses the 600k PBKDF2 default and embeds it in the envelope.
 *
 * The "no network" check is the key trust property: end-to-end-encrypted
 * sharing must be a fully local operation. If we ever accidentally ship a
 * codepath that reaches out to a server, this test fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  exportBundle,
  importBundle,
  readEnvelope,
  generateBundlePassphrase,
  BUNDLE_VERSION,
} from '@/shared/importExport/bundle'
import { parseRaftbundle } from '@/shared/importExport/parsers/raftbundle'
import { PBKDF2_ITERATIONS } from '@/shared/cloudSync/encryption'
import type { Session } from '@/shared/types'
import { buildLargeSession } from './helpers'

describe('Encrypted .raftbundle export/import', () => {
  describe('Never reaches the network', () => {
    let fetchSpy: ReturnType<typeof vi.fn>
    let xhrSpy: ReturnType<typeof vi.fn>
    let wsSpy: ReturnType<typeof vi.fn>
    let originalFetch: typeof globalThis.fetch | undefined
    let originalXhr: typeof globalThis.XMLHttpRequest | undefined
    let originalWs: typeof globalThis.WebSocket | undefined

    beforeEach(() => {
      // Replace any network-capable global with a spy that throws if called.
      // If a future change accidentally introduces an HTTP call inside
      // exportBundle/importBundle, one of these spies will be invoked
      // and the test will fail loudly.
      originalFetch = globalThis.fetch
      originalXhr = globalThis.XMLHttpRequest
      originalWs = globalThis.WebSocket

      fetchSpy = vi.fn(() => {
        throw new Error('fetch must not be called from bundle export/import')
      })
      xhrSpy = vi.fn(() => {
        throw new Error('XMLHttpRequest must not be used from bundle export/import')
      })
      wsSpy = vi.fn(() => {
        throw new Error('WebSocket must not be used from bundle export/import')
      })

      globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch
      globalThis.XMLHttpRequest =
        xhrSpy as unknown as typeof globalThis.XMLHttpRequest
      globalThis.WebSocket = wsSpy as unknown as typeof globalThis.WebSocket
    })

    afterEach(() => {
      if (originalFetch) globalThis.fetch = originalFetch
      else delete (globalThis as { fetch?: unknown }).fetch
      if (originalXhr) globalThis.XMLHttpRequest = originalXhr
      if (originalWs) globalThis.WebSocket = originalWs
    })

    it('exportBundle and importBundle make zero network calls', async () => {
      const session = buildLargeSession(2, 5, 2)
      const passphrase = 'correct-horse-battery-staple'

      const blob = await exportBundle(session, passphrase)
      const restored = await importBundle(blob, passphrase)

      expect(restored.id).toBe(session.id)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(xhrSpy).not.toHaveBeenCalled()
      expect(wsSpy).not.toHaveBeenCalled()
    })

    it('parseRaftbundle (the parser entry) is also network-free', async () => {
      const session = buildLargeSession(1, 3, 1)
      const passphrase = 'bundle-test-passphrase'
      const blob = await exportBundle(session, passphrase)

      // Pass the Blob through directly — parseRaftbundle accepts both forms.
      const result = await parseRaftbundle(blob, passphrase)

      expect(result.success).toBe(true)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(xhrSpy).not.toHaveBeenCalled()
      expect(wsSpy).not.toHaveBeenCalled()
    })
  })

  describe('Round-trip preserves a 50-tab session bit-for-bit', () => {
    it('exports 50 tabs across multiple windows + groups, re-imports identically', async () => {
      // 5 windows × 10 tabs = 50 tabs, with 3 groups per window so group/tab
      // membership is exercised.
      const original: Session = buildLargeSession(5, 10, 3)
      const tabCount = original.windows.reduce((n, w) => n + w.tabs.length, 0)
      expect(tabCount).toBe(50)

      const passphrase = generateBundlePassphrase()
      const blob = await exportBundle(original, passphrase)
      const restored = await importBundle(blob, passphrase)

      // Bit-identical: every field, every ID, every group color, every index.
      expect(restored).toEqual(original)
    })

    it('parseRaftbundle yields the same Session that importBundle returns', async () => {
      const original = buildLargeSession(2, 25, 2)
      const passphrase = 'shared-channel-passphrase'
      const blob = await exportBundle(original, passphrase)

      const direct = await importBundle(blob, passphrase)
      const viaParser = await parseRaftbundle(blob, passphrase)

      expect(viaParser.success).toBe(true)
      expect(viaParser.sessions).toHaveLength(1)
      expect(viaParser.sessions[0]).toEqual(direct)
      expect(viaParser.stats.tabsImported).toBe(50)
      expect(viaParser.format).toBe('raftbundle')
    })
  })

  describe('Bad passphrase fails cleanly', () => {
    it('importBundle throws a useful error when the passphrase is wrong', async () => {
      const session = buildLargeSession(1, 5)
      const blob = await exportBundle(session, 'right-passphrase')

      await expect(importBundle(blob, 'wrong-passphrase')).rejects.toThrow(
        /incorrect passphrase|corrupted/i
      )
    })

    it('parseRaftbundle returns a failed ImportResult with a useful error', async () => {
      const session = buildLargeSession(1, 5)
      const blob = await exportBundle(session, 'right-passphrase')

      const result = await parseRaftbundle(blob, 'wrong-passphrase')

      expect(result.success).toBe(false)
      expect(result.sessions).toHaveLength(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].message).toMatch(/incorrect passphrase|corrupted/i)
      expect(result.format).toBe('raftbundle')
    })

    it('rejects malformed envelopes without trying to derive a key', async () => {
      const result = await parseRaftbundle('not-json', 'whatever')
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toMatch(/not a valid raft bundle/i)
    })

    it('rejects envelopes missing required fields', async () => {
      const result = await parseRaftbundle('{"v":1}', 'whatever')
      expect(result.success).toBe(false)
      expect(result.errors[0].message).toMatch(/envelope shape/i)
    })

    it('importBundle requires a passphrase', async () => {
      const session = buildLargeSession(1, 1)
      const blob = await exportBundle(session, 'pw')
      await expect(importBundle(blob, '')).rejects.toThrow(/passphrase required/i)
    })

    it('exportBundle requires a passphrase', async () => {
      const session = buildLargeSession(1, 1)
      await expect(exportBundle(session, '')).rejects.toThrow(/passphrase required/i)
    })
  })

  describe('Envelope uses the 600k PBKDF2 default', () => {
    it('records iterations: 600_000 in the envelope', async () => {
      const session = buildLargeSession(1, 2)
      const blob = await exportBundle(session, 'any-passphrase')
      const envelope = await readEnvelope(blob)

      expect(envelope.iterations).toBe(PBKDF2_ITERATIONS)
      expect(PBKDF2_ITERATIONS).toBe(600_000)
      expect(envelope.v).toBe(BUNDLE_VERSION)
      expect(typeof envelope.salt).toBe('string')
      expect(typeof envelope.iv).toBe('string')
      expect(typeof envelope.ct).toBe('string')
    })

    it('two exports of the same session produce different ciphertexts (fresh salt+iv)', async () => {
      const session = buildLargeSession(1, 3)
      const blob1 = await exportBundle(session, 'pw')
      const blob2 = await exportBundle(session, 'pw')

      const env1 = await readEnvelope(blob1)
      const env2 = await readEnvelope(blob2)

      expect(env1.salt).not.toBe(env2.salt)
      expect(env1.iv).not.toBe(env2.iv)
      expect(env1.ct).not.toBe(env2.ct)
    })
  })

  describe('Generated passphrase is high-entropy', () => {
    it('produces unique passphrases on repeated calls', () => {
      const seen = new Set<string>()
      for (let i = 0; i < 50; i++) {
        seen.add(generateBundlePassphrase())
      }
      // No collisions in 50 draws — confirms the wordlist+digit space is
      // doing real work and not silently returning a constant.
      expect(seen.size).toBe(50)
    })

    it('passphrase has the expected shape (6 words + 4 digits)', () => {
      const pw = generateBundlePassphrase()
      // word-word-word-word-word-word-NNNN
      expect(pw).toMatch(/^[a-z]+(-[a-z]+){5}-\d{4}$/)
    })
  })
})
