import { BrowserWindow } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { getDb } from '../db'
import {
  getLatestQuotas,
  getSettings,
  recordCollectorHealth,
  setSettings
} from '../db/queries'
import { insertQuotaSnapshot, upsertSessions } from '../db/upsert'
import { evaluateAlerts } from '../alerts/engine'
import { IPC } from '../../shared/ipc'
import type { QuotaSnapshot } from '../../shared/types'
import type { AdapterContext } from './base'
import { getAdapter, listAdapters, registerDefaultAdapters } from './registry'
import { getClaudeHome, getCodexHome, getGrokHome } from '../util/paths'
import { ensureRates, setPriceOverrides } from '../pricing/store'
import { ensureFxRates } from '../pricing/fx'
import { flushScanCache } from './cache'
import type { ProviderId } from '../../shared/providers'

let registered = false
let pollTimer: NodeJS.Timeout | null = null
let lastRefreshAt: string | null = null
let refreshing = false
let refreshAgain = false
let watchers: FSWatcher[] = []
const watchedProviders = new Set<ProviderId>()
const sessionChangeTimers = new Map<ProviderId, NodeJS.Timeout>()
let quotaChangeTimer: NodeJS.Timeout | null = null
let lastQuotaAttemptAt = 0
// Reactive file-watcher triggers (constant during active coding sessions) can
// otherwise fire far more often than provider quota APIs tolerate, causing
// repeated 429s and a live/stale flicker. The base poll timer already covers
// the 15-60s cadence; this only throttles watcher-triggered refreshes.
const MIN_REACTIVE_QUOTA_INTERVAL_MS = 20_000

// Claude's /api/oauth/usage is an undocumented, reverse-engineered endpoint
// with a much stricter rate limit than Grok/Codex's — the base 15-60s poll
// cadence alone trips repeated 429s during active Claude Code usage. Gate its
// network calls to a longer floor regardless of how often the poll loop runs;
// other providers are unaffected.
const NETWORK_QUOTA_MIN_INTERVAL_MS: Partial<Record<ProviderId, number>> = {
  claude: 60_000
}
const lastNetworkAttemptByProvider = new Map<ProviderId, number>()

export function initCollectors(): void {
  if (!registered) {
    registerDefaultAdapters()
    registered = true
  }
}

export function getLastRefreshAt(): string | null {
  return lastRefreshAt
}

export async function refreshAllQuotas(): Promise<QuotaSnapshot[]> {
  if (refreshing) {
    refreshAgain = true
    return getLatestQuotas(getDb())
  }
  refreshing = true
  lastQuotaAttemptAt = Date.now()
  try {
    initCollectors()
    const db = getDb()
    const settings = getSettings(db)
    const ctx: AdapterContext = {
      networkQuotaRefresh: settings.network_quota_refresh,
      settings
    }
    const previousByProvider = new Map(
      getLatestQuotas(db).map((snapshot) => [snapshot.provider, snapshot])
    )

    for (const adapter of listAdapters()) {
      const minInterval = NETWORK_QUOTA_MIN_INTERVAL_MS[adapter.id]
      if (minInterval) {
        const lastAttempt = lastNetworkAttemptByProvider.get(adapter.id) ?? 0
        if (Date.now() - lastAttempt < minInterval) continue
        lastNetworkAttemptByProvider.set(adapter.id, Date.now())
      }
      try {
        const refreshed = await adapter.refreshQuota(ctx)
        const previous = previousByProvider.get(adapter.id)
        const snap = preserveLastLiveSnapshot(refreshed, previous, ctx)
        insertQuotaSnapshot(db, snap)
        previousByProvider.set(adapter.id, snap)
        rememberDetectedPlan(snap)
      } catch {
        // soft-fail per provider — keep last good snapshot
      }
    }

    lastRefreshAt = new Date().toISOString()
    evaluateAlerts(db)
    broadcastChanged()
    return getLatestQuotas(db)
  } finally {
    refreshing = false
    if (refreshAgain) {
      refreshAgain = false
      queueQuotaRefresh(0)
    }
  }
}

function preserveLastLiveSnapshot(
  refreshed: QuotaSnapshot,
  previous: QuotaSnapshot | undefined,
  ctx: AdapterContext
): QuotaSnapshot {
  const refreshFailed =
    ctx.networkQuotaRefresh &&
    refreshed.auth_connected &&
    refreshed.confidence === 'estimate' &&
    /failed|http\s+\d|fallback/i.test(refreshed.source)
  const hasPreviousLive =
    previous?.auth_connected &&
    previous.confidence === 'live' &&
    previous.used_pct != null

  if (!refreshFailed || !hasPreviousLive || !previous) return refreshed

  const liveCapturedAt = previous.live_captured_at ?? previous.captured_at
  // previous.source may itself already be a stale-fallback message from an
  // earlier poll — strip any prior "· stale since ..." suffix so this string
  // doesn't grow unbounded across repeated failed polls.
  const baseLiveSource = previous.source.split(' · stale since ')[0]
  return {
    ...previous,
    captured_at: refreshed.captured_at,
    plan_label: refreshed.plan_label ?? previous.plan_label,
    plan_source: refreshed.plan_source ?? previous.plan_source,
    stale: true,
    live_captured_at: liveCapturedAt,
    source: `${baseLiveSource} · stale since ${liveCapturedAt} · ${refreshed.source}`
  }
}

export async function collectAllSessions(): Promise<{ upserted: number }> {
  initCollectors()
  const db = getDb()
  const settings = getSettings(db)
  const ctx: AdapterContext = {
    networkQuotaRefresh: settings.network_quota_refresh,
    settings
  }
  await ensurePricing(settings.network_quota_refresh, settings.price_overrides)

  let upserted = 0
  for (const adapter of listAdapters()) {
    const started = Date.now()
    const scannedAt = new Date().toISOString()
    try {
      const result = await adapter.collectSessions(ctx)
      upserted += upsertSessions(db, result.sessions)
      recordCollectorHealth(db, adapter.id, {
        last_scan_at: scannedAt,
        last_success_at: new Date().toISOString(),
        last_error: null,
        sessions_seen: result.sessions.length,
        last_duration_ms: Date.now() - started
      })
    } catch (error) {
      recordCollectorHealth(db, adapter.id, {
        last_scan_at: scannedAt,
        last_error: errorMessage(error),
        last_duration_ms: Date.now() - started
      })
    }
  }

  flushScanCache()
  broadcastChanged()
  return { upserted }
}

/**
 * Makes sure a rate table and FX table are loaded before any event is priced.
 *
 * Both fall back to their on-disk snapshots, so this stays useful when the
 * user has turned network refresh off — it simply will not fetch.
 */
async function ensurePricing(
  allowNetwork: boolean,
  overrides: Record<string, unknown> | undefined
): Promise<void> {
  setPriceOverrides(overrides as never)
  await Promise.all([
    ensureRates({ allowNetwork }).catch(() => undefined),
    ensureFxRates({ allowNetwork }).catch(() => undefined)
  ])
}

export async function collectProviderSessions(
  provider: ProviderId
): Promise<{ upserted: number }> {
  initCollectors()
  const adapter = getAdapter(provider)
  if (!adapter) return { upserted: 0 }
  const db = getDb()
  const settings = getSettings(db)
  const ctx: AdapterContext = {
    networkQuotaRefresh: settings.network_quota_refresh,
    settings
  }
  await ensurePricing(settings.network_quota_refresh, settings.price_overrides)
  const started = Date.now()
  const scannedAt = new Date().toISOString()
  try {
    const result = await adapter.collectSessions(ctx)
    const upserted = upsertSessions(db, result.sessions)
    recordCollectorHealth(db, provider, {
      last_scan_at: scannedAt,
      last_success_at: new Date().toISOString(),
      last_error: null,
      sessions_seen: result.sessions.length,
      last_duration_ms: Date.now() - started
    })
    broadcastChanged()
    return { upserted }
  } catch (error) {
    recordCollectorHealth(db, provider, {
      last_scan_at: scannedAt,
      last_error: errorMessage(error),
      last_duration_ms: Date.now() - started
    })
    broadcastChanged()
    return { upserted: 0 }
  }
}

export async function refreshEverything(): Promise<QuotaSnapshot[]> {
  // Local data is committed and pushed before any network request can delay it.
  await collectAllSessions()
  return refreshAllQuotas()
}

/**
 * Poll quotas as a fallback for remote changes that have no push/event API.
 */
export function startQuotaPolling(): void {
  stopQuotaPolling()

  const tick = async (): Promise<void> => {
    try {
      await refreshEverything()
    } catch {
      // ignore
    }
    scheduleNext()
  }

  const scheduleNext = (): void => {
    ensureRealtimeWatchers()
    const focused = BrowserWindow.getAllWindows().some((w) => w.isFocused())
    const ms = focused ? 15_000 : 60_000
    pollTimer = setTimeout(() => {
      void tick()
    }, ms)
  }

  // Initial live pull shortly after launch (let UI mount first)
  pollTimer = setTimeout(() => {
    void tick()
  }, 2_000)
}

/**
 * Watch first-party CLI stores. Local session changes reach SQLite/renderer in
 * under a second; quota refresh follows without blocking the local update.
 */
export function startRealtimeWatchers(): void {
  stopRealtimeWatchers()
  ensureRealtimeWatchers()
}

function ensureRealtimeWatchers(): void {
  const roots: Array<{ provider: ProviderId; path: string }> = [
    { provider: 'grok', path: getGrokHome() },
    { provider: 'codex', path: getCodexHome() },
    { provider: 'claude', path: getClaudeHome() }
  ]

  for (const root of roots) {
    if (watchedProviders.has(root.provider)) continue
    if (!existsSync(root.path)) {
      recordCollectorHealth(getDb(), root.provider, { watcher_status: 'missing' })
      continue
    }
    try {
      const watcher = watch(
        root.path,
        { recursive: true, persistent: false },
        (_event, filename) => {
          const kind = classifyProviderChange(
            root.provider,
            filename?.toString() ?? ''
          )
          if (kind === 'session') queueSessionRefresh(root.provider)
          else if (kind === 'quota') queueQuotaRefresh(250)
        }
      )
      watcher.on('error', () => {
        watchedProviders.delete(root.provider)
        recordCollectorHealth(getDb(), root.provider, { watcher_status: 'error' })
      })
      watchers.push(watcher)
      watchedProviders.add(root.provider)
      recordCollectorHealth(getDb(), root.provider, { watcher_status: 'watching' })
    } catch {
      recordCollectorHealth(getDb(), root.provider, { watcher_status: 'polling' })
    }
  }
}

export function stopRealtimeWatchers(): void {
  for (const watcher of watchers) watcher.close()
  watchers = []
  watchedProviders.clear()
  for (const timer of sessionChangeTimers.values()) clearTimeout(timer)
  sessionChangeTimers.clear()
  if (quotaChangeTimer) clearTimeout(quotaChangeTimer)
  quotaChangeTimer = null
}

export function classifyProviderChange(
  provider: ProviderId,
  filename: string
): 'session' | 'quota' | 'ignore' {
  const path = filename.replace(/\\/g, '/').toLowerCase()
  if (!path) return 'ignore'
  if (
    path.endsWith('/auth.json') ||
    path === 'auth.json' ||
    path.endsWith('/.credentials.json') ||
    path === '.credentials.json' ||
    path.endsWith('/credentials.json') ||
    path === 'credentials.json'
  ) {
    return 'quota'
  }

  if (provider === 'grok') {
    if (path === 'active_sessions.json') return 'session'
    if (
      path.endsWith('/updates.jsonl') ||
      path.endsWith('/summary.json') ||
      path.endsWith('/session_search.sqlite') ||
      path.endsWith('/session_search.sqlite-wal')
    ) {
      return 'session'
    }
  }
  if (provider === 'codex' && path.includes('sessions/') && path.endsWith('.jsonl')) {
    return 'session'
  }
  if (
    provider === 'claude' &&
    (path.includes('sessions/') || path.includes('projects/')) &&
    (path.endsWith('.jsonl') || path.endsWith('.json'))
  ) {
    return 'session'
  }
  return 'ignore'
}

function queueSessionRefresh(provider: ProviderId): void {
  const pending = sessionChangeTimers.get(provider)
  if (pending) clearTimeout(pending)
  const timer = setTimeout(() => {
    sessionChangeTimers.delete(provider)
    void collectProviderSessions(provider)
    queueQuotaRefresh(750)
  }, 300)
  sessionChangeTimers.set(provider, timer)
}

function queueQuotaRefresh(delayMs: number): void {
  if (quotaChangeTimer) clearTimeout(quotaChangeTimer)
  quotaChangeTimer = setTimeout(() => {
    quotaChangeTimer = null
    const sinceLast = Date.now() - lastQuotaAttemptAt
    if (sinceLast < MIN_REACTIVE_QUOTA_INTERVAL_MS) {
      queueQuotaRefresh(MIN_REACTIVE_QUOTA_INTERVAL_MS - sinceLast)
      return
    }
    void refreshAllQuotas()
  }, delayMs)
}

export function stopQuotaPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

// Claude detects its plan from the local credentials file (plan_source
// 'auth'), not a usage API (plan_source 'api') like Codex — both are real
// auto-detections and should be remembered for the Settings panel.
const AUTO_DETECTED_PLAN_SOURCES: ReadonlySet<QuotaSnapshot['plan_source']> = new Set([
  'api',
  'auth'
])

function rememberDetectedPlan(snap: QuotaSnapshot): void {
  if (!snap.plan_label || !AUTO_DETECTED_PLAN_SOURCES.has(snap.plan_source)) return
  const db = getDb()
  const settings = getSettings(db)
  const current = settings.plans?.[snap.provider]
  if (current?.mode === 'manual') return
  if (current?.detected === snap.plan_label && current?.source === snap.plan_source) return

  setSettings(db, {
    plans: {
      ...settings.plans,
      [snap.provider]: {
        mode: current?.mode ?? 'auto',
        value: current?.value,
        detected: snap.plan_label,
        source: snap.plan_source
      }
    }
  })
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.onChanged)
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 500)
}
