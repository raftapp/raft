/**
 * Suspension stats — read side.
 *
 * Pure rollups over the daily buckets persisted by counters.ts. Every value
 * is computed locally from local data; no network, no IDs, no URLs.
 */

import { STATS_CONFIG } from '../constants'
import { formatDateKey, getStatsData, parseDateKey, type StatsData } from './counters'

export interface DailyPoint {
  /** Local YYYY-MM-DD */
  date: string
  /** Suspensions recorded that day (0 for days with no activity) */
  count: number
}

export interface StatsRollup {
  /** Sum of suspensions over the window */
  totalSuspensions: number
  /** Window length in days (matches the requested daysBack) */
  daysCovered: number
  /** Mean suspensions per day across the window */
  averagePerDay: number
  /** Approximate bytes freed (count × STATS_CONFIG.EST_BYTES_PER_SUSPENSION) */
  estimatedMemorySavedBytes: number
}

export interface LifetimeStats {
  /** All-time suspension count across every retained bucket */
  totalSuspensions: number
  /** When the very first suspension was recorded (ms) */
  firstRecordedAt?: number
  /** Approximate bytes freed all-time */
  estimatedMemorySavedBytes: number
  /** Most recent memory sample observed across all buckets, if any */
  latestMemorySample?: { ts: number; jsHeapBytes?: number; systemAvailBytes?: number }
}

/**
 * Compute a contiguous daily series for the trailing `daysBack` days,
 * filling missing days with zero so the sparkline doesn't have holes.
 *
 * The returned series is oldest-first (left-to-right time axis).
 */
export function computeDailySeries(
  data: StatsData,
  daysBack: number,
  now: Date = new Date()
): DailyPoint[] {
  const days = Math.max(1, Math.floor(daysBack))
  const series: DailyPoint[] = []
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  start.setDate(start.getDate() - (days - 1))
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = formatDateKey(d)
    series.push({ date: key, count: data.buckets[key]?.suspendCount ?? 0 })
  }
  return series
}

/** Sum suspensions across the trailing `daysBack` days. */
export function computeRollup(
  data: StatsData,
  daysBack: number,
  now: Date = new Date()
): StatsRollup {
  const series = computeDailySeries(data, daysBack, now)
  const total = series.reduce((acc, p) => acc + p.count, 0)
  return {
    totalSuspensions: total,
    daysCovered: series.length,
    averagePerDay: series.length > 0 ? total / series.length : 0,
    estimatedMemorySavedBytes: total * STATS_CONFIG.EST_BYTES_PER_SUSPENSION,
  }
}

/** Sum every retained bucket — bounded by RETENTION_DAYS so always small. */
export function computeLifetime(data: StatsData): LifetimeStats {
  let total = 0
  let latest: LifetimeStats['latestMemorySample']
  for (const bucket of Object.values(data.buckets)) {
    total += bucket.suspendCount
    if (bucket.samples?.length) {
      const last = bucket.samples[bucket.samples.length - 1]
      if (!latest || last.ts > latest.ts) {
        latest = last
      }
    }
  }
  return {
    totalSuspensions: total,
    firstRecordedAt: data.firstRecordedAt,
    estimatedMemorySavedBytes: total * STATS_CONFIG.EST_BYTES_PER_SUSPENSION,
    latestMemorySample: latest,
  }
}

/**
 * Convenience snapshot pulling everything the dashboard needs in one read.
 */
export interface DashboardSnapshot {
  weekly: StatsRollup
  monthly: StatsRollup
  lifetime: LifetimeStats
  /** 30-day series for sparkline */
  series: DailyPoint[]
  /** True if no suspensions have been recorded yet */
  isEmpty: boolean
}

export async function getDashboardSnapshot(now: Date = new Date()): Promise<DashboardSnapshot> {
  const data = await getStatsData()
  const lifetime = computeLifetime(data)
  return {
    weekly: computeRollup(data, 7, now),
    monthly: computeRollup(data, 30, now),
    lifetime,
    series: computeDailySeries(data, 30, now),
    isEmpty: lifetime.totalSuspensions === 0,
  }
}

/**
 * Format a byte count as a friendly "≈ 1.2 GB" / "≈ 340 MB" / "≈ 12 KB" label.
 * Always uses the ≈ glyph so the number is legibly approximate.
 */
export function formatApproximateBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '≈ 0 B'
  const units = [
    { factor: 1024 * 1024 * 1024 * 1024, suffix: 'TB' },
    { factor: 1024 * 1024 * 1024, suffix: 'GB' },
    { factor: 1024 * 1024, suffix: 'MB' },
    { factor: 1024, suffix: 'KB' },
  ]
  for (const { factor, suffix } of units) {
    if (bytes >= factor) {
      const value = bytes / factor
      const formatted = value >= 100 ? value.toFixed(0) : value.toFixed(1)
      return `≈ ${formatted} ${suffix}`
    }
  }
  return `≈ ${bytes} B`
}

/** Re-export helpers callers commonly need together with the rollups. */
export { formatDateKey, parseDateKey }
