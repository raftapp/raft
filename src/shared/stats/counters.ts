/**
 * Suspension stats — write side.
 *
 * A *deliberately tiny* local accumulator that records two things per day:
 *   1. how many tabs Raft has suspended
 *   2. optional anonymous memory samples (heap bytes only)
 *
 * Privacy contract (enforced by tests/safety/stats-privacy.test.ts):
 *   - chrome.storage.local only — never .sync
 *   - never calls fetch / XHR
 *   - never persists URLs, titles, hostnames, tab IDs, or anything that
 *     could identify a site
 *
 * Retention is capped at STATS_CONFIG.RETENTION_DAYS to avoid unbounded
 * growth. Records older than that are dropped on every write.
 */

import { storage } from '../storage'
import { STATS_CONFIG, STORAGE_KEYS } from '../constants'

/**
 * Memory sample collected from the options page (renderer context).
 * Service workers cannot read `performance.memory`.
 */
export interface MemorySample {
  /** Sample timestamp (ms since epoch) */
  ts: number
  /** Approximate JS heap usage in bytes (performance.memory.usedJSHeapSize) */
  jsHeapBytes?: number
  /** Approximate system memory available in bytes (chrome.system.memory.getInfo) */
  systemAvailBytes?: number
}

/**
 * One day's worth of stats. Date keys are local-time YYYY-MM-DD so they line
 * up with what the user sees on their wall calendar.
 */
export interface StatsBucket {
  date: string
  suspendCount: number
  samples?: MemorySample[]
}

export interface StatsData {
  /** Schema version — bump if shape changes so we can migrate */
  version: 1
  /** First-ever suspension recorded; powers the "tracking since X" label */
  firstRecordedAt?: number
  /** Daily buckets, keyed by local YYYY-MM-DD */
  buckets: Record<string, StatsBucket>
}

/** Always return a freshly-allocated empty record (never share the buckets object). */
function emptyData(): StatsData {
  return { version: 1, buckets: {} }
}

/** Format a Date as a local YYYY-MM-DD key (no timezone surprises). */
export function formatDateKey(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parse a YYYY-MM-DD key back into a Date at local midnight. */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Drop buckets older than STATS_CONFIG.RETENTION_DAYS.
 * Operates in-place on the data object passed in.
 */
export function pruneOldStats(data: StatsData, now: Date = new Date()): void {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  cutoff.setDate(cutoff.getDate() - STATS_CONFIG.RETENTION_DAYS + 1)

  for (const key of Object.keys(data.buckets)) {
    const date = parseDateKey(key)
    if (!date || date < cutoff) {
      delete data.buckets[key]
    }
  }
}

/**
 * Read the current stats blob, defaulting to an empty record.
 *
 * Always returns a freshly-allocated object so callers can mutate freely
 * without leaking state into a shared default (a real bug we hit in tests).
 */
export async function getStatsData(): Promise<StatsData> {
  const raw = await storage.get<StatsData | null>(STORAGE_KEYS.STATS, null)
  if (!raw || typeof raw !== 'object' || raw.version !== 1) {
    return emptyData()
  }
  // Shallow-copy buckets so subsequent in-place mutation doesn't leak through
  // the chrome.storage cache (some mock layers also return live references).
  const buckets: Record<string, StatsBucket> = {}
  for (const [key, bucket] of Object.entries(raw.buckets ?? {})) {
    buckets[key] = {
      date: bucket.date,
      suspendCount: bucket.suspendCount,
      samples: bucket.samples ? bucket.samples.map((s) => ({ ...s })) : undefined,
    }
  }
  return {
    version: 1,
    firstRecordedAt: raw.firstRecordedAt,
    buckets,
  }
}

/** Persist the stats blob (always to chrome.storage.local — never .sync). */
async function saveStatsData(data: StatsData): Promise<void> {
  await storage.set(STORAGE_KEYS.STATS, data)
}

// Serialize writes so concurrent suspensions across windows don't lose
// increments via read-modify-write races. Same pattern as tabActivityStorage.
let _statsQueue: Promise<unknown> = Promise.resolve()

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = _statsQueue.then(fn, fn)
  _statsQueue = next.then(
    () => {},
    () => {}
  )
  return next
}

/**
 * Record `count` successful suspensions against today's bucket.
 * Safe to call concurrently — writes are serialized internally.
 */
export function recordSuspension(count = 1): Promise<void> {
  if (!Number.isFinite(count) || count <= 0) return Promise.resolve()
  return enqueue(async () => {
    const data = await getStatsData()
    const now = new Date()
    const key = formatDateKey(now)
    const bucket = data.buckets[key] ?? { date: key, suspendCount: 0 }
    bucket.suspendCount += Math.floor(count)
    data.buckets[key] = bucket
    if (!data.firstRecordedAt) {
      data.firstRecordedAt = now.getTime()
    }
    pruneOldStats(data, now)
    await saveStatsData(data)
  })
}

/**
 * Record an anonymous memory sample (heap bytes only — no URLs, no per-tab
 * data). Capped at STATS_CONFIG.MAX_SAMPLES_PER_DAY per bucket.
 */
export function recordMemorySample(sample: MemorySample): Promise<void> {
  return enqueue(async () => {
    const data = await getStatsData()
    const now = new Date()
    const key = formatDateKey(now)
    const bucket = data.buckets[key] ?? { date: key, suspendCount: 0 }
    const samples = bucket.samples ?? []
    samples.push({
      ts: sample.ts,
      jsHeapBytes: sample.jsHeapBytes,
      systemAvailBytes: sample.systemAvailBytes,
    })
    if (samples.length > STATS_CONFIG.MAX_SAMPLES_PER_DAY) {
      samples.splice(0, samples.length - STATS_CONFIG.MAX_SAMPLES_PER_DAY)
    }
    bucket.samples = samples
    data.buckets[key] = bucket
    pruneOldStats(data, now)
    await saveStatsData(data)
  })
}

/** Wipe all stats (used by Stats panel's "Reset stats" button). */
export function clearStats(): Promise<void> {
  return enqueue(async () => {
    await saveStatsData({ version: 1, buckets: {} })
  })
}
