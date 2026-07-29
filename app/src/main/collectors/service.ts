import { BrowserWindow } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { getDb } from '../db'
import {
  getLatestQuotas,
  getSettings,
  setSettings
} from '../db/queries'
import { insertQuotaSnapshot, upsertSessions } from '../db/upsert'
import { evaluateAlerts } from '../alerts/engine'
import { IPC } from '../../shared/ipc'
import type { QuotaSnapshot } from '../../shared/types'
import type { AdapterContext } from './base'
import { listAdapters, registerDefaultAdapters } from './registry'
import { getClaudeHome, getCodexHome, getGrokHome } from '../util/paths'
import type { ProviderId } from '../../shared/providers'

let registered = false
let pollTimer: NodeJS.Timeout | null = null
let lastRefreshAt: string | null = null
let refreshing = false
let refreshAgain = false
let watchers: FSWatcher[] = []
let sessionChangeTimer: NodeJS.Timeout | null = null
let quotaChangeTimer: NodeJS.Timeout | null = null

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
  return {
    ...previous,
    captured_at: refreshed.captured_at,
    plan_label: refreshed.plan_label ?? previous.plan_label,
    plan_source: refreshed.plan_source ?? previous.plan_source,
    stale: true,
    live_captured_at: liveCapturedAt,
    source: `${previous.source} · stale since ${liveCapturedAt} · ${refreshed.source}`
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

  let upserted = 0
  for (const adapter of listAdapters()) {
    try {
      const result = await adapter.collectSessions(ctx)
      upserted += upsertSessions(db, result.sessions)
    } catch {
      // soft-fail
    }
  }

  broadcastChanged()
  return { upserted }
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
  const roots: Array<{ provider: ProviderId; path: string }> = [
    { provider: 'grok', path: getGrokHome() },
    { provider: 'codex', path: getCodexHome() },
    { provider: 'claude', path: getClaudeHome() }
  ]

  for (const root of roots) {
    if (!existsSync(root.path)) continue
    try {
      const watcher = watch(
        root.path,
        { recursive: true, persistent: false },
        (_event, filename) => {
          const kind = classifyProviderChange(
            root.provider,
            filename?.toString() ?? ''
          )
          if (kind === 'session') queueSessionRefresh()
          else if (kind === 'quota') queueQuotaRefresh(250)
        }
      )
      watcher.on('error', () => {
        // Polling remains active if Windows drops a directory watcher.
      })
      watchers.push(watcher)
    } catch {
      // Missing/unsupported roots are covered by fallback polling.
    }
  }
}

export function stopRealtimeWatchers(): void {
  for (const watcher of watchers) watcher.close()
  watchers = []
  if (sessionChangeTimer) clearTimeout(sessionChangeTimer)
  if (quotaChangeTimer) clearTimeout(quotaChangeTimer)
  sessionChangeTimer = null
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

function queueSessionRefresh(): void {
  if (sessionChangeTimer) clearTimeout(sessionChangeTimer)
  sessionChangeTimer = setTimeout(() => {
    sessionChangeTimer = null
    void collectAllSessions()
    queueQuotaRefresh(750)
  }, 300)
}

function queueQuotaRefresh(delayMs: number): void {
  if (quotaChangeTimer) clearTimeout(quotaChangeTimer)
  quotaChangeTimer = setTimeout(() => {
    quotaChangeTimer = null
    void refreshAllQuotas()
  }, delayMs)
}

export function stopQuotaPolling(): void {
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

function rememberDetectedPlan(snap: QuotaSnapshot): void {
  if (!snap.plan_label || snap.plan_source !== 'api') return
  const db = getDb()
  const settings = getSettings(db)
  const current = settings.plans?.[snap.provider]
  if (current?.mode === 'manual') return
  if (current?.detected === snap.plan_label && current?.source === 'api') return

  setSettings(db, {
    plans: {
      ...settings.plans,
      [snap.provider]: {
        mode: current?.mode ?? 'auto',
        value: current?.value,
        detected: snap.plan_label,
        source: 'api'
      }
    }
  })
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.onChanged)
  }
}
