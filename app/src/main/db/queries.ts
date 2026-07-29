import type Database from 'better-sqlite3'
import { PROVIDER_IDS, type ProviderId } from '../../shared/providers'
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
import { RATE_CARD_VERSION } from '../pricing/rates'
import { normalizeModelName } from '../collectors/models'

type ProviderFilter = ProviderId | 'all'

function providerClause(provider: ProviderFilter, column = 'provider'): string {
  return provider === 'all' ? '1=1' : `${column} = @provider`
}

function rangeStart(rangeDays: RangeDays, timezone = 'system'): Date | null {
  if (rangeDays === 0) return null
  const zone = timezone === 'system'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : timezone
  const nowParts = dateParts(new Date(), zone)
  const targetWallClock = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day - (rangeDays - 1))
  )
  let candidate = new Date(targetWallClock.getTime() - zoneOffset(targetWallClock, zone))
  candidate = new Date(targetWallClock.getTime() - zoneOffset(candidate, zone))
  return candidate
}

function dateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return { year: value('year'), month: value('month'), day: value('day') }
}

function zoneOffset(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(
    value('year'), value('month') - 1, value('day'), value('hour'),
    value('minute'), value('second')
  ) - date.getTime()
}

function dayInZone(iso: string, timezone: string): string {
  const zone = timezone === 'system'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : timezone
  const { year, month, day } = dateParts(new Date(iso), zone)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
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
  return PROVIDER_IDS.map((id) => {
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

export function getOverview(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): OverviewMetrics {
  const timezone = getSettings(db).timezone
  const sinceIso = rangeStart(rangeDays, timezone)?.toISOString() ?? null

  const row = db
    .prepare(
      `
    SELECT
      COALESCE(SUM(tokens_total), 0) AS tokens_total,
      COALESCE(SUM(api_equiv_usd), 0) AS api_equiv_usd,
      COUNT(*) AS session_count,
      MIN(COALESCE(started_at, created_at)) AS min_started_at
    FROM sessions
    WHERE (@sinceIso IS NULL OR COALESCE(started_at, created_at) >= @sinceIso)
      AND ${providerClause(provider)}
  `
    )
    .get({ sinceIso, provider }) as {
    tokens_total: number
    api_equiv_usd: number
    session_count: number
    min_started_at: string | null
  }

  const byProviderRows = db
    .prepare(
      `
    SELECT
      provider,
      COALESCE(SUM(tokens_total), 0) AS tokens_total,
      COALESCE(SUM(api_equiv_usd), 0) AS api_equiv_usd,
      COUNT(*) AS session_count
    FROM sessions
    WHERE (@sinceIso IS NULL OR COALESCE(started_at, created_at) >= @sinceIso)
      AND ${providerClause(provider)}
    GROUP BY provider
    ORDER BY tokens_total DESC
  `
    )
    .all({ sinceIso, provider }) as ProviderCost[]

  const quotas = getLatestQuotas(db).filter(
    (q) => provider === 'all' || q.provider === provider
  )
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
         COALESCE(SUM(tokens_in), 0) AS input,
         COALESCE(SUM(tokens_out), 0) AS output,
         COALESCE(SUM(tokens_cached), 0) AS cached,
         COALESCE(SUM(tokens_reasoning), 0) AS reasoning,
         COALESCE(SUM(model_calls), 0) AS model_calls
       FROM sessions
       WHERE (@sinceIso IS NULL OR COALESCE(started_at, created_at) >= @sinceIso)
         AND ${providerClause(provider)}`
    )
    .get({ sinceIso, provider }) as OverviewMetrics['token_breakdown']

  const averageDays = rangeDays === 0
    ? inclusiveDaysSince(row.min_started_at?.slice(0, 10) ?? null)
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
    rate_card_version: RATE_CARD_VERSION
  }
}

export function getDailyUsage(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): DailyUsagePoint[] {
  const timezone = getSettings(db).timezone
  const sinceIso = rangeStart(rangeDays, timezone)?.toISOString() ?? null
  const sessions = db
    .prepare(
      `
    SELECT provider, COALESCE(started_at, created_at) AS occurred_at,
           COALESCE(tokens_total, 0) AS tokens_total,
           COALESCE(api_equiv_usd, 0) AS api_equiv_usd
    FROM sessions
    WHERE (@sinceIso IS NULL OR COALESCE(started_at, created_at) >= @sinceIso)
      AND ${providerClause(provider)}
  `
    )
    .all({ sinceIso, provider }) as Array<{
      provider: ProviderId
      occurred_at: string
      tokens_total: number
      api_equiv_usd: number
    }>
  const grouped = new Map<string, DailyUsagePoint>()
  for (const session of sessions) {
    const day = dayInZone(session.occurred_at, timezone)
    const key = `${day}\u0000${session.provider}`
    const current = grouped.get(key) ?? {
      day,
      provider: session.provider,
      tokens_total: 0,
      session_count: 0,
      api_equiv_usd: 0
    }
    current.tokens_total += session.tokens_total
    current.session_count += 1
    current.api_equiv_usd += session.api_equiv_usd
    grouped.set(key, current)
  }
  return Array.from(grouped.values()).sort((a, b) => a.day.localeCompare(b.day))
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
           provider_cost_usd, api_duration_ms, duration_ms, status,
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

  const rows = db.prepare(sql).all(params) as SessionRow[]
  return rows.map((row) => ({
    ...row,
    model: normalizeModelName(row.provider, row.model) ?? 'Unknown'
  }))
}

export function getCollectorHealth(db: Database.Database): CollectorHealth[] {
  const rows = db.prepare('SELECT * FROM collector_health').all() as Array<
    Omit<CollectorHealth, 'source_label'>
  >
  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  return PROVIDER_IDS.map((provider) => ({
    provider,
    source_label: `~/.${provider === 'grok' ? 'grok' : provider}`,
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

export function getModelMix(
  db: Database.Database,
  provider: ProviderFilter,
  rangeDays: RangeDays
): ModelMixItem[] {
  const sinceIso = rangeStart(rangeDays, getSettings(db).timezone)?.toISOString() ?? null

  const rows = db
    .prepare(
      `
    SELECT model, provider, COALESCE(SUM(tokens_total), 0) AS tokens_total
    FROM sessions
    WHERE (@sinceIso IS NULL OR (started_at IS NOT NULL AND started_at >= @sinceIso))
      AND ${providerClause(provider)}
      AND tokens_total IS NOT NULL
      AND tokens_total > 0
      AND lower(trim(model)) NOT IN ('unknown', 'auto', 'default', '')
    GROUP BY model, provider
    ORDER BY tokens_total DESC
  `
    )
    .all({ sinceIso, provider }) as Array<{
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

export function getBurn(
  db: Database.Database,
  provider: ProviderId,
  rangeDays: RangeDays
): BurnPoint[] {
  const quotas = getLatestQuotas(db)
  const latest = quotas.find((x) => x.provider === provider)

  const sinceIso = rangeStart(rangeDays, getSettings(db).timezone)?.toISOString() ?? null

  const rows = db
    .prepare(
      `
    SELECT captured_at, used_pct
    FROM quota_snapshots
    WHERE provider = @provider
      AND used_pct IS NOT NULL
      AND (@sinceIso IS NULL OR captured_at >= @sinceIso)
    ORDER BY captured_at ASC
  `
    )
    .all({ provider, sinceIso }) as Array<{ captured_at: string; used_pct: number }>

  const history = rows.map((r) => ({
    day: r.captured_at.slice(0, 10),
    used_pct: r.used_pct,
    captured_at: r.captured_at
  }))

  const effectiveDays =
    rangeDays === 0
      ? inclusiveDaysSince(history[0]?.day ?? null)
      : rangeDays
  return buildBurnSeries(latest, history, effectiveDays)
}

export function getProjections(db: Database.Database): ProjectionCard[] {
  const quotas = getLatestQuotas(db)
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
    rate_card_version: RATE_CARD_VERSION,
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
