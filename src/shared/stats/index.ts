/**
 * Local-only suspension stats.
 *
 * See counters.ts for the privacy contract — every datum stored here lives
 * exclusively in chrome.storage.local and never includes URLs or identifiers.
 */

export {
  recordSuspension,
  recordMemorySample,
  clearStats,
  getStatsData,
  pruneOldStats,
  formatDateKey,
  parseDateKey,
  type MemorySample,
  type StatsBucket,
  type StatsData,
} from './counters'

export {
  computeDailySeries,
  computeRollup,
  computeLifetime,
  getDashboardSnapshot,
  formatApproximateBytes,
  type DailyPoint,
  type StatsRollup,
  type LifetimeStats,
  type DashboardSnapshot,
} from './aggregator'
