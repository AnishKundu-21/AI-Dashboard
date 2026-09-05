import type Database from 'better-sqlite3'
import {
  enabledProviderIds,
  isProviderEnabled,
  providerMeta,
  type ProviderId
} from '../../shared/providers'
import type {
  AlertRow,
  AnalyticsPeriodInput,
  AnalyticsSnapshot,
  AnalyticsTotals,
  AnalyticsWindow,
  AppSettings,
  BurnPoint,
  BurnSeries,
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
import {
  makeDayFormatter,
  rangeStartMs,
  resolveAnalyticsPeriod,
  resolveTimeZone,
  type ResolvedAnalyticsWindow
} from '../util/time'
import { normalizeModelName } from '../collectors/models'

type ProviderFilter = ProviderId | 'all'

function providerClause(
  provider: ProviderFilter,
  enabled: readonly ProviderId[],
  column = 'provider'
): string {
  if (provider !== 'all') {
    return enabled.includes(provider)
      ? `${column} = @provider`
      : '@provider IS NOT NULL AND 0=1'
  }
  if (enabled.length === 0) return '@provider IS NOT NULL AND 0=1'

  // Provider ids come from the internal registry and are constrained to
  // lowercase slugs. Quoting them here keeps call-site parameter objects
  // unchanged while allowing an arbitrary enabled subset.
  return `@provider IS NOT NULL AND ${column} IN (${enabled
    .map((id) => `'${id}'`)
    .join(', ')})`
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
    // Do not force an onboarding tour onto an existing installation that has
    // never changed a setting. A missing row is the one reliable first-run
    // signal; once settings are written, the schema default keeps old rows
    // backward-compatible.
    return AppSettingsSchema.parse({ onboarding_completed: false })
  }
  const parsed = AppSettingsSchema.parse(JSON.parse(row.value))
  // Rows written before onboarding existed represent an established install,
  // so they should not interrupt an existing user's dashboard with a tour.
  return { ...parsed, onboarding_completed: parsed.onboarding_completed ?? true }
}

type AnalyticsTotalsWithFirstEvent = AnalyticsTotals & { min_ts_ms: number | null }

/**
 * Event-grain totals for one exact half-open time range. Both the standard
 * overview and the analytics comparison call this so neither can drift at a
 * timezone boundary.
 */
function getAnalyticsTotalsInRange(
  db: Database.Database,
  provider: ProviderFilter,
  enabled: readonly ProviderId[],
  startMs: number | null,
  endMs: number | null
): AnalyticsTotalsWithFirstEvent {
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
      COALESCE(SUM(uncached_input), 0) AS uncached_input,
      COALESCE(SUM(cached_input), 0) AS cached_input,
      COALESCE(SUM(cache_creation), 0) AS cache_creation,
      COALESCE(SUM(output), 0) AS output,
      COALESCE(SUM(reasoning), 0) AS reasoning,
      COUNT(*) AS model_calls,
      MIN(ts_ms) AS min_ts_ms
    FROM usage_events
    WHERE (@startMs IS NULL OR ts_ms >= @startMs)
      AND (@endMs IS NULL OR ts_ms < @endMs)
      AND ${providerClause(provider, enabled)}
  `
    )
    .get({ startMs, endMs, provider }) as {
    tokens_total: number
    api_equiv_usd: number
    session_count: number
    cache_savings_usd: number
    unpriced_sessions: number
    uncached_input: number
    cached_input: number
    cache_creation: number
    output: number
    reasoning: number
    model_calls: number
    min_ts_ms: number | null
  }

  return {
    tokens_total: row.tokens_total,
    api_equiv_usd: row.api_equiv_usd,
    session_count: row.session_count,
    cache_savings_usd: row.cache_savings_usd,
    unpriced_sessions: row.unpriced_sessions,
    token_breakdown: {
      uncached_input: row.uncached_input,
      cached_input: row.cached_input,
      cache_creation: row.cache_creation,
      output: row.output,
      reasoning: row.reasoning,
      model_calls: row.model_calls
    },
    min_ts_ms: row.min_ts_ms
  }
}

function analyticsWindow(
  window: ResolvedAnalyticsWindow,
  timezone: string
): AnalyticsWindow {
  if (!window.startDay || !window.endDay) {
    return { start_day: null, end_day: null, days: null, timezone, label: 'Lifetime' }
  }
  const label = window.startDay === window.endDay
    ? window.startDay
    : `${window.startDay} – ${window.endDay}`
  return {
    start_day: window.startDay,
    end_day: window.endDay,
    days: window.days,
    timezone,
    label
  }
}

export function setSettings(
  db: Database.Database,
  partial: Partial<AppSettings>
): AppSettings {
  const current = getSettings(db)
  const next = AppSettingsSchema.parse({
    ...current,
    ...partial,
    enabled_providers: {
      ...current.enabled_providers,
      ...partial.enabled_providers
    },
    plans: { ...current.plans, ...partial.plans }
  })
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)`).run(
    JSON.stringify(next)
  )
  return next
}

export function getLatestQuotas(db: Database.Database): QuotaSnapshot[] {
  const enabled = enabledProviderIds(getSettings(db))
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
    let quotaWindows: QuotaSnapshot['quota_windows']
    let unavailable: QuotaSnapshot['unavailable']
    let transport: QuotaSnapshot['transport']
    let resetCredits: QuotaSnapshot['reset_credits']
    let remainingText: string | undefined
    if (typeof r.raw_summary_json === 'string' && r.raw_summary_json) {
      try {
        const parsed = JSON.parse(r.raw_summary_json) as {
          products?: Record<string, number>
          windows?: QuotaSnapshot['windows']
          quota_windows?: QuotaSnapshot['quota_windows']
          unavailable?: QuotaSnapshot['unavailable']
          transport?: QuotaSnapshot['transport']
          reset_credits?: QuotaSnapshot['reset_credits']
          remaining_text?: string
        }
        products = parsed.products ?? undefined
        windows = parsed.windows ?? undefined
        quotaWindows = parsed.quota_windows ?? undefined
        unavailable = parsed.unavailable ?? undefined
        transport = parsed.transport ?? undefined
        resetCredits = parsed.reset_credits ?? undefined
        remainingText = parsed.remaining_text ?? undefined
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
      products,
      quota_windows: quotaWindows,
      unavailable,
      transport,
      reset_credits: resetCredits,
      remaining_text: remainingText
    })
  }

  // Ensure every enabled provider appears, even before its first snapshot.
  return enabled.map((id) => {
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
  const settings = getSettings(db)
  const timezone = settings.timezone
  const enabled = enabledProviderIds(settings)
  const sinceMs = rangeStartMs(rangeDays, timezone)
  const row = getAnalyticsTotalsInRange(db, provider, enabled, sinceMs, null)

  const byProviderRows = db
    .prepare(
      `
    SELECT
      provider,
      COALESCE(SUM(uncached_input + cached_input + cache_creation + output), 0) AS tokens_total,
      COALESCE(SUM(uncached_input), 0) AS uncached_input,
      COALESCE(SUM(cached_input), 0) AS cached_input,
      COALESCE(SUM(cache_creation), 0) AS cache_creation,
      COALESCE(SUM(output), 0) AS output,
      COALESCE(SUM(reasoning), 0) AS reasoning,
      COUNT(*) AS model_calls,
      COALESCE(SUM(cost_usd), 0) AS api_equiv_usd,
      COALESCE(SUM(reported_cost_usd), 0) AS provider_cost_usd,
      COALESCE(SUM(cache_savings_usd), 0) AS cache_savings_usd,
      COUNT(CASE WHEN cost_usd IS NULL THEN 1 END) AS unpriced_calls,
      COUNT(DISTINCT session_id) AS session_count
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider, enabled)}
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
    token_breakdown: row.token_breakdown,
    by_provider: byProviderRows,
    cache_savings_usd: row.cache_savings_usd,
    unpriced_sessions: row.unpriced_sessions,
    pricing: pricingInfo(),
    fx: fxInfo()
  }
}

/**
 * The public analytics seam for selected-period comparisons. It returns raw
 * observed totals for adjacent windows; percentages and trend copy belong in
 * the renderer so zero baselines can be shown as "new" rather than infinity.
 */
export function getAnalyticsSnapshot(
  db: Database.Database,
  input: AnalyticsPeriodInput & { provider: ProviderFilter },
  nowMs: number = Date.now()
): AnalyticsSnapshot {
  const settings = getSettings(db)
  const timezone = resolveTimeZone(settings.timezone)
  const enabled = enabledProviderIds(settings)
  const period = resolveAnalyticsPeriod(input, timezone, nowMs)
  const current = getAnalyticsTotalsInRange(
    db,
    input.provider,
    enabled,
    period.current.startMs,
    period.current.endMs
  )
  const previous = period.previous
    ? {
        window: analyticsWindow(period.previous, timezone),
        totals: getAnalyticsTotalsInRange(
          db,
          input.provider,
          enabled,
          period.previous.startMs,
          period.previous.endMs
        )
      }
    : null

  // `min_ts_ms` is only needed for lifetime averages in getOverview; snapshots
  // deliberately expose the stable, user-comparable metric contract instead.
  const { min_ts_ms: _currentFirstEvent, ...currentTotals } = current
  if (previous) {
    const { min_ts_ms: _previousFirstEvent, ...previousTotals } = previous.totals
    return {
      window: analyticsWindow(period.current, timezone),
      current: currentTotals,
      previous: { window: previous.window, totals: previousTotals }
    }
  }
  return {
    window: analyticsWindow(period.current, timezone),
    current: currentTotals,
    previous: null
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
  const settings = getSettings(db)
  const timezone = settings.timezone
  const enabled = enabledProviderIds(settings)
  const sinceMs = rangeStartMs(rangeDays, timezone)
  const dayOf = makeDayFormatter(timezone)

  const rows = db
    .prepare(
      `
    SELECT provider, ts_ms, session_id,
           uncached_input, cached_input, cache_creation, output, reasoning,
           (uncached_input + cached_input + cache_creation + output) AS tokens_total,
           COALESCE(cost_usd, 0) AS api_equiv_usd,
           COALESCE(reported_cost_usd, 0) AS provider_cost_usd,
           COALESCE(cache_savings_usd, 0) AS cache_savings_usd,
           CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END AS unpriced_calls
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider, enabled)}
  `
    )
    .all({ sinceMs, provider }) as Array<{
      provider: ProviderId
      ts_ms: number
      session_id: string
      tokens_total: number
      uncached_input: number
      cached_input: number
      cache_creation: number
      output: number
      reasoning: number
      api_equiv_usd: number
      provider_cost_usd: number
      cache_savings_usd: number
      unpriced_calls: number
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
        uncached_input: 0,
        cached_input: 0,
        cache_creation: 0,
        output: 0,
        reasoning: 0,
        model_calls: 0,
        session_count: 0,
        api_equiv_usd: 0,
        provider_cost_usd: 0,
        cache_savings_usd: 0,
        unpriced_calls: 0,
        sessions: new Set<string>()
      }
      grouped.set(key, current)
    }
    current.tokens_total += row.tokens_total
    current.uncached_input += row.uncached_input
    current.cached_input += row.cached_input
    current.cache_creation += row.cache_creation
    current.output += row.output
    current.reasoning += row.reasoning
    current.model_calls += 1
    current.api_equiv_usd += row.api_equiv_usd
    current.provider_cost_usd += row.provider_cost_usd
    current.cache_savings_usd += row.cache_savings_usd
    current.unpriced_calls += row.unpriced_calls
    current.sessions.add(row.session_id)
  }

  return Array.from(grouped.values())
    .map(({ sessions, ...point }) => ({
      ...point,
      // A session active on two days counts once on each, which is what the
      // chart is asking for.
      session_count: sessions.size,
      api_equiv_usd: Math.round(point.api_equiv_usd * 1e6) / 1e6,
      provider_cost_usd: Math.round(point.provider_cost_usd * 1e6) / 1e6,
      cache_savings_usd: Math.round(point.cache_savings_usd * 1e6) / 1e6
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
  const settings = getSettings(db)
  const enabled = enabledProviderIds(settings)
  const sinceIso = rangeStart(rangeDays, settings.timezone)?.toISOString() ?? null

  let sql = `
    SELECT id, provider, project, model, tokens_in, tokens_out, tokens_total,
           tokens_cached, tokens_reasoning, model_calls, api_equiv_usd,
           provider_cost_usd, api_duration_ms, cache_savings_usd,
           unpriced, duration_ms, status,
           started_at, ended_at, source
    FROM sessions
    WHERE (@sinceIso IS NULL OR (started_at IS NOT NULL AND started_at >= @sinceIso))
      AND ${providerClause(provider, enabled)}
  `
  const params: Record<string, unknown> = { sinceIso, provider }

  if (search && search.trim()) {
    sql += ` AND (project LIKE @q OR model LIKE @q)`
    params.q = `%${search.trim()}%`
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
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const offset = Math.max(options.offset ?? 0, 0)
  sql += ` ORDER BY ${sortBy} ${sortDir}, id ASC`
  // Model names are normalised for display (provider prefixes and dated
  // aliases collapse together), so an exact SQL comparison against the raw
  // transcript id would make clicking an analytics model return no sessions.
  // For a model drill-down, normalise first and paginate the matching rows.
  if (!options.model?.trim()) {
    params.limit = limit
    params.offset = offset
    sql += ` LIMIT @limit OFFSET @offset`
  }

  const rows = db.prepare(sql).all(params) as Array<
    SessionRow & { unpriced: number | boolean }
  >
  const normalized = rows.map((row) => ({
    ...row,
    model: normalizeModelName(row.provider, row.model) ?? 'Unknown',
    unpriced: Boolean(row.unpriced)
  }))
  const selectedModel = options.model?.trim().toLocaleLowerCase()
  return selectedModel
    ? normalized
        .filter((row) => row.model.toLocaleLowerCase() === selectedModel)
        .slice(offset, offset + limit)
    : normalized
}

export function getCollectorHealth(db: Database.Database): CollectorHealth[] {
  const rows = db.prepare('SELECT * FROM collector_health').all() as Array<
    Omit<CollectorHealth, 'source_label'>
  >
  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  return enabledProviderIds(getSettings(db)).map((provider) => ({
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
  const settings = getSettings(db)
  const enabled = enabledProviderIds(settings)
  const sinceMs = rangeStartMs(rangeDays, settings.timezone)

  const rows = db
    .prepare(
      `
    SELECT model, provider, session_id,
           SUM(uncached_input + cached_input + cache_creation + output) AS tokens_total,
           SUM(uncached_input) AS uncached_input,
           SUM(cached_input) AS cached_input,
           SUM(cache_creation) AS cache_creation,
           SUM(output) AS output,
           SUM(reasoning) AS reasoning,
           COUNT(*) AS model_calls,
           COALESCE(SUM(cost_usd), 0) AS api_equiv_usd,
           COALESCE(SUM(reported_cost_usd), 0) AS provider_cost_usd,
           COALESCE(SUM(cache_savings_usd), 0) AS cache_savings_usd,
           COUNT(CASE WHEN cost_usd IS NULL THEN 1 END) AS unpriced_calls
    FROM usage_events
    WHERE (@sinceMs IS NULL OR ts_ms >= @sinceMs)
      AND ${providerClause(provider, enabled)}
    GROUP BY model, provider, session_id
    HAVING tokens_total > 0
    ORDER BY tokens_total DESC
  `
    )
    .all({ sinceMs, provider }) as Array<{
    model: string
    provider: ProviderId
    session_id: string
    tokens_total: number
    uncached_input: number
    cached_input: number
    cache_creation: number
    output: number
    reasoning: number
    model_calls: number
    api_equiv_usd: number
    provider_cost_usd: number
    cache_savings_usd: number
    unpriced_calls: number
  }>

  const grouped = new Map<
    string,
    Omit<ModelMixItem, 'share'> & { sessions: Set<string> }
  >()
  for (const row of rows) {
    const model = normalizeModelName(row.provider, row.model)
    if (!model) continue
    const key = `${row.provider}:${model.toLowerCase()}`
    const current = grouped.get(key)
    if (current) {
      current.tokens_total += row.tokens_total
      current.uncached_input += row.uncached_input
      current.cached_input += row.cached_input
      current.cache_creation += row.cache_creation
      current.output += row.output
      current.reasoning += row.reasoning
      current.model_calls += row.model_calls
      current.api_equiv_usd += row.api_equiv_usd
      current.provider_cost_usd += row.provider_cost_usd
      current.cache_savings_usd += row.cache_savings_usd
      current.unpriced_calls += row.unpriced_calls
      current.sessions.add(row.session_id)
    }
    else {
      const { session_id, ...totals } = row
      grouped.set(key, { ...totals, model, session_count: 1, sessions: new Set([session_id]) })
    }
  }

  const normalized = Array.from(grouped.values()).map(({ sessions, ...row }) => ({
    ...row,
    session_count: sessions.size
  })).sort(
    (a, b) => b.tokens_total - a.tokens_total
  )
  const total = normalized.reduce((sum, row) => sum + row.tokens_total, 0) || 1
  return normalized.map((row) => ({
    ...row,
    share: row.tokens_total / total
  }))
}

type BurnWindow = {
  label: string
  used_pct: number | null
  remaining_pct: number | null
  reset_at: string | null
}

/** Prefer the provider's aggregate weekly allowance over short session windows. */
function preferredWeeklyWindow(q: Pick<QuotaSnapshot, 'quota_windows' | 'windows'>): BurnWindow | undefined {
  const normalized = q.quota_windows?.filter((window) => window.kind === 'weekly') ?? []
  const normalizedWeekly =
    normalized.find((window) =>
      /all.models|seven.day/i.test(`${window.id} ${window.label}`)
    ) ?? normalized[0]
  if (normalizedWeekly) {
    return {
      label: normalizedWeekly.label,
      used_pct: normalizedWeekly.used_pct,
      remaining_pct:
        normalizedWeekly.used_pct == null ? null : 100 - normalizedWeekly.used_pct,
      reset_at: normalizedWeekly.resets_at
    }
  }

  const legacy = q.windows?.filter((window) => /week/i.test(window.label)) ?? []
  return legacy.find((window) => /all.models/i.test(window.label)) ?? legacy[0]
}

// Exported so projections, alerts, and graph history cannot accidentally mix
// a five-hour/session percentage with a weekly runway calculation.
export function applyBurnWindow(q: QuotaSnapshot): QuotaSnapshot {
  const weekly = preferredWeeklyWindow(q)
  if (!weekly) return q
  return {
    ...q,
    used_pct: weekly.used_pct,
    remaining_pct: weekly.remaining_pct,
    reset_at: weekly.reset_at,
    window_label: weekly.label
  }
}

/** Retained for callers that specifically want Claude's historical behaviour. */
export function applyClaudeBurnWindow(q: QuotaSnapshot): QuotaSnapshot {
  return q.provider === 'claude' ? applyBurnWindow(q) : q
}

function burnUsedPctFromRaw(raw: string | null, fallback: number): number {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as {
      windows?: QuotaSnapshot['windows']
      quota_windows?: QuotaSnapshot['quota_windows']
    }
    return preferredWeeklyWindow(parsed)?.used_pct ?? fallback
  } catch {
    return fallback
  }
}

export function getBurn(
  db: Database.Database,
  provider: ProviderId,
  rangeDays: RangeDays
): BurnPoint[] {
  if (!isProviderEnabled(getSettings(db), provider)) return []
  const quotas = getLatestQuotas(db)
  const rawLatest = quotas.find((x) => x.provider === provider)
  const latest = rawLatest ? applyBurnWindow(rawLatest) : rawLatest

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
    const used = burnUsedPctFromRaw(r.raw_summary_json, r.used_pct)
    history.push({ day: r.captured_at.slice(0, 10), used_pct: used, captured_at: r.captured_at })
  }

  const effectiveDays =
    rangeDays === 0
      ? inclusiveDaysSince(history[0]?.day ?? null)
      : rangeDays
  return buildBurnSeries(latest, history, effectiveDays)
}

type StoredBurnWindow = BurnWindow & { id: string }

function weeklyWindowsFromStored(
  raw: string | null,
  fallback: { used_pct: number; reset_at: string | null; window_label: string | null }
): StoredBurnWindow[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        quota_windows?: QuotaSnapshot['quota_windows']
        windows?: QuotaSnapshot['windows']
      }
      const normalized = (parsed.quota_windows ?? [])
        .filter((window) => window.kind === 'weekly' && window.used_pct != null)
        .map((window) => ({
          id: window.id,
          label: window.label,
          used_pct: window.used_pct,
          remaining_pct: 100 - (window.used_pct ?? 0),
          reset_at: window.resets_at
        }))
      if (normalized.length > 0) return normalized

      const legacy = (parsed.windows ?? [])
        .filter((window) => /week/i.test(window.label) && window.used_pct != null)
        .map((window) => ({
          id: window.label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          ...window
        }))
      if (legacy.length > 0) return legacy
    } catch {
      // The primary columns below still preserve the provider-wide window.
    }
  }

  if (fallback.window_label && /week/i.test(fallback.window_label)) {
    return [{
      id: 'weekly',
      label: fallback.window_label,
      used_pct: fallback.used_pct,
      remaining_pct: 100 - fallback.used_pct,
      reset_at: fallback.reset_at
    }]
  }
  return []
}

function burnSeriesLabel(provider: ProviderId, windowLabel: string): string {
  const scope = windowLabel.match(/\(([^)]+)\)/)?.[1]
  if (scope) {
    const displayScope = scope.toLowerCase() === 'all models' ? 'All models' : scope
    return `${providerMeta(provider).short} · ${displayScope}`
  }
  return providerMeta(provider).name
}

/**
 * Every aggregate weekly quota stream retained by the providers. Claude can
 * expose all-model, Opus, and Sonnet windows; Codex and Grok normally expose
 * one provider-wide weekly stream.
 */
export function getBurnSeries(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): BurnSeries[] {
  const settings = getSettings(db)
  const enabled = enabledProviderIds(settings).filter((id) => providerMeta(id).reportsQuota)
  const selected = provider === 'all' ? enabled : enabled.filter((id) => id === provider)
  const sinceIso = rangeStart(rangeDays, settings.timezone)?.toISOString() ?? null
  const latestByProvider = new Map(getLatestQuotas(db).map((quota) => [quota.provider, quota]))
  const result: BurnSeries[] = []

  for (const id of selected) {
    const rows = db.prepare(`
      SELECT captured_at, used_pct, reset_at, window_label, raw_summary_json
      FROM quota_snapshots
      WHERE provider = @provider
        AND used_pct IS NOT NULL
        AND (@sinceIso IS NULL OR captured_at >= @sinceIso)
      ORDER BY captured_at ASC
    `).all({ provider: id, sinceIso }) as Array<{
      captured_at: string
      used_pct: number
      reset_at: string | null
      window_label: string | null
      raw_summary_json: string | null
    }>

    const grouped = new Map<string, {
      id: string
      label: string
      samples: Array<{
        day: string
        captured_at: string
        used_pct: number
        reset_at: string | null
      }>
    }>()

    for (const row of rows) {
      for (const window of weeklyWindowsFromStored(row.raw_summary_json, row)) {
        const key = window.label.toLowerCase()
        const group = grouped.get(key) ?? { id: window.id, label: window.label, samples: [] }
        group.samples.push({
          day: row.captured_at.slice(0, 10),
          captured_at: row.captured_at,
          used_pct: window.used_pct ?? row.used_pct,
          reset_at: window.reset_at
        })
        grouped.set(key, group)
      }
    }

    for (const group of grouped.values()) {
      const latest = group.samples.at(-1)
      if (!latest) continue
      const base = latestByProvider.get(id)
      const snapshot: QuotaSnapshot = {
        ...(base ?? {
          provider: id,
          plan_label: null,
          plan_source: 'unknown',
          confidence: 'live',
          source: 'quota history',
          auth_connected: true
        }),
        captured_at: latest.captured_at,
        used_pct: latest.used_pct,
        remaining_pct: 100 - latest.used_pct,
        reset_at: latest.reset_at,
        window_label: group.label
      }
      const effectiveDays = rangeDays === 0
        ? inclusiveDaysSince(group.samples[0]?.day ?? null)
        : rangeDays
      result.push({
        id: `${id}:${group.id}`,
        provider: id,
        label: burnSeriesLabel(id, group.label),
        points: buildBurnSeries(snapshot, group.samples, effectiveDays)
      })
    }
  }

  return result
}

export function getProjections(db: Database.Database): ProjectionCard[] {
  const quotas = getLatestQuotas(db)
    .filter((quota) => providerMeta(quota.provider).reportsQuota)
    .map(applyBurnWindow)
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
  const enabled = new Set(enabledProviderIds(getSettings(db)))
  const rows = db
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
  return rows.filter((alert) => !alert.provider || enabled.has(alert.provider))
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
    [
      'section',
      'day',
      'provider',
      'tokens_total',
      'uncached_input',
      'cached_input',
      'cache_creation',
      'output',
      'reasoning',
      'model_calls',
      'session_count',
      'api_equiv_usd',
      'provider_cost_usd',
      'cache_savings_usd',
      'unpriced_calls'
    ].join(',')
  )
  for (const d of daily) {
    lines.push(
      [
        'daily',
        d.day,
        d.provider,
        d.tokens_total,
        d.uncached_input,
        d.cached_input,
        d.cache_creation,
        d.output,
        d.reasoning,
        d.model_calls,
        d.session_count,
        d.api_equiv_usd,
        d.provider_cost_usd,
        d.cache_savings_usd,
        d.unpriced_calls
      ]
        .map(escape)
        .join(',')
    )
  }

  // UTF-8 BOM for spreadsheet compatibility
  return `\uFEFF${lines.join('\n')}`
}
