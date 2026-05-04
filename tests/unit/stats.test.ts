/**
 * Stats counters + aggregator unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordSuspension,
  recordMemorySample,
  clearStats,
  getStatsData,
  pruneOldStats,
  formatDateKey,
  parseDateKey,
  computeDailySeries,
  computeRollup,
  computeLifetime,
  getDashboardSnapshot,
  formatApproximateBytes,
  type StatsData,
} from '@/shared/stats'
import { setMockStorage, getMockStorage } from '../mocks/chrome'
import { STATS_CONFIG, STORAGE_KEYS } from '@/shared/constants'

function makeData(buckets: Record<string, { suspendCount: number }>): StatsData {
  const out: StatsData = { version: 1, buckets: {} }
  for (const [date, val] of Object.entries(buckets)) {
    out.buckets[date] = { date, suspendCount: val.suspendCount }
  }
  return out
}

describe('formatDateKey / parseDateKey', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    const d = new Date(2026, 0, 5) // Jan 5 2026 local
    expect(formatDateKey(d)).toBe('2026-01-05')
  })

  it('round-trips through parseDateKey', () => {
    const d = new Date(2025, 11, 31)
    const key = formatDateKey(d)
    const parsed = parseDateKey(key)!
    expect(parsed.getFullYear()).toBe(2025)
    expect(parsed.getMonth()).toBe(11)
    expect(parsed.getDate()).toBe(31)
  })

  it('returns null on garbage input', () => {
    expect(parseDateKey('nope')).toBeNull()
    expect(parseDateKey('2026/01/05')).toBeNull()
    expect(parseDateKey('2026-13-40')).not.toBeNull() // Date constructor normalizes; we only validate shape
  })
})

describe('recordSuspension', () => {
  beforeEach(() => {
    setMockStorage({})
  })

  it('increments today\'s bucket', async () => {
    await recordSuspension(1)
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    expect(data.buckets[today].suspendCount).toBe(1)
    expect(data.firstRecordedAt).toBeGreaterThan(0)
  })

  it('accumulates across multiple calls', async () => {
    await recordSuspension(1)
    await recordSuspension(4)
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    expect(data.buckets[today].suspendCount).toBe(5)
  })

  it('serializes concurrent writes without losing increments', async () => {
    await Promise.all(Array.from({ length: 50 }, () => recordSuspension(1)))
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    expect(data.buckets[today].suspendCount).toBe(50)
  })

  it('ignores non-positive counts', async () => {
    await recordSuspension(0)
    await recordSuspension(-3)
    await recordSuspension(NaN)
    const data = await getStatsData()
    expect(Object.keys(data.buckets)).toHaveLength(0)
  })

  it('preserves firstRecordedAt across multiple days', async () => {
    await recordSuspension(1)
    const first = (await getStatsData()).firstRecordedAt
    await new Promise((r) => setTimeout(r, 5))
    await recordSuspension(1)
    const second = (await getStatsData()).firstRecordedAt
    expect(second).toBe(first)
  })
})

describe('recordMemorySample', () => {
  beforeEach(() => {
    setMockStorage({})
  })

  it('attaches samples to today\'s bucket', async () => {
    await recordMemorySample({ ts: 1000, jsHeapBytes: 1024 })
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    expect(data.buckets[today].samples).toEqual([
      { ts: 1000, jsHeapBytes: 1024, systemAvailBytes: undefined },
    ])
  })

  it('caps samples per day at MAX_SAMPLES_PER_DAY', async () => {
    for (let i = 0; i < STATS_CONFIG.MAX_SAMPLES_PER_DAY + 5; i++) {
      await recordMemorySample({ ts: i, jsHeapBytes: i })
    }
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    expect(data.buckets[today].samples).toHaveLength(STATS_CONFIG.MAX_SAMPLES_PER_DAY)
    // Newest samples retained, oldest dropped.
    expect(data.buckets[today].samples![0].ts).toBe(5)
  })

  it('persists only the contract keys (ts/jsHeapBytes/systemAvailBytes)', async () => {
    await recordMemorySample({
      ts: 1,
      jsHeapBytes: 2,
      systemAvailBytes: 3,
      // @ts-expect-error - intentional extra field that must NOT be persisted
      url: 'https://example.com',
    })
    const data = await getStatsData()
    const today = formatDateKey(new Date())
    const sample = data.buckets[today].samples![0]
    expect(Object.keys(sample).sort()).toEqual(['jsHeapBytes', 'systemAvailBytes', 'ts'].sort())
  })
})

describe('pruneOldStats', () => {
  it('drops buckets older than retention window', () => {
    const now = new Date(2026, 4, 10) // May 10 2026
    const data = makeData({
      '2026-05-10': { suspendCount: 5 },
      '2026-05-09': { suspendCount: 3 },
      '2026-02-09': { suspendCount: 100 }, // > 90 days back
      '2025-01-01': { suspendCount: 999 },
    })
    pruneOldStats(data, now)
    expect(data.buckets['2026-05-10']).toBeDefined()
    expect(data.buckets['2026-05-09']).toBeDefined()
    expect(data.buckets['2026-02-09']).toBeUndefined()
    expect(data.buckets['2025-01-01']).toBeUndefined()
  })

  it('keeps the boundary day inclusive', () => {
    const now = new Date(2026, 4, 10)
    const cutoff = new Date(now)
    cutoff.setDate(cutoff.getDate() - STATS_CONFIG.RETENTION_DAYS + 1)
    const data = makeData({ [formatDateKey(cutoff)]: { suspendCount: 1 } })
    pruneOldStats(data, now)
    expect(Object.keys(data.buckets)).toHaveLength(1)
  })

  it('handles malformed date keys by dropping them', () => {
    const data = makeData({ 'not-a-date': { suspendCount: 1 } })
    pruneOldStats(data)
    expect(data.buckets['not-a-date']).toBeUndefined()
  })
})

describe('computeDailySeries', () => {
  it('returns a contiguous oldest-first series with zero-fill', () => {
    const now = new Date(2026, 4, 10)
    const data = makeData({
      '2026-05-10': { suspendCount: 4 },
      '2026-05-08': { suspendCount: 2 },
    })
    const series = computeDailySeries(data, 5, now)
    expect(series.map((p) => p.date)).toEqual([
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
      '2026-05-10',
    ])
    expect(series.map((p) => p.count)).toEqual([0, 0, 2, 0, 4])
  })

  it('clamps daysBack to at least 1', () => {
    const series = computeDailySeries({ version: 1, buckets: {} }, 0)
    expect(series).toHaveLength(1)
  })
})

describe('computeRollup', () => {
  it('totals over the requested window', () => {
    // 7-day window ending May 10 inclusive = May 4..May 10. May 3 is outside.
    const now = new Date(2026, 4, 10)
    const data = makeData({
      '2026-05-10': { suspendCount: 10 },
      '2026-05-09': { suspendCount: 5 },
      '2026-05-03': { suspendCount: 7 }, // outside the 7-day window
    })
    const rollup = computeRollup(data, 7, now)
    expect(rollup.totalSuspensions).toBe(15)
    expect(rollup.daysCovered).toBe(7)
    expect(rollup.averagePerDay).toBeCloseTo(15 / 7)
    expect(rollup.estimatedMemorySavedBytes).toBe(15 * STATS_CONFIG.EST_BYTES_PER_SUSPENSION)
  })
})

describe('computeLifetime', () => {
  it('sums every retained bucket and surfaces firstRecordedAt', () => {
    const data: StatsData = {
      version: 1,
      firstRecordedAt: 12345,
      buckets: {
        '2026-05-10': { date: '2026-05-10', suspendCount: 3 },
        '2026-04-10': { date: '2026-04-10', suspendCount: 7 },
      },
    }
    const lifetime = computeLifetime(data)
    expect(lifetime.totalSuspensions).toBe(10)
    expect(lifetime.firstRecordedAt).toBe(12345)
    expect(lifetime.estimatedMemorySavedBytes).toBe(10 * STATS_CONFIG.EST_BYTES_PER_SUSPENSION)
  })

  it('exposes the most recent memory sample seen across buckets', () => {
    const data: StatsData = {
      version: 1,
      buckets: {
        '2026-05-10': {
          date: '2026-05-10',
          suspendCount: 1,
          samples: [
            { ts: 100, jsHeapBytes: 1 },
            { ts: 500, jsHeapBytes: 5 },
          ],
        },
        '2026-05-09': {
          date: '2026-05-09',
          suspendCount: 1,
          samples: [{ ts: 800, jsHeapBytes: 8 }],
        },
      },
    }
    const lifetime = computeLifetime(data)
    expect(lifetime.latestMemorySample?.ts).toBe(800)
  })
})

describe('getDashboardSnapshot', () => {
  beforeEach(() => {
    setMockStorage({})
  })

  it('returns isEmpty=true when nothing has been recorded', async () => {
    const snap = await getDashboardSnapshot()
    expect(snap.isEmpty).toBe(true)
    expect(snap.lifetime.totalSuspensions).toBe(0)
    expect(snap.series).toHaveLength(30)
  })

  it('reflects accumulated suspensions', async () => {
    await recordSuspension(4)
    await recordSuspension(6)
    const snap = await getDashboardSnapshot()
    expect(snap.isEmpty).toBe(false)
    expect(snap.lifetime.totalSuspensions).toBe(10)
    expect(snap.weekly.totalSuspensions).toBe(10)
    expect(snap.monthly.totalSuspensions).toBe(10)
  })
})

describe('clearStats', () => {
  it('wipes everything but leaves the storage key with a clean shape', async () => {
    await recordSuspension(5)
    await clearStats()
    const data = await getStatsData()
    expect(data.version).toBe(1)
    expect(data.buckets).toEqual({})
    expect(data.firstRecordedAt).toBeUndefined()
    // Key still present (we want consumers to read an empty object, not crash).
    expect(STORAGE_KEYS.STATS in getMockStorage()).toBe(true)
  })
})

describe('formatApproximateBytes', () => {
  it.each([
    [0, '≈ 0 B'],
    [512, '≈ 512 B'],
    [2048, '≈ 2.0 KB'],
    [85 * 1024 * 1024, '≈ 85.0 MB'],
    [3 * 1024 * 1024 * 1024, '≈ 3.0 GB'],
  ])('formats %s bytes as %s', (bytes, label) => {
    expect(formatApproximateBytes(bytes)).toBe(label)
  })

  it('uses no decimal for values >= 100', () => {
    expect(formatApproximateBytes(150 * 1024 * 1024)).toBe('≈ 150 MB')
  })

  it('handles negative / non-finite gracefully', () => {
    expect(formatApproximateBytes(-1)).toBe('≈ 0 B')
    expect(formatApproximateBytes(NaN)).toBe('≈ 0 B')
  })
})

describe('integration: suspendTab fires the recorder', () => {
  it('hook in suspension.ts increments the counter', async () => {
    const { suspendTab } = await import('@/background/suspension')
    const { addMockWindow, addMockTab } = await import('../mocks/chrome')
    const win = addMockWindow({ focused: true })
    addMockTab({ id: 1, windowId: win.id, url: 'https://example.com', active: false })
    const ok = await suspendTab(1)
    expect(ok).toBe(true)
    // recordSuspension is fire-and-forget; flush microtasks.
    await new Promise((r) => setTimeout(r, 0))
    const snap = await getDashboardSnapshot()
    expect(snap.lifetime.totalSuspensions).toBeGreaterThanOrEqual(1)
  })
})
