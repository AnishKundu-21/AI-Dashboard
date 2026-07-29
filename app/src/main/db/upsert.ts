import type Database from 'better-sqlite3'
import type { QuotaSnapshot, SessionRow } from '../../shared/types'
import { redactDeep } from '../util/redact'

export function insertQuotaSnapshot(
  db: Database.Database,
  snap: QuotaSnapshot
): void {
  const summary = redactDeep({
    products: snap.products ?? null,
    remaining_text: snap.remaining_text ?? null,
    plan_label: snap.plan_label,
    plan_source: snap.plan_source,
    confidence: snap.confidence
  })

  db.prepare(
    `
    INSERT INTO quota_snapshots (
      provider, captured_at, used_pct, remaining_pct, reset_at, window_label,
      plan_label, plan_source, confidence, source, auth_connected, stale,
      live_captured_at, raw_summary_json
    ) VALUES (
      @provider, @captured_at, @used_pct, @remaining_pct, @reset_at, @window_label,
      @plan_label, @plan_source, @confidence, @source, @auth_connected, @stale,
      @live_captured_at, @raw_summary_json
    )
  `
  ).run({
    provider: snap.provider,
    captured_at: snap.captured_at,
    used_pct: snap.used_pct,
    remaining_pct: snap.remaining_pct,
    reset_at: snap.reset_at,
    window_label: snap.window_label,
    plan_label: snap.plan_label,
    plan_source: snap.plan_source,
    confidence: snap.confidence,
    source: snap.source,
    auth_connected: snap.auth_connected ? 1 : 0,
    stale: snap.stale ? 1 : 0,
    live_captured_at:
      snap.live_captured_at ??
      (snap.confidence === 'live' && !snap.stale ? snap.captured_at : null),
    raw_summary_json: JSON.stringify(summary)
  })
}

export function upsertSessions(
  db: Database.Database,
  sessions: SessionRow[]
): number {
  if (sessions.length === 0) return 0

  const insert = db.prepare(
    `
    INSERT INTO sessions (
      id, provider, project, model, tokens_in, tokens_out, tokens_total,
      api_equiv_usd, duration_ms, status, started_at, ended_at, source, machine_id, created_at
    ) VALUES (
      @id, @provider, @project, @model, @tokens_in, @tokens_out, @tokens_total,
      @api_equiv_usd, @duration_ms, @status, @started_at, @ended_at, @source, @machine_id, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      project = excluded.project,
      model = excluded.model,
      tokens_in = COALESCE(excluded.tokens_in, sessions.tokens_in),
      tokens_out = COALESCE(excluded.tokens_out, sessions.tokens_out),
      tokens_total = COALESCE(excluded.tokens_total, sessions.tokens_total),
      api_equiv_usd = COALESCE(excluded.api_equiv_usd, sessions.api_equiv_usd),
      duration_ms = COALESCE(excluded.duration_ms, sessions.duration_ms),
      status = excluded.status,
      started_at = COALESCE(excluded.started_at, sessions.started_at),
      ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
      source = excluded.source
  `
  )

  // Track previous totals so we can recompute daily from sessions for that day+provider
  const now = new Date().toISOString()
  let count = 0

  const tx = db.transaction((rows: SessionRow[]) => {
    for (const s of rows) {
      insert.run({
        id: s.id,
        provider: s.provider,
        project: s.project,
        model: s.model,
        tokens_in: s.tokens_in,
        tokens_out: s.tokens_out,
        tokens_total: s.tokens_total,
        api_equiv_usd: s.api_equiv_usd,
        duration_ms: s.duration_ms,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        source: s.source,
        machine_id: 'local',
        created_at: now
      })
      count++
    }
  })
  tx(sessions)

  // Rebuild daily rollups for affected days from sessions table (provider-scoped live sources)
  recomputeDailyFromSessions(db)

  return count
}

function recomputeDailyFromSessions(db: Database.Database): void {
  // Recompute all retained history so 180d, 365d, and lifetime stay accurate.
  const rows = db
    .prepare(
      `
    SELECT
      substr(COALESCE(started_at, created_at), 1, 10) AS day,
      provider,
      COALESCE(SUM(tokens_total), 0) AS tokens_total,
      COUNT(*) AS session_count,
      COALESCE(SUM(api_equiv_usd), 0) AS api_equiv_usd
    FROM sessions
    WHERE COALESCE(started_at, created_at) IS NOT NULL
    GROUP BY day, provider
  `
    )
    .all() as Array<{
    day: string
    provider: string
    tokens_total: number
    session_count: number
    api_equiv_usd: number
  }>

  const insertDaily = db.prepare(
    `INSERT INTO usage_daily (day, provider, tokens_total, session_count, api_equiv_usd)
     VALUES (@day, @provider, @tokens_total, @session_count, @api_equiv_usd)`
  )
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM usage_daily').run()
    for (const row of rows) {
      if (!row.day || row.day.length < 10) continue
      insertDaily.run(row)
    }
  })
  replace()
}
