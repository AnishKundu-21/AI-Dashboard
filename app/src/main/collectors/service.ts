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
import { recomputeDailyFromEvents, upsertEvents } from '../db/events'
import { evaluateAlerts } from '../alerts/engine'
import { IPC } from '../../shared/ipc'
import type { QuotaSnapshot } from '../../shared/types'
import type { AdapterContext } from './base'
import { getAdapter, listAdapters, registerDefaultAdapters } from './registry'
import {
  getClaudeHome,
  getCodexHome,
  getCursorHome,
  getGrokHome,
  getOpenCodeHome
} from '../util/paths'
import { ensureRates, setPriceOverrides } from '../pricing/store'
import { ensureFxRates } from '../pricing/fx'
import { flushScanCache } from './cache'
import { isProviderEnabled, providerMeta, type ProviderId } from '../../shared/providers'

let registered = false
let pollTimer: NodeJS.Timeout | null = null
let lastRefreshAt: string | null = null
let refreshing = false
let refreshAgain = false
let watchers: FSWatcher[] = []
const watchedProviders = new Set<ProviderId>()
const sessionChangeTimers = new Map<ProviderId, NodeJS.Timeout>()
const activeSessionRefreshes = new Set<ProviderId>()
const rerunSessionRefreshes = new Set<ProviderId>()
const lastSessionRefreshAt = new Map<ProviderId, number>()
let quotaChangeTimer: NodeJS.Timeout | null = null
let lastQuotaAttemptAt = 0
let lastFullSessionRefreshAt = 0
// Reactive file-watcher triggers (constant during active coding sessions) can
// otherwise fire far more often than provider quota APIs tolerate, causing
// repeated 429s and a live/stale flicker. The base poll timer already covers
// the 15-60s cadence; this only throttles watcher-triggered refreshes.
const MIN_REACTIVE_QUOTA_INTERVAL_MS = 20_000
const SESSION_FALLBACK_INTERVAL_MS = 5 * 60_000
const MIN_SESSION_REFRESH_INTERVAL_MS: Partial<Record<ProviderId, number>> = {
  // OpenCode updates its db, wal and shm files for the same logical write.
  // Reading the store more often than this adds churn without fresher UI.
  opencode: 2_000
}

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
      if (!isProviderEnabled(settings, adapter.id)) continue
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
  // `unsupported` is authoritative: an account that cannot have subscription
  // windows will not start reporting them, so it must replace a previous live
  // value rather than letting a stale one persist forever.
  if (refreshed.unavailable?.reason === 'unsupported') return refreshed

  const refreshFailed =
    ctx.networkQuotaRefresh &&
    refreshed.auth_connected &&
    (refreshed.unavailable?.reason === 'probe_failed' ||
      (refreshed.confidence === 'estimate' &&
        /failed|http\s+\d|fallback/i.test(refreshed.source)))
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
    if (!isProviderEnabled(settings, adapter.id)) continue
    const started = Date.now()
    const scannedAt = new Date().toISOString()
    try {
      const result = await adapter.collectSessions(ctx)
      // Events first: session rows are a rollup of them, and the daily table
      // is rebuilt from them for the days they touch.
      upsertEvents(db, result.events)
      recomputeDailyFromEvents(db, result.events, settings.timezone)
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
  lastFullSessionRefreshAt = Date.now()
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
  if (!isProviderEnabled(settings, provider)) return { upserted: 0 }
  const ctx: AdapterContext = {
    networkQuotaRefresh: settings.network_quota_refresh,
    settings
  }
  await ensurePricing(settings.network_quota_refresh, settings.price_overrides)
  const started = Date.now()
  const scannedAt = new Date().toISOString()
  try {
    const result = await adapter.collectSessions(ctx)
    upsertEvents(db, result.events)
    recomputeDailyFromEvents(db, result.events, settings.timezone)
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
      if (Date.now() - lastFullSessionRefreshAt >= SESSION_FALLBACK_INTERVAL_MS) {
        await collectAllSessions()
      }
      await refreshAllQuotas()
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
  const settings = getSettings(getDb())
  const roots: Array<{ provider: ProviderId; path: string }> = [
    { provider: 'grok', path: getGrokHome() },
    { provider: 'codex', path: getCodexHome() },
    { provider: 'claude', path: getClaudeHome() },
    { provider: 'cursor', path: getCursorHome() },
    { provider: 'opencode', path: getOpenCodeHome() }
  ]

  for (const root of roots) {
    if (!isProviderEnabled(settings, root.provider)) continue
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
  rerunSessionRefreshes.clear()
  lastSessionRefreshAt.clear()
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
  if (
    provider === 'cursor' &&
    path.includes('agent-transcripts/') &&
    path.endsWith('.jsonl')
  ) {
    return 'session'
  }
  if (
    provider === 'opencode' &&
    (path === 'opencode.db' ||
      path === 'opencode.db-wal' ||
      path === 'opencode.db-shm')
  ) {
    return 'session'
  }
  return 'ignore'
}

function queueSessionRefresh(provider: ProviderId): void {
  if (sessionChangeTimers.has(provider)) return
  const minimumInterval = MIN_SESSION_REFRESH_INTERVAL_MS[provider] ?? 300
  const elapsed = Date.now() - (lastSessionRefreshAt.get(provider) ?? 0)
  const delay = Math.max(300, minimumInterval - elapsed)
  const timer = setTimeout(() => {
    sessionChangeTimers.delete(provider)
    void runSessionRefresh(provider)
  }, delay)
  sessionChangeTimers.set(provider, timer)
}

async function runSessionRefresh(provider: ProviderId): Promise<void> {
  if (activeSessionRefreshes.has(provider)) {
    rerunSessionRefreshes.add(provider)
    return
  }
  activeSessionRefreshes.add(provider)
  try {
    do {
      rerunSessionRefreshes.delete(provider)
      await collectProviderSessions(provider)
      lastSessionRefreshAt.set(provider, Date.now())
    } while (rerunSessionRefreshes.delete(provider))
    if (providerMeta(provider).reportsQuota) queueQuotaRefresh(750)
  } finally {
    activeSessionRefreshes.delete(provider)
  }
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
        // PlanConfig omits an unknown source rather than storing null.
        source: snap.plan_source ?? undefined
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
