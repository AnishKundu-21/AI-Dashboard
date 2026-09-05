import type Database from 'better-sqlite3'
import { providerIds, providerMeta, type ProviderId } from '../../shared/providers'
import type {
  AlertRow,
  AppSettings,
  BurnPoint,
  CollectorHealth,
  DailyUsagePoint,
  ModelMixItem,
  OverviewMetrics,
  ProjectionCard,
  ProviderCost,
  QuotaSnapshot,
  RangeDays,
  SessionRow
} from '../../shared/types'
import { AppSettingsSchema } from '../../shared/types'
import { buildBurnSeries } from '../analytics/burn'
import { buildProjectionCard } from '../analytics/projections'
import { pricingInfo } from '../pricing/store'
import { fxInfo } from '../pricing/fx'
import { makeDayFormatter, rangeStartMs } from '../util/time'
import { normalizeModelName } from '../collectors/models'

type ProviderFilter = ProviderId | 'all'

function providerClause(provider: ProviderFilter, column = 'provider'): string {
  return provider === 'all' ? '1=1' : `${column} = @provider`
}

/**
 * Range and day arithmetic now live in `util/time`, which is unit-tested
 * against half-hour offsets and DST boundaries.
 */
function rangeStart(rangeDays: RangeDays, timezone = 'system'): Date | null {
  const ms = rangeStartMs(rangeDays, timezone)
  return ms === null ? null : new Date(ms)
}

function inclusiveDaysSince(day: string | null): number {
  if (!day) return 1
  const start = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return 1
  return Math.max(1, Math.floor((Date.now() - start.getTime()) / 86_400_000) + 1)
}

export function getSettings(db: Database.Database): AppSettings {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as
    | { value: string }
    | undefined
  if (!row) {
    return AppSettingsSchema.parse({})
  }
  return AppSettingsSchema.parse(JSON.parse(row.value))
}

export function setSettings(
  db: Database.Database,
  partial: Partial<AppSettings>
): AppSettings {
  const current = getSettings(db)
  const next = AppSettingsSchema.parse({ ...current, ...partial, plans: { ...current.plans, ...partial.plans } })
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)`).run(
    JSON.stringify(next)
  )
  return next
}

export function getLatestQuotas(db: Database.Database): QuotaSnapshot[] {
  const rows = db
    .prepare(
      `
    SELECT q.*
    FROM quota_snapshots q
    INNER JOIN (
      SELECT provider, MAX(captured_at) AS max_at
      FROM quota_snapshots
      GROUP BY provider
    ) latest ON q.provider = latest.provider AND q.captured_at = latest.max_at
    ORDER BY q.provider
  `
    )
    .all() as Array<Record<string, unknown>>

  const byProvider = new Map<string, QuotaSnapshot>()
  for (const r of rows) {
    let products: Record<string, number> | undefined
    let windows: QuotaSnapshot['windows']
    if (typeof r.raw_summary_json === 'string' && r.raw_summary_json) {
      try {
        const parsed = JSON.parse(r.raw_summary_json) as {
          products?: Record<string, number>
          windows?: QuotaSnapshot['windows']
        }
        products = parsed.products ?? undefined
        windows = parsed.windows ?? undefined
      } catch {
        products = undefined
      }
    }
    byProvider.set(String(r.provider), {
      provider: r.provider as ProviderId,
      captured_at: String(r.captured_at),
      used_pct: r.used_pct as number | null,
      remaining_pct: r.remaining_pct as number | null,
      reset_at: (r.reset_at as string | null) ?? null,
      window_label: (r.window_label as string | null) ?? null,
      plan_label: (r.plan_label as string | null) ?? null,
      plan_source: (r.plan_source as QuotaSnapshot['plan_source']) ?? null,
      confidence: r.confidence as QuotaSnapshot['confidence'],
      source: String(r.source),
      auth_connected: Boolean(r.auth_connected),
      stale: Boolean(r.stale),
      live_captured_at: (r.live_captured_at as string | null) ?? null,
      windows,
      products
    })
  }

  // Ensure all three providers appear (not connected placeholders)
  return providerIds().map((id) => {
    const existing = byProvider.get(id)
    if (existing) return existing
    return {
      provider: id,
      captured_at: new Date().toISOString(),
      used_pct: null,
      remaining_pct: null,
      reset_at: null,
      window_label: null,
      plan_label: null,
      plan_source: 'unknown' as const,
      confidence: 'unknown' as const,
      source: 'no snapshot',
      auth_connected: false,
      stale: false,
      live_captured_at: null
    }
  })
}

/**
 * Headline totals, read from events.
 *
 * Filtering sessions by `started_at` would count a session that began just
 * before the window opened as wholly inside or wholly outside it. Events carry
 * their own instant, so a range boundary cuts exactly where it should.
 */
export function getOverview(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): OverviewMetrics {
  const timezone = getSettings(db).timezone
  const sinceMs = rangeStartMs(rangeDays, timezone)

  const row = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(uncached_input + cached_input + cache_creation + output), 0) AS tokens_total,
      COALESCE(SUM(cost_usd), 0) AS api_equiv_usd,
      COUNT(DISTINCT provider || session_id) AS session_count,
      COALESCE(SUM(cache_savings_usd), 0) AS cache_savings_usd,
      COUNT(DISTINCT CASE WHEN cost_usd IS NULL THEN provider || session_id END)
        AS unpriced_sessions,
      MIN(ts_ms) AS min_ts_ms
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider)}
  `
    )
    .get({ sinceMs, provider }) as {
    tokens_total: number
    api_equiv_usd: number
    session_count: number
    cache_savings_usd: number
    unpriced_sessions: number
    min_ts_ms: number | null
  }

  const byProviderRows = db
    .prepare(
      `
    SELECT
      provider,
      COALESCE(SUM(uncached_input + cached_input + cache_creation + output), 0) AS tokens_total,
      COALESCE(SUM(cost_usd), 0) AS api_equiv_usd,
      COUNT(DISTINCT session_id) AS session_count
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider)}
    GROUP BY provider
    ORDER BY tokens_total DESC
  `
    )
    .all({ sinceMs, provider }) as ProviderCost[]

  const quotas = getLatestQuotas(db)
    .filter((q) => provider === 'all' || q.provider === provider)
    .map(applyClaudeBurnWindow)
  const usedValues = quotas
    .map((q) => q.used_pct)
    .filter((v): v is number => typeof v === 'number')
  const avg_used_pct =
    usedValues.length > 0
      ? usedValues.reduce((a, b) => a + b, 0) / usedValues.length
      : null

  const breakdown = db
    .prepare(
      `SELECT
         COALESCE(SUM(uncached_input), 0) AS input,
         COALESCE(SUM(output), 0) AS output,
         COALESCE(SUM(cached_input + cache_creation), 0) AS cached,
         COALESCE(SUM(reasoning), 0) AS reasoning,
         COUNT(*) AS model_calls
       FROM usage_events
       WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
         AND ${providerClause(provider)}`
    )
    .get({ sinceMs, provider }) as OverviewMetrics['token_breakdown']

  const averageDays =
    rangeDays === 0
      ? inclusiveDaysSince(
          row.min_ts_ms == null ? null : new Date(row.min_ts_ms).toISOString().slice(0, 10)
        )
      : rangeDays

  return {
    tokens_total: row.tokens_total,
    api_equiv_usd: row.api_equiv_usd,
    session_count: row.session_count,
    avg_used_pct,
    range_days: rangeDays,
    avg_daily_tokens: row.tokens_total / averageDays,
    token_breakdown: breakdown,
    by_provider: byProviderRows,
    cache_savings_usd: row.cache_savings_usd,
    unpriced_sessions: row.unpriced_sessions,
    pricing: pricingInfo(),
    fx: fxInfo()
  }
}

/**
 * Daily usage, bucketed from individual events.
 *
 * Reading events rather than sessions is what makes a session that ran past
 * midnight contribute to both days instead of landing wholly on the one it
 * started.
 */
export function getDailyUsage(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): DailyUsagePoint[] {
  const timezone = getSettings(db).timezone
  const sinceMs = rangeStartMs(rangeDays, timezone)
  const dayOf = makeDayFormatter(timezone)

  const rows = db
    .prepare(
      `
    SELECT provider, ts_ms, session_id,
           (uncached_input + cached_input + cache_creation + output) AS tokens_total,
           COALESCE(cost_usd, 0) AS api_equiv_usd
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider)}
  `
    )
    .all({ sinceMs, provider }) as Array<{
      provider: ProviderId
      ts_ms: number
      session_id: string
      tokens_total: number
      api_equiv_usd: number
    }>

  const grouped = new Map<string, DailyUsagePoint & { sessions: Set<string> }>()
  for (const row of rows) {
    const day = dayOf(row.ts_ms)
    const key = `${day}\u0000${row.provider}`
    let current = grouped.get(key)
    if (!current) {
      current = {
        day,
        provider: row.provider,
        tokens_total: 0,
        session_count: 0,
        api_equiv_usd: 0,
        sessions: new Set<string>()
      }
      grouped.set(key, current)
    }
    current.tokens_total += row.tokens_total
    current.api_equiv_usd += row.api_equiv_usd
    current.sessions.add(row.session_id)
  }

  return Array.from(grouped.values())
    .map(({ sessions, ...point }) => ({
      ...point,
      // A session active on two days counts once on each, which is what the
      // chart is asking for.
      session_count: sessions.size,
      api_equiv_usd: Math.round(point.api_equiv_usd * 1e6) / 1e6
    }))
    .sort((a, b) => a.day.localeCompare(b.day))
}

export function getSessions(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays,
  search?: string,
  options: {
    model?: string
    day?: string
    sortBy?: 'started_at' | 'tokens_total' | 'api_equiv_usd' | 'duration_ms'
    sortDir?: 'asc' | 'desc'
    limit?: number
    offset?: number
  } = {}
): SessionRow[] {
  const sinceIso = rangeStart(rangeDays, getSettings(db).timezone)?.toISOString() ?? null

  let sql = `
    SELECT id, provider, project, model, tokens_in, tokens_out, tokens_total,
           tokens_cached, tokens_reasoning, model_calls, api_equiv_usd,
           provider_cost_usd, api_duration_ms, cache_savings_usd,
           unpriced, duration_ms, status,
           started_at, ended_at, source
    FROM sessions
    WHERE (@sinceIso IS NULL OR (started_at IS NOT NULL AND started_at >= @sinceIso))
      AND ${providerClause(provider)}
  `
  const params: Record<string, unknown> = { sinceIso, provider }

  if (search && search.trim()) {
    sql += ` AND (project LIKE @q OR model LIKE @q)`
    params.q = `%${search.trim()}%`
  }

  if (options.model?.trim()) {
    sql += ` AND lower(model) = lower(@model)`
    params.model = options.model.trim()
  }
  if (options.day) {
    sql += ` AND substr(started_at, 1, 10) = @day`
    params.day = options.day
  }

  const sortColumns = {
    started_at: 'started_at',
    tokens_total: 'tokens_total',
    api_equiv_usd: 'api_equiv_usd',
    duration_ms: 'duration_ms'
  } as const
  const sortBy = sortColumns[options.sortBy ?? 'started_at']
  const sortDir = options.sortDir === 'asc' ? 'ASC' : 'DESC'
  params.limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  params.offset = Math.max(options.offset ?? 0, 0)
  sql += ` ORDER BY ${sortBy} ${sortDir}, id ASC LIMIT @limit OFFSET @offset`

  const rows = db.prepare(sql).all(params) as Array<
    SessionRow & { unpriced: number | boolean }
  >
  return rows.map((row) => ({
    ...row,
    model: normalizeModelName(row.provider, row.model) ?? 'Unknown',
    unpriced: Boolean(row.unpriced)
  }))
}

export function getCollectorHealth(db: Database.Database): CollectorHealth[] {
  const rows = db.prepare('SELECT * FROM collector_health').all() as Array<
    Omit<CollectorHealth, 'source_label'>
  >
  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  return providerIds().map((provider) => ({
    provider,
    // From the provider's manifest, so a newly registered provider needs no
    // change here.
    source_label: providerMeta(provider).homeLabel,
    watcher_status: 'missing',
    last_scan_at: null,
    last_success_at: null,
    last_error: null,
    sessions_seen: 0,
    last_duration_ms: null,
    ...byProvider.get(provider)
  }))
}

export function recordCollectorHealth(
  db: Database.Database,
  provider: ProviderId,
  update: Partial<Omit<CollectorHealth, 'provider' | 'source_label'>>
): void {
  const current = getCollectorHealth(db).find((row) => row.provider === provider)
  if (!current) return
  const next = { ...current, ...update, provider }
  db.prepare(
    `INSERT INTO collector_health (
       provider, watcher_status, last_scan_at, last_success_at, last_error,
       sessions_seen, last_duration_ms
     ) VALUES (
       @provider, @watcher_status, @last_scan_at, @last_success_at, @last_error,
       @sessions_seen, @last_duration_ms
     )
     ON CONFLICT(provider) DO UPDATE SET
       watcher_status = excluded.watcher_status,
       last_scan_at = excluded.last_scan_at,
       last_success_at = excluded.last_success_at,
       last_error = excluded.last_error,
       sessions_seen = excluded.sessions_seen,
       last_duration_ms = excluded.last_duration_ms`
  ).run(next)
}

/**
 * Token share per model, from events.
 *
 * A session that switched models contributes to each of them here; the
 * previous session-grain query attributed all of its tokens to whichever
 * model happened to dominate.
 */
export function getModelMix(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): ModelMixItem[] {
  const sinceMs = rangeStartMs(rangeDays, getSettings(db).timezone)

  const rows = db
    .prepare(
      `
    SELECT model, provider,
           SUM(uncached_input + cached_input + cache_creation + output) AS tokens_total
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider)}
    GROUP BY model, provider
    HAVING tokens_total > 0
    ORDER BY tokens_total DESC
  `
    )
    .all({ sinceMs, provider }) as Array<{
    model: string
    provider: ProviderId
    tokens_total: number
  }>

  const grouped = new Map<
    string,
    { model: string; provider: ProviderId; tokens_total: number }
  >()
  for (const row of rows) {
    const model = normalizeModelName(row.provider, row.model)
    if (!model) continue
    const key = `${row.provider}:${model.toLowerCase()}`
    const current = grouped.get(key)
    if (current) current.tokens_total += row.tokens_total
    else grouped.set(key, { ...row, model })
  }

  const normalized = Array.from(grouped.values()).sort(
    (a, b) => b.tokens_total - a.tokens_total
  )
  const total = normalized.reduce((sum, row) => sum + row.tokens_total, 0) || 1
  return normalized.map((row) => ({
    ...row,
    share: row.tokens_total / total
  }))
}

// Claude's primary used_pct tracks the 5h session window, which resets multiple
// times a day and is useless for a burn-rate trend. Burn rate instead follows
// the weekly (seven_day) window, carried per-snapshot inside raw_summary_json.
const CLAUDE_BURN_WINDOW_LABEL = 'Weekly (all models)'

// Exported so every burn-rate consumer (chart, projection cards, alerts) reads
// the same window instead of each re-deriving — and drifting — independently.
export function applyClaudeBurnWindow(q: QuotaSnapshot): QuotaSnapshot {
  if (q.provider !== 'claude') return q
  const weekly = q.windows?.find((w) => w.label === CLAUDE_BURN_WINDOW_LABEL)
  if (!weekly) return q
  return {
    ...q,
    used_pct: weekly.used_pct,
    remaining_pct: weekly.remaining_pct,
    reset_at: weekly.reset_at,
    window_label: CLAUDE_BURN_WINDOW_LABEL
  }
}

function claudeBurnSnapshot(q: QuotaSnapshot | undefined): QuotaSnapshot | undefined {
  return q ? applyClaudeBurnWindow(q) : q
}

function claudeWeeklyUsedPctFromRaw(raw: string | null): number | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { windows?: QuotaSnapshot['windows'] }
    const weekly = parsed.windows?.find((w) => w.label === CLAUDE_BURN_WINDOW_LABEL)
    return weekly?.used_pct ?? null
  } catch {
    return null
  }
}

export function getBurn(
  db: Database.Database,
  provider: ProviderId,
  rangeDays: RangeDays
): BurnPoint[] {
  const quotas = getLatestQuotas(db)
  const rawLatest = quotas.find((x) => x.provider === provider)
  const latest = provider === 'claude' ? claudeBurnSnapshot(rawLatest) : rawLatest

  const sinceIso = rangeStart(rangeDays, getSettings(db).timezone)?.toISOString() ?? null

  const rows = db
    .prepare(
      `
    SELECT captured_at, used_pct, raw_summary_json
    FROM quota_snapshots
    WHERE provider = @provider
      AND used_pct IS NOT NULL
      AND (@sinceIso IS NULL OR captured_at >= @sinceIso)
    ORDER BY captured_at ASC
  `
    )
    .all({ provider, sinceIso }) as Array<{
    captured_at: string
    used_pct: number
    raw_summary_json: string | null
  }>

  const history: Array<{ day: string; used_pct: number; captured_at: string }> = []
  for (const r of rows) {
    const used = provider === 'claude' ? claudeWeeklyUsedPctFromRaw(r.raw_summary_json) : r.used_pct
    if (used == null) continue
    history.push({ day: r.captured_at.slice(0, 10), used_pct: used, captured_at: r.captured_at })
  }

  const effectiveDays =
    rangeDays === 0
      ? inclusiveDaysSince(history[0]?.day ?? null)
      : rangeDays
  return buildBurnSeries(latest, history, effectiveDays)
}

export function getProjections(db: Database.Database): ProjectionCard[] {
  const quotas = getLatestQuotas(db).map(applyClaudeBurnWindow)
  const since = new Date()
  since.setDate(since.getDate() - 7)
  const sinceDay = since.toISOString().slice(0, 10)

  return quotas.map((q) => {
    const dailyRows = db
      .prepare(
        `
      SELECT day, tokens_total
      FROM usage_daily
      WHERE provider = @provider AND day >= @sinceDay
      ORDER BY day ASC
    `
      )
      .all({ provider: q.provider, sinceDay }) as Array<{
      day: string
      tokens_total: number
    }>

    return buildProjectionCard(q, dailyRows, 7)
  })
}

export function listAlerts(db: Database.Database): AlertRow[] {
  return db
    .prepare(
      `
    SELECT id, provider, level, title, body, rule_id, created_at, dismissed_at
    FROM alerts
    WHERE dismissed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 50
  `
    )
    .all() as AlertRow[]
}

export function dismissAlert(db: Database.Database, id: string): void {
  db.prepare(`UPDATE alerts SET dismissed_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    id
  )
}

export function exportAsJson(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): string {
  const settings = getSettings(db)
  const payload = {
    exported_at: new Date().toISOString(),
    filter: { provider, range_days: rangeDays },
    currency: settings.display_currency,
    locale: settings.locale,
    pricing: pricingInfo(),
    fx: fxInfo(),
    overview: getOverview(db, provider, rangeDays),
    quotas: getLatestQuotas(db).filter(
      (q) => provider === 'all' || q.provider === provider
    ),
    projections: getProjections(db).filter(
      (p) => provider === 'all' || p.provider === provider
    ),
    model_mix: getModelMix(db, provider, rangeDays),
    sessions: getSessions(db, provider, rangeDays),
    daily: getDailyUsage(db, provider, rangeDays)
  }
  return JSON.stringify(payload, null, 2)
}

export function exportAsCsv(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): string {
  const sessions = getSessions(db, provider, rangeDays)
  const daily = getDailyUsage(db, provider, rangeDays)
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }

  const sessionHeader = [
    'section',
    'id',
    'provider',
    'project',
    'model',
    'tokens_in',
    'tokens_out',
    'tokens_total',
    'tokens_cached',
    'tokens_reasoning',
    'model_calls',
    'api_equiv_usd',
    'provider_cost_usd',
    'api_duration_ms',
    'duration_ms',
    'status',
    'started_at'
  ]
  const lines = [sessionHeader.join(',')]
  for (const s of sessions) {
    lines.push(
      [
        'session',
        s.id,
        s.provider,
        s.project,
        s.model,
        s.tokens_in,
        s.tokens_out,
        s.tokens_total,
        s.tokens_cached,
        s.tokens_reasoning,
        s.model_calls,
        s.api_equiv_usd,
        s.provider_cost_usd,
        s.api_duration_ms,
        s.duration_ms,
        s.status,
        s.started_at
      ]
        .map(escape)
        .join(',')
    )
  }

  lines.push('')
  lines.push(
    ['section', 'day', 'provider', 'tokens_total', 'session_count', 'api_equiv_usd'].join(
      ','
    )
  )
  for (const d of daily) {
    lines.push(
      [
        'daily',
        d.day,
        d.provider,
        d.tokens_total,
        d.session_count,
        d.api_equiv_usd
      ]
        .map(escape)
        .join(',')
    )
  }

  // UTF-8 BOM for spreadsheet compatibility
  return `\uFEFF${lines.join('\n')}`
}
