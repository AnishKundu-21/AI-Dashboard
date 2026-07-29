import type Database from 'better-sqlite3'
import type { QuotaSnapshot, SessionRow } from '../../shared/types'
import { redactDeep } from '../util/redact'

export function insertQuotaSnapshot(
  db: Database.Database,
  snap: QuotaSnapshot
): void {
  const summary = redactDeep({
    products: snap.products ?? null,
    windows: snap.windows ?? null,
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
      tokens_cached, tokens_reasoning, model_calls, api_equiv_usd,
      provider_cost_usd, api_duration_ms, duration_ms, status, started_at,
      ended_at, source, machine_id, created_at
    ) VALUES (
      @id, @provider, @project, @model, @tokens_in, @tokens_out, @tokens_total,
      @tokens_cached, @tokens_reasoning, @model_calls, @api_equiv_usd,
      @provider_cost_usd, @api_duration_ms, @duration_ms, @status, @started_at,
      @ended_at, @source, @machine_id, @created_at
    )
    ON CONFLICT(id) DO UPDATE SET
      project = excluded.project,
      model = excluded.model,
      tokens_in = COALESCE(excluded.tokens_in, sessions.tokens_in),
      tokens_out = COALESCE(excluded.tokens_out, sessions.tokens_out),
      tokens_total = COALESCE(excluded.tokens_total, sessions.tokens_total),
      tokens_cached = COALESCE(excluded.tokens_cached, sessions.tokens_cached),
      tokens_reasoning = COALESCE(excluded.tokens_reasoning, sessions.tokens_reasoning),
      model_calls = COALESCE(excluded.model_calls, sessions.model_calls),
      api_equiv_usd = COALESCE(excluded.api_equiv_usd, sessions.api_equiv_usd),
      provider_cost_usd = COALESCE(excluded.provider_cost_usd, sessions.provider_cost_usd),
      api_duration_ms = COALESCE(excluded.api_duration_ms, sessions.api_duration_ms),
      duration_ms = COALESCE(excluded.duration_ms, sessions.duration_ms),
      status = excluded.status,
      started_at = COALESCE(excluded.started_at, sessions.started_at),
      ended_at = COALESCE(excluded.ended_at, sessions.ended_at),
      source = excluded.source
  `
  )

  const now = new Date().toISOString()
  let count = 0
  const affected = new Set<string>()
  const existing = db.prepare(
    `SELECT provider, substr(COALESCE(started_at, created_at), 1, 10) AS day
     FROM sessions WHERE id = ?`
  )

  const tx = db.transaction((rows: SessionRow[]) => {
    for (const s of rows) {
      const previous = existing.get(s.id) as
        | { provider: string; day: string | null }
        | undefined
      if (previous?.day) affected.add(`${previous.provider}\u0000${previous.day}`)
      insert.run({
        id: s.id,
        provider: s.provider,
        project: s.project,
        model: s.model,
        tokens_in: s.tokens_in,
        tokens_out: s.tokens_out,
        tokens_total: s.tokens_total,
        tokens_cached: s.tokens_cached ?? null,
        tokens_reasoning: s.tokens_reasoning ?? null,
        model_calls: s.model_calls ?? null,
        api_equiv_usd: s.api_equiv_usd,
        provider_cost_usd: s.provider_cost_usd ?? null,
        api_duration_ms: s.api_duration_ms ?? null,
        duration_ms: s.duration_ms,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        source: s.source,
        machine_id: 'local',
        created_at: now
      })
      const current = existing.get(s.id) as {
        provider: string
        day: string | null
      }
      if (current.day) affected.add(`${current.provider}\u0000${current.day}`)
      count++
    }
    recomputeAffectedDays(db, affected)
  })
  tx(sessions)

  return count
}

function recomputeAffectedDays(
  db: Database.Database,
  affected: Set<string>
): void {
  const aggregate = db.prepare(
    `SELECT
       COALESCE(SUM(tokens_total), 0) AS tokens_total,
       COUNT(*) AS session_count,
       COALESCE(SUM(api_equiv_usd), 0) AS api_equiv_usd
     FROM sessions
     WHERE provider = ?
       AND substr(COALESCE(started_at, created_at), 1, 10) = ?`
  )
  const upsertDaily = db.prepare(
    `INSERT INTO usage_daily (day, provider, tokens_total, session_count, api_equiv_usd)
     VALUES (@day, @provider, @tokens_total, @session_count, @api_equiv_usd)
     ON CONFLICT(day, provider) DO UPDATE SET
       tokens_total = excluded.tokens_total,
       session_count = excluded.session_count,
       api_equiv_usd = excluded.api_equiv_usd`
  )
  const deleteDaily = db.prepare(
    'DELETE FROM usage_daily WHERE provider = ? AND day = ?'
  )

  for (const key of affected) {
    const [provider, day] = key.split('\u0000')
    if (!day || day.length < 10) continue
    const row = aggregate.get(provider, day) as {
      tokens_total: number
      session_count: number
      api_equiv_usd: number
    }
    if (row.session_count === 0) deleteDaily.run(provider, day)
    else upsertDaily.run({ provider, day, ...row })
  }
}
