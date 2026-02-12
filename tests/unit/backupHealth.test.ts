import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeBackupHealth, type BackupHealthInput } from '@/shared/backupHealth'

const NOW = new Date('2026-01-15T12:00:00Z').getTime()

function makeInput(overrides: Partial<BackupHealthInput> = {}): BackupHealthInput {
  return {
    totalSessions: 5,
    autoSaveEnabled: true,
    lastAutoSaveAt: NOW - 30 * 60000, // 30 min ago
    recoverySnapshotCount: 3,
    lastRecoveryAt: NOW - 5 * 60000, // 5 min ago
    browserSync: { sessionCount: 3, totalBytes: 5000, maxBytes: 102400, percentUsed: 4.9 },
    cloudSync: { configured: false, enabled: false, unlocked: false, syncing: false },
    isPro: false,
    exportReminderLastExport: NOW - 10 * 86400000, // 10 days ago
    ...overrides,
  }
}

describe('computeBackupHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // =========================================================================
  // Health levels
  // =========================================================================
  describe('health levels', () => {
    it("returns 'good' when all layers are healthy (base case)", () => {
      const result = computeBackupHealth(makeInput())
      expect(result.level).toBe('good')
    })

    it("returns 'good' when no sessions exist (nothing to back up)", () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 0,
          autoSaveEnabled: false,
          recoverySnapshotCount: 0,
          lastRecoveryAt: undefined,
          lastAutoSaveAt: undefined,
          browserSync: { sessionCount: 0, totalBytes: 0, maxBytes: 102400, percentUsed: 0 },
        })
      )
      expect(result.level).toBe('good')
    })

    it("returns 'attention' when auto-save is disabled but sessions exist", () => {
      const result = computeBackupHealth(
        makeInput({
          autoSaveEnabled: false,
        })
      )
      expect(result.level).toBe('attention')
    })

    it("returns 'attention' when last backup was 5 hours ago (between 4-24h threshold)", () => {
      const fiveHoursAgo = NOW - 5 * 3600000
      const result = computeBackupHealth(
        makeInput({
          lastAutoSaveAt: fiveHoursAgo,
          lastRecoveryAt: fiveHoursAgo,
        })
      )
      expect(result.level).toBe('attention')
    })

    it("returns 'warning' when last backup was 25 hours ago (>24h threshold)", () => {
      const twentyFiveHoursAgo = NOW - 25 * 3600000
      const result = computeBackupHealth(
        makeInput({
          lastAutoSaveAt: twentyFiveHoursAgo,
          lastRecoveryAt: twentyFiveHoursAgo,
          recoverySnapshotCount: 1,
        })
      )
      expect(result.level).toBe('warning')
    })

    it("returns 'warning' when cloud sync has error and is only configured layer for Pro user", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: false,
            lastError: 'Network error',
            syncing: false,
          },
        })
      )
      expect(result.level).toBe('warning')
    })
  })

  // =========================================================================
  // Headlines
  // =========================================================================
  describe('headlines', () => {
    it("'good' -> \"Your tabs are safe\"", () => {
      const result = computeBackupHealth(makeInput())
      expect(result.headline).toBe('Your tabs are safe')
    })

    it("'attention' -> \"Attention needed\"", () => {
      const result = computeBackupHealth(makeInput({ autoSaveEnabled: false }))
      expect(result.headline).toBe('Attention needed')
    })

    it("'warning' -> \"Action needed\"", () => {
      const result = computeBackupHealth(
        makeInput({
          lastAutoSaveAt: NOW - 25 * 3600000,
          lastRecoveryAt: NOW - 25 * 3600000,
          recoverySnapshotCount: 1,
        })
      )
      expect(result.headline).toBe('Action needed')
    })
  })

  // =========================================================================
  // Layers
  // =========================================================================
  describe('layers', () => {
    it("Auto-Save shows 'active' when recent", () => {
      const result = computeBackupHealth(makeInput())
      const autoSave = result.layers.find((l) => l.name === 'Auto-Save')
      expect(autoSave).toBeDefined()
      expect(autoSave!.status).toBe('active')
      expect(autoSave!.detail).toBe('Running on schedule')
    })

    it("Auto-Save shows 'disabled' when disabled", () => {
      const result = computeBackupHealth(makeInput({ autoSaveEnabled: false }))
      const autoSave = result.layers.find((l) => l.name === 'Auto-Save')
      expect(autoSave).toBeDefined()
      expect(autoSave!.status).toBe('disabled')
      expect(autoSave!.detail).toBe('Disabled')
    })

    it("Recovery Snapshots shows 'active' when recent snapshot exists", () => {
      const result = computeBackupHealth(
        makeInput({
          recoverySnapshotCount: 3,
          lastRecoveryAt: NOW - 30 * 60000, // 30 min ago (within 1 hour)
        })
      )
      const recovery = result.layers.find((l) => l.name === 'Recovery Snapshots')
      expect(recovery).toBeDefined()
      expect(recovery!.status).toBe('active')
      expect(recovery!.detail).toBe('3 snapshots available')
    })

    it("Browser Sync shows 'active' with session count when usage is low", () => {
      const result = computeBackupHealth(makeInput())
      const browserSync = result.layers.find((l) => l.name === 'Browser Sync')
      expect(browserSync).toBeDefined()
      expect(browserSync!.status).toBe('active')
      expect(browserSync!.detail).toBe('3 sessions synced')
    })

    it("Browser Sync shows 'stale' when >80% full", () => {
      const result = computeBackupHealth(
        makeInput({
          browserSync: { sessionCount: 10, totalBytes: 85000, maxBytes: 102400, percentUsed: 83 },
        })
      )
      const browserSync = result.layers.find((l) => l.name === 'Browser Sync')
      expect(browserSync).toBeDefined()
      expect(browserSync!.status).toBe('stale')
      expect(browserSync!.detail).toContain('83% full')
    })

    it("Browser Sync shows 'stale' when >95% full with drop warning", () => {
      const result = computeBackupHealth(
        makeInput({
          browserSync: { sessionCount: 10, totalBytes: 98000, maxBytes: 102400, percentUsed: 96 },
        })
      )
      const browserSync = result.layers.find((l) => l.name === 'Browser Sync')
      expect(browserSync).toBeDefined()
      expect(browserSync!.status).toBe('stale')
      expect(browserSync!.detail).toContain('may be dropped')
    })

    it("Cloud Sync shows 'disabled' with 'Pro feature' for non-Pro users", () => {
      const result = computeBackupHealth(makeInput({ isPro: false }))
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('disabled')
      expect(cloud!.detail).toBe('Pro feature')
    })

    it("Cloud Sync shows 'disabled' with 'Not connected' for Pro user without config", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: { configured: false, enabled: false, unlocked: false, syncing: false },
        })
      )
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('disabled')
      expect(cloud!.detail).toBe('Not connected')
    })

    it("Cloud Sync shows 'locked' when configured but locked", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: false,
            syncing: false,
          },
        })
      )
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('locked')
      expect(cloud!.detail).toContain('Locked')
    })

    it("Cloud Sync shows 'error' when there is a sync error", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: true,
            lastError: 'Network timeout',
            syncing: false,
          },
        })
      )
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('error')
      expect(cloud!.detail).toBe('Sync error')
    })

    it("Cloud Sync shows 'active' when synced recently", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: true,
            lastSyncAt: NOW - 60000, // 1 min ago
            syncing: false,
          },
        })
      )
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('active')
      expect(cloud!.detail).toBe('Connected')
    })

    it("Cloud Sync shows 'active' when currently syncing", () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: true,
            syncing: true,
          },
        })
      )
      const cloud = result.layers.find((l) => l.name === 'Cloud Sync')
      expect(cloud).toBeDefined()
      expect(cloud!.status).toBe('active')
      expect(cloud!.detail).toBe('Syncing now')
    })
  })

  // =========================================================================
  // Coverage
  // =========================================================================
  describe('coverage', () => {
    it('non-Pro: coverage based on browser sync session count', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 10,
          browserSync: { sessionCount: 6, totalBytes: 5000, maxBytes: 102400, percentUsed: 4.9 },
        })
      )
      expect(result.coverage.totalSessions).toBe(10)
      expect(result.coverage.backedUpSessions).toBe(6)
      expect(result.coverage.percentage).toBe(60)
    })

    it('Pro with active cloud: coverage = 100%', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 10,
          isPro: true,
          browserSync: { sessionCount: 3, totalBytes: 5000, maxBytes: 102400, percentUsed: 4.9 },
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: true,
            lastSyncAt: NOW - 60000,
            syncing: false,
          },
        })
      )
      expect(result.coverage.totalSessions).toBe(10)
      expect(result.coverage.backedUpSessions).toBe(10)
      expect(result.coverage.percentage).toBe(100)
    })

    it('zero sessions = 100% coverage', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 0,
          browserSync: { sessionCount: 0, totalBytes: 0, maxBytes: 102400, percentUsed: 0 },
        })
      )
      expect(result.coverage.totalSessions).toBe(0)
      expect(result.coverage.backedUpSessions).toBe(0)
      expect(result.coverage.percentage).toBe(100)
    })

    it('browser sync sessions capped at totalSessions', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 3,
          browserSync: { sessionCount: 10, totalBytes: 5000, maxBytes: 102400, percentUsed: 4.9 },
        })
      )
      expect(result.coverage.backedUpSessions).toBe(3)
      expect(result.coverage.percentage).toBe(100)
    })
  })

  // =========================================================================
  // Suggestions
  // =========================================================================
  describe('suggestions', () => {
    it('suggests enabling auto-save when disabled and sessions > 0', () => {
      const result = computeBackupHealth(
        makeInput({
          autoSaveEnabled: false,
          totalSessions: 5,
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('auto-save'))
      expect(suggestion).toBeDefined()
      expect(suggestion!.target).toBe('general')
      expect(suggestion!.actionLabel).toBe('Enable')
    })

    it('does not suggest enabling auto-save when no sessions', () => {
      const result = computeBackupHealth(
        makeInput({
          autoSaveEnabled: false,
          totalSessions: 0,
          browserSync: { sessionCount: 0, totalBytes: 0, maxBytes: 102400, percentUsed: 0 },
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('auto-save'))
      expect(suggestion).toBeUndefined()
    })

    it('suggests cloud sync for Pro users when not connected', () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: { configured: false, enabled: false, unlocked: false, syncing: false },
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('Cloud Sync'))
      expect(suggestion).toBeDefined()
      expect(suggestion!.target).toBe('cloud')
      expect(suggestion!.actionLabel).toBe('Connect')
    })

    it('suggests export when 20+ sessions and never exported', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 25,
          exportReminderLastExport: undefined,
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('Export'))
      expect(suggestion).toBeDefined()
      expect(suggestion!.target).toBe('sessions')
      expect(suggestion!.actionLabel).toBe('Export')
    })

    it('suggests export when last export >60 days ago with 20+ sessions', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 25,
          exportReminderLastExport: NOW - 90 * 86400000, // 90 days ago
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('days ago'))
      expect(suggestion).toBeDefined()
      expect(suggestion!.target).toBe('sessions')
      expect(suggestion!.actionLabel).toBe('Export')
      expect(suggestion!.message).toContain('90')
    })

    it('does not suggest export when fewer than 20 sessions', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 10,
          exportReminderLastExport: undefined,
        })
      )
      const suggestion = result.suggestions.find(
        (s) => s.message.includes('Export') || s.message.includes('export')
      )
      // The only export-like suggestion should not be present (cloud upgrade suggestion may exist)
      const exportSuggestion = result.suggestions.find(
        (s) => s.target === 'sessions' && s.actionLabel === 'Export'
      )
      expect(exportSuggestion).toBeUndefined()
    })

    it('does not suggest export when last export is recent', () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 25,
          exportReminderLastExport: NOW - 10 * 86400000, // 10 days ago (< 60)
        })
      )
      const exportSuggestion = result.suggestions.find(
        (s) => s.target === 'sessions' && s.actionLabel === 'Export'
      )
      expect(exportSuggestion).toBeUndefined()
    })

    it('suggests unlocking cloud sync when locked', () => {
      const result = computeBackupHealth(
        makeInput({
          isPro: true,
          cloudSync: {
            configured: true,
            enabled: true,
            unlocked: false,
            syncing: false,
          },
        })
      )
      const suggestion = result.suggestions.find((s) => s.message.includes('Unlock'))
      expect(suggestion).toBeDefined()
      expect(suggestion!.target).toBe('cloud')
      expect(suggestion!.actionLabel).toBe('Unlock')
    })
  })

  // =========================================================================
  // Summary
  // =========================================================================
  describe('summary', () => {
    it('includes time ago and coverage when sessions exist', () => {
      const result = computeBackupHealth(makeInput())
      expect(result.summary).toContain('Last backup')
      expect(result.summary).toContain('sessions backed up')
    })

    it("says 'No sessions to back up' when totalSessions is 0", () => {
      const result = computeBackupHealth(
        makeInput({
          totalSessions: 0,
          browserSync: { sessionCount: 0, totalBytes: 0, maxBytes: 102400, percentUsed: 0 },
        })
      )
      expect(result.summary).toBe('No sessions to back up')
    })
  })
})
