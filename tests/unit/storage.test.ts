/**
 * Storage Layer Tests
 *
 * Tests for the chrome.storage wrapper and domain-specific storage helpers.
 * These are critical for data safety - "Your tabs are safe."
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setMockStorage, getMockStorage } from '../mocks/chrome'
import { storage, settingsStorage, sessionsStorage, tabActivityStorage } from '@/shared/storage'
import { STORAGE_KEYS } from '@/shared/constants'
import { DEFAULT_SETTINGS } from '@/shared/types'
import type { Session, Settings } from '@/shared/types'

describe('storage', () => {
  describe('get/set', () => {
    it('should return default value when key does not exist', async () => {
      const result = await storage.get('nonexistent', 'default')
      expect(result).toBe('default')
    })

    it('should return stored value when key exists', async () => {
      await storage.set('mykey', 'myvalue')
      const result = await storage.get('mykey', 'default')
      expect(result).toBe('myvalue')
    })

    it('should persist objects correctly', async () => {
      const obj = { foo: 'bar', count: 42, nested: { a: 1 } }
      await storage.set('obj', obj)
      const result = await storage.get('obj', {})
      expect(result).toEqual(obj)
    })

    it('should persist arrays correctly', async () => {
      const arr = [1, 2, 3, { x: 'y' }]
      await storage.set('arr', arr)
      const result = await storage.get('arr', [])
      expect(result).toEqual(arr)
    })
  })

  describe('remove', () => {
    it('should remove a key from storage', async () => {
      await storage.set('toremove', 'value')
      await storage.remove('toremove')
      const result = await storage.get('toremove', 'default')
      expect(result).toBe('default')
    })
  })

  describe('getMany', () => {
    it('should get multiple keys at once', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      const result = await storage.getMany<{ key1: string; key2: string }>(['key1', 'key2'])
      expect(result).toEqual({ key1: 'value1', key2: 'value2' })
    })

    it('should return only existing keys', async () => {
      await storage.set('exists', 'yes')

      const result = await storage.getMany<{ exists: string; missing: string }>([
        'exists',
        'missing',
      ])
      expect(result).toEqual({ exists: 'yes' })
    })
  })

  describe('setMany', () => {
    it('should set multiple keys atomically', async () => {
      await storage.setMany({ a: 1, b: 2, c: 3 })

      expect(await storage.get('a', 0)).toBe(1)
      expect(await storage.get('b', 0)).toBe(2)
      expect(await storage.get('c', 0)).toBe(3)
    })
  })
})

describe('settingsStorage', () => {
  describe('get', () => {
    it('should return default settings when none stored', async () => {
      const settings = await settingsStorage.get()
      expect(settings).toEqual(DEFAULT_SETTINGS)
    })

    it('should deep merge stored settings with defaults', async () => {
      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          suspension: { enabled: false },
        },
      })

      const settings = await settingsStorage.get()

      // Top-level defaults preserved
      expect(settings.ui).toEqual(DEFAULT_SETTINGS.ui)
      expect(settings.autoSave).toEqual(DEFAULT_SETTINGS.autoSave)

      // Partial suspension overrides merged
      expect(settings.suspension.enabled).toBe(false)
      expect(settings.suspension.inactivityMinutes).toBe(DEFAULT_SETTINGS.suspension.inactivityMinutes)
      expect(settings.suspension.neverSuspendPinned).toBe(DEFAULT_SETTINGS.suspension.neverSuspendPinned)
    })

    it('should preserve all nested defaults when only one property is overridden', async () => {
      setMockStorage({
        [STORAGE_KEYS.SETTINGS]: {
          ui: { theme: 'dark' },
        },
      })

      const settings = await settingsStorage.get()
      expect(settings.ui.theme).toBe('dark')
      expect(settings.ui.showBadge).toBe(DEFAULT_SETTINGS.ui.showBadge)
    })
  })

  describe('save', () => {
    it('should save complete settings', async () => {
      const newSettings: Settings = {
        ...DEFAULT_SETTINGS,
        suspension: { ...DEFAULT_SETTINGS.suspension, enabled: false, inactivityMinutes: 60 },
      }

      await settingsStorage.save(newSettings)
      const stored = getMockStorage()[STORAGE_KEYS.SETTINGS] as Settings
      expect(stored.suspension.enabled).toBe(false)
      expect(stored.suspension.inactivityMinutes).toBe(60)
    })
  })

  describe('update', () => {
    it('should update partial settings while preserving others', async () => {
      // Start with custom settings
      await settingsStorage.save({
        ...DEFAULT_SETTINGS,
        suspension: { ...DEFAULT_SETTINGS.suspension, enabled: true, inactivityMinutes: 30 },
        ui: { theme: 'dark', showBadge: true },
      })

      // Update only UI theme
      const updated = await settingsStorage.update({
        ui: { theme: 'light' } as Settings['ui'],
      })

      // UI theme updated
      expect(updated.ui.theme).toBe('light')
      // UI showBadge preserved
      expect(updated.ui.showBadge).toBe(true)
      // Suspension preserved
      expect(updated.suspension.inactivityMinutes).toBe(30)
    })

    it('should preserve nested suspension fields when updating suspension', async () => {
      await settingsStorage.save(DEFAULT_SETTINGS)

      const updated = await settingsStorage.update({
        suspension: { enabled: false } as Settings['suspension'],
      })

      expect(updated.suspension.enabled).toBe(false)
      expect(updated.suspension.inactivityMinutes).toBe(DEFAULT_SETTINGS.suspension.inactivityMinutes)
      expect(updated.suspension.whitelist).toEqual(DEFAULT_SETTINGS.suspension.whitelist)
    })
  })
})

describe('sessionsStorage', () => {
  const createSession = (overrides: Partial<Session> = {}): Session => ({
    id: overrides.id ?? 'session-1',
    name: overrides.name ?? 'Test Session',
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    windows: overrides.windows ?? [],
    source: overrides.source ?? 'manual',
  })

  describe('getAll', () => {
    it('should return empty array when no sessions', async () => {
      const sessions = await sessionsStorage.getAll()
      expect(sessions).toEqual([])
    })

    it('should return all stored sessions', async () => {
      const sessions = [createSession({ id: '1' }), createSession({ id: '2' })]
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      const result = await sessionsStorage.getAll()
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('1')
      expect(result[1].id).toBe('2')
    })
  })

  describe('get', () => {
    it('should return undefined for nonexistent session', async () => {
      const session = await sessionsStorage.get('nonexistent')
      expect(session).toBeUndefined()
    })

    it('should return session by ID', async () => {
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [createSession({ id: 'target', name: 'Target Session' })],
      })

      const session = await sessionsStorage.get('target')
      expect(session?.name).toBe('Target Session')
    })
  })

  describe('save', () => {
    it('should create new session when ID does not exist', async () => {
      const session = createSession({ id: 'new-session', name: 'New Session' })
      await sessionsStorage.save(session)

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe('new-session')
    })

    it('should update existing session when ID exists', async () => {
      const original = createSession({ id: 'existing', name: 'Original' })
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [original] })

      const updated = { ...original, name: 'Updated' }
      await sessionsStorage.save(updated)

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('Updated')
    })

    it('should not duplicate sessions on update', async () => {
      const session = createSession({ id: 'test' })
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: [session] })

      await sessionsStorage.save({ ...session, name: 'Update 1' })
      await sessionsStorage.save({ ...session, name: 'Update 2' })
      await sessionsStorage.save({ ...session, name: 'Update 3' })

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)
      expect(stored[0].name).toBe('Update 3')
    })
  })

  describe('delete', () => {
    it('should remove session by ID', async () => {
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [
          createSession({ id: '1' }),
          createSession({ id: '2' }),
          createSession({ id: '3' }),
        ],
      })

      await sessionsStorage.delete('2')

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(2)
      expect(stored.map((s) => s.id)).toEqual(['1', '3'])
    })

    it('should not corrupt storage when deleting nonexistent session', async () => {
      const sessions = [createSession({ id: '1' }), createSession({ id: '2' })]
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      await sessionsStorage.delete('nonexistent')

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(2)
    })
  })

  describe('deleteMany', () => {
    it('should remove multiple sessions at once', async () => {
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [
          createSession({ id: '1' }),
          createSession({ id: '2' }),
          createSession({ id: '3' }),
          createSession({ id: '4' }),
        ],
      })

      await sessionsStorage.deleteMany(['1', '3'])

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(2)
      expect(stored.map((s) => s.id)).toEqual(['2', '4'])
    })

    it('should handle empty deletion list', async () => {
      const sessions = [createSession({ id: '1' })]
      setMockStorage({ [STORAGE_KEYS.SESSIONS]: sessions })

      await sessionsStorage.deleteMany([])

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(1)
    })

    it('should handle partial matches without error', async () => {
      setMockStorage({
        [STORAGE_KEYS.SESSIONS]: [createSession({ id: '1' }), createSession({ id: '2' })],
      })

      await sessionsStorage.deleteMany(['1', 'nonexistent', '2'])

      const stored = getMockStorage()[STORAGE_KEYS.SESSIONS] as Session[]
      expect(stored).toHaveLength(0)
    })
  })
})

describe('tabActivityStorage', () => {
  describe('getAll', () => {
    it('should return empty object when no activity tracked', async () => {
      const activity = await tabActivityStorage.getAll()
      expect(activity).toEqual({})
    })

    it('should return all tab activity', async () => {
      const activity = { 1: 1000, 2: 2000, 3: 3000 }
      setMockStorage({ [STORAGE_KEYS.TAB_ACTIVITY]: activity })

      const result = await tabActivityStorage.getAll()
      expect(result).toEqual(activity)
    })
  })

  describe('touch', () => {
    it('should record activity for a tab', async () => {
      const before = Date.now()
      await tabActivityStorage.touch(42)
      const after = Date.now()

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(activity[42]).toBeGreaterThanOrEqual(before)
      expect(activity[42]).toBeLessThanOrEqual(after)
    })

    it('should update existing activity', async () => {
      setMockStorage({ [STORAGE_KEYS.TAB_ACTIVITY]: { 42: 1000 } })

      await tabActivityStorage.touch(42)

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(activity[42]).toBeGreaterThan(1000)
    })

    it('should preserve other tabs when touching one', async () => {
      setMockStorage({ [STORAGE_KEYS.TAB_ACTIVITY]: { 1: 1000, 2: 2000 } })

      await tabActivityStorage.touch(3)

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(activity[1]).toBe(1000)
      expect(activity[2]).toBe(2000)
      expect(activity[3]).toBeGreaterThan(0)
    })
  })

  describe('remove', () => {
    it('should remove activity for a closed tab', async () => {
      setMockStorage({ [STORAGE_KEYS.TAB_ACTIVITY]: { 1: 1000, 2: 2000 } })

      await tabActivityStorage.remove(1)

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(activity[1]).toBeUndefined()
      expect(activity[2]).toBe(2000)
    })
  })

  describe('cleanup', () => {
    it('should remove activity for tabs that no longer exist', async () => {
      setMockStorage({
        [STORAGE_KEYS.TAB_ACTIVITY]: { 1: 1000, 2: 2000, 3: 3000, 4: 4000 },
      })

      const existingTabs = new Set([2, 4])
      await tabActivityStorage.cleanup(existingTabs)

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(Object.keys(activity).map(Number).sort()).toEqual([2, 4])
    })

    it('should handle empty existing tabs set', async () => {
      setMockStorage({ [STORAGE_KEYS.TAB_ACTIVITY]: { 1: 1000, 2: 2000 } })

      await tabActivityStorage.cleanup(new Set())

      const activity = getMockStorage()[STORAGE_KEYS.TAB_ACTIVITY] as Record<number, number>
      expect(activity).toEqual({})
    })
  })
})
