/**
 * Memory-Savings Dashboard
 *
 * Renders the trust-positive proof point: how many tabs Raft has saved you
 * from, and a rough estimate of how much memory that freed up. Every number
 * comes from chrome.storage.local — nothing leaves the device.
 *
 * Numbers labelled "approximate" because the per-tab footprint constant
 * (STATS_CONFIG.EST_BYTES_PER_SUSPENSION) is an honest ballpark, not a
 * measurement.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { browser } from '@/shared/browser'
import { STATS_CONFIG, STORAGE_KEYS } from '@/shared/constants'
import {
  clearStats,
  formatApproximateBytes,
  getDashboardSnapshot,
  recordMemorySample,
  type DashboardSnapshot,
  type MemorySample,
} from '@/shared/stats'
import { formatRelativeTime } from '@/shared/utils'

interface StatsPanelProps {
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}

const SHARE_CARD_WIDTH = 1200
const SHARE_CARD_HEIGHT = 630

/** Read live JS heap usage if Chrome exposes it. Renderer-only API. */
function readJsHeapBytes(): number | undefined {
  type PerfWithMemory = Performance & {
    memory?: { usedJSHeapSize?: number; totalJSHeapSize?: number }
  }
  const perf = performance as PerfWithMemory
  return perf.memory?.usedJSHeapSize
}

/**
 * Read system memory if chrome.system.memory.getInfo is exposed.
 * Most builds will return undefined (we don't request the permission).
 */
async function readSystemAvailBytes(): Promise<number | undefined> {
  type SystemMemory = {
    getInfo?: () => Promise<{ availableCapacity?: number }>
  }
  const sys = (chrome as unknown as { system?: { memory?: SystemMemory } }).system
  if (!sys?.memory?.getInfo) return undefined
  try {
    const info = await sys.memory.getInfo()
    return info.availableCapacity
  } catch {
    return undefined
  }
}

export function StatsPanel({ onSuccess, onError }: StatsPanelProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [liveSample, setLiveSample] = useState<MemorySample | null>(null)
  const [resetConfirm, setResetConfirm] = useState(false)
  const sparklineRef = useRef<HTMLCanvasElement>(null)
  const shareCanvasRef = useRef<HTMLCanvasElement>(null)

  const loadSnapshot = useCallback(async () => {
    try {
      const next = await getDashboardSnapshot()
      setSnapshot(next)
    } catch (err) {
      console.error('[Raft] Failed to load stats:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSnapshot()
    const handler = (changes: { [key: string]: browser.storage.StorageChange }) => {
      if (changes[STORAGE_KEYS.STATS]) {
        loadSnapshot()
      }
    }
    browser.storage.local.onChanged.addListener(handler)
    return () => browser.storage.local.onChanged.removeListener(handler)
  }, [loadSnapshot])

  // Sample memory once when the panel mounts. The renderer is the only place
  // performance.memory is reachable, so we record from here, not the SW.
  useEffect(() => {
    let cancelled = false
    const sample = async () => {
      const jsHeapBytes = readJsHeapBytes()
      const systemAvailBytes = await readSystemAvailBytes()
      if (cancelled) return
      if (jsHeapBytes === undefined && systemAvailBytes === undefined) return
      const next: MemorySample = { ts: Date.now(), jsHeapBytes, systemAvailBytes }
      setLiveSample(next)
      void recordMemorySample(next).catch(() => {})
    }
    void sample()
    return () => {
      cancelled = true
    }
  }, [])

  // Draw the sparkline whenever data changes.
  useEffect(() => {
    if (!snapshot || !sparklineRef.current) return
    drawSparkline(sparklineRef.current, snapshot)
  }, [snapshot])

  const handleCopyImage = useCallback(async () => {
    if (!snapshot || !shareCanvasRef.current) return
    drawShareCard(shareCanvasRef.current, snapshot)
    try {
      const blob = await canvasToBlob(shareCanvasRef.current, 'image/png')
      if (!blob) {
        onError('Could not render image')
        return
      }
      const ClipboardItemCtor = (globalThis as unknown as { ClipboardItem?: typeof ClipboardItem })
        .ClipboardItem
      if (navigator.clipboard?.write && ClipboardItemCtor) {
        await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })])
        onSuccess('Image copied — paste it into Twitter, Reddit, anywhere')
        return
      }
      // Fallback: download the PNG so users on browsers without
      // clipboard.write (older Firefox, some Safari) still get the image.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'raft-memory-savings.png'
      a.click()
      URL.revokeObjectURL(url)
      onSuccess('Image downloaded')
    } catch (err) {
      console.error('[Raft] Copy as image failed:', err)
      onError('Copy failed — clipboard permission may be blocked')
    }
  }, [snapshot, onError, onSuccess])

  const handleReset = useCallback(async () => {
    try {
      await clearStats()
      setResetConfirm(false)
      await loadSnapshot()
      onSuccess('Stats reset')
    } catch {
      onError('Failed to reset stats')
    }
  }, [loadSnapshot, onError, onSuccess])

  if (loading || !snapshot) {
    return (
      <section
        class="bg-white rounded-lg shadow-sm border border-raft-200 p-6"
        aria-busy="true"
        aria-label="Loading stats"
      >
        <p class="text-raft-500">Loading stats…</p>
      </section>
    )
  }

  const trackingSinceLabel = snapshot.lifetime.firstRecordedAt
    ? formatRelativeTime(snapshot.lifetime.firstRecordedAt)
    : 'No suspensions yet'

  return (
    <div class="space-y-6">
      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <div class="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 class="text-lg font-semibold text-raft-900">Memory savings</h2>
            <p class="text-sm text-raft-500 mt-0.5">
              All numbers are computed locally. Nothing here ever leaves your browser.
            </p>
          </div>
          <button
            onClick={handleCopyImage}
            disabled={snapshot.isEmpty}
            class="px-3 py-1.5 text-sm bg-raft-600 text-white rounded hover:bg-raft-700 transition-colors disabled:opacity-50"
          >
            Copy as image
          </button>
        </div>

        {snapshot.isEmpty ? (
          <p class="text-raft-500 text-sm">
            No suspensions recorded yet. Suspend a tab (Alt+Shift+S) and your stats will appear
            here.
          </p>
        ) : (
          <>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
              <SummaryTile
                label="All time"
                value={snapshot.lifetime.totalSuspensions.toLocaleString()}
                sub={`since ${trackingSinceLabel}`}
              />
              <SummaryTile
                label="This week"
                value={snapshot.weekly.totalSuspensions.toLocaleString()}
                sub={`${snapshot.weekly.averagePerDay.toFixed(1)} / day avg`}
              />
              <SummaryTile
                label="This month"
                value={snapshot.monthly.totalSuspensions.toLocaleString()}
                sub={`${snapshot.monthly.averagePerDay.toFixed(1)} / day avg`}
              />
              <SummaryTile
                label="Memory freed (est.)"
                value={formatApproximateBytes(snapshot.lifetime.estimatedMemorySavedBytes)}
                sub={`@ ${Math.round(STATS_CONFIG.EST_BYTES_PER_SUSPENSION / (1024 * 1024))} MB / tab`}
                highlight
              />
              <SummaryTile
                label="Live JS heap"
                value={
                  liveSample?.jsHeapBytes
                    ? formatApproximateBytes(liveSample.jsHeapBytes)
                    : 'not exposed'
                }
                sub="this options page"
              />
              <SummaryTile
                label="System available"
                value={
                  liveSample?.systemAvailBytes
                    ? formatApproximateBytes(liveSample.systemAvailBytes)
                    : 'not exposed'
                }
                sub="needs system.memory permission"
              />
            </div>

            <div class="border-t border-raft-100 pt-4">
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-sm font-medium text-raft-700">Last 30 days</h3>
                <span class="text-xs text-raft-500">
                  {snapshot.monthly.totalSuspensions.toLocaleString()} total
                </span>
              </div>
              <canvas
                ref={sparklineRef}
                class="w-full h-24 bg-raft-50 rounded"
                width={600}
                height={96}
                role="img"
                aria-label={`30-day suspension sparkline. Total: ${snapshot.monthly.totalSuspensions} suspensions.`}
              />
            </div>
          </>
        )}
      </section>

      <section class="bg-white rounded-lg shadow-sm border border-raft-200 p-6">
        <h2 class="text-lg font-semibold text-raft-900 mb-2">Privacy</h2>
        <ul class="text-sm text-raft-600 space-y-1 list-disc list-inside">
          <li>
            Stats live only in <code>chrome.storage.local</code>. They never sync.
          </li>
          <li>No URLs, titles, or per-tab data are ever stored.</li>
          <li>Records older than {STATS_CONFIG.RETENTION_DAYS} days are automatically pruned.</li>
          <li>Memory numbers are approximate — Chrome doesn't expose exact per-tab footprint.</li>
        </ul>
        <div class="mt-4 border-t border-raft-100 pt-4">
          {resetConfirm ? (
            <div class="flex items-center gap-2">
              <span class="text-sm text-red-600">Reset all stats?</span>
              <button
                onClick={handleReset}
                class="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
              >
                Yes, reset
              </button>
              <button
                onClick={() => setResetConfirm(false)}
                class="px-3 py-1.5 text-sm border border-raft-300 text-raft-700 rounded hover:bg-raft-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setResetConfirm(true)}
              class="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              Reset stats
            </button>
          )}
        </div>
      </section>

      {/* Hidden offscreen canvas used for the share image. Kept in the DOM
          so toBlob() runs against an attached canvas. */}
      <canvas
        ref={shareCanvasRef}
        width={SHARE_CARD_WIDTH}
        height={SHARE_CARD_HEIGHT}
        class="sr-only"
        aria-hidden="true"
      />
    </div>
  )
}

interface SummaryTileProps {
  label: string
  value: string
  sub: string
  highlight?: boolean
}

function SummaryTile({ label, value, sub, highlight }: SummaryTileProps) {
  return (
    <div
      class={`rounded-lg p-4 border ${highlight ? 'bg-raft-50 border-raft-200' : 'bg-white border-raft-100'}`}
    >
      <p class="text-xs uppercase tracking-wide text-raft-500">{label}</p>
      <p class="text-2xl font-semibold text-raft-900 mt-1">{value}</p>
      <p class="text-xs text-raft-500 mt-1">{sub}</p>
    </div>
  )
}

/** Render the 30-day sparkline as simple bars. Pure canvas, no deps. */
function drawSparkline(canvas: HTMLCanvasElement, snapshot: DashboardSnapshot): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { series } = snapshot
  // Scale to device pixels so the sparkline stays crisp on HiDPI displays.
  const dpr = globalThis.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth || canvas.width
  const cssHeight = canvas.clientHeight || canvas.height
  if (canvas.width !== cssWidth * dpr) canvas.width = cssWidth * dpr
  if (canvas.height !== cssHeight * dpr) canvas.height = cssHeight * dpr
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssWidth, cssHeight)

  const max = Math.max(1, ...series.map((p) => p.count))
  const padX = 8
  const padY = 8
  const usableW = cssWidth - padX * 2
  const usableH = cssHeight - padY * 2
  const barW = usableW / series.length
  const gap = Math.min(2, barW * 0.2)

  ctx.fillStyle = '#0f766e' // raft-600 (teal-700)
  for (let i = 0; i < series.length; i++) {
    const ratio = series[i].count / max
    const h = Math.max(series[i].count > 0 ? 2 : 0, ratio * usableH)
    const x = padX + i * barW + gap / 2
    const y = padY + (usableH - h)
    ctx.fillRect(x, y, Math.max(1, barW - gap), h)
  }
}

/**
 * Render a 1200×630 share card. Intentionally simple — title, big number,
 * memory estimate, sparkline, branding line.
 */
function drawShareCard(canvas: HTMLCanvasElement, snapshot: DashboardSnapshot): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = SHARE_CARD_WIDTH
  const H = SHARE_CARD_HEIGHT
  ctx.clearRect(0, 0, W, H)

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#ecfeff')
  grad.addColorStop(1, '#e0f2fe')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  ctx.fillStyle = '#0f172a'
  ctx.font = '600 36px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillText('Raft saved my tabs from oblivion', 80, 110)

  ctx.font = '700 140px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#0f766e'
  ctx.fillText(snapshot.lifetime.totalSuspensions.toLocaleString(), 80, 280)

  ctx.font = '500 32px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#334155'
  ctx.fillText('tabs suspended', 80, 330)

  ctx.font = '600 44px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#0f172a'
  ctx.fillText(
    `${formatApproximateBytes(snapshot.lifetime.estimatedMemorySavedBytes)} freed`,
    80,
    410
  )

  ctx.font = '400 22px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.fillText(
    `(approx — ${Math.round(STATS_CONFIG.EST_BYTES_PER_SUSPENSION / (1024 * 1024))} MB per tab estimate)`,
    80,
    442
  )

  // Sparkline strip
  const sparkX = 80
  const sparkY = 480
  const sparkW = W - 160
  const sparkH = 80
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(sparkX, sparkY, sparkW, sparkH)
  ctx.strokeStyle = '#cbd5e1'
  ctx.lineWidth = 1
  ctx.strokeRect(sparkX, sparkY, sparkW, sparkH)

  const series = snapshot.series
  const max = Math.max(1, ...series.map((p) => p.count))
  const barW = sparkW / series.length
  ctx.fillStyle = '#0f766e'
  for (let i = 0; i < series.length; i++) {
    const ratio = series[i].count / max
    const h = ratio * (sparkH - 8)
    const x = sparkX + i * barW + 1
    const y = sparkY + (sparkH - 4 - h)
    ctx.fillRect(x, y, Math.max(1, barW - 2), h)
  }

  ctx.font = '500 20px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#475569'
  ctx.fillText('last 30 days', sparkX, sparkY + sparkH + 28)

  ctx.font = '500 22px system-ui, -apple-system, "Segoe UI", sans-serif'
  ctx.fillStyle = '#0f766e'
  ctx.textAlign = 'right'
  ctx.fillText('made with Raft — local, no telemetry', W - 80, sparkY + sparkH + 28)
  ctx.textAlign = 'left'
}

/** Promise wrapper around HTMLCanvasElement.toBlob (no jsdom polyfill needed). */
function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => resolve(blob), type)
    } else {
      resolve(null)
    }
  })
}
