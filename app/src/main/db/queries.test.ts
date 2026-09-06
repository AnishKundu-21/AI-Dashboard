import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import {
  applyBurnWindow,
  applyClaudeBurnWindow,
  exportAsJson,
  getAnalyticsSnapshot,
  getBurn,
  getBurnSeries,
  getDailyUsage,
  getOverview,
  getProjections,
  getLatestQuotas,
  getCollectorHealth,
  getModelMix,
  getSessions,
  getSettings,
  setSettings
} from './queries'
import { insertQuotaSnapshot } from './upsert'
import { AnalyticsPeriodInputSchema, type QuotaSnapshot } from '../../shared/types'
import { MIGRATIONS } from './schema'

const claudeLive: QuotaSnapshot = {
  provider: 'claude',
  captured_at: new Date().toISOString(),
  used_pct: 8,
  remaining_pct: 92,
  reset_at: '2026-08-04T21:50:00.000Z',
  window_label: 'Session (5h)',
  plan_label: 'pro',
  plan_source: 'auth',
  confidence: 'live',
  source: 'test',
  auth_connected: true,
  windows: [
    { label: 'Session (5h)', used_pct: 8, remaining_pct: 92, reset_at: '2026-08-04T21:50:00.000Z' },
    { label: 'Weekly (all models)', used_pct: 41, remaining_pct: 59, reset_at: '2026-08-09T14:00:00.000Z' }
  ]
}

describe('applyClaudeBurnWindow', () => {
  it('swaps Claude used_pct/reset/window_label to the weekly window', () => {
    const remapped = applyClaudeBurnWindow(claudeLive)
    expect(remapped.used_pct).toBe(41)
    expect(remapped.remaining_pct).toBe(59)
    expect(remapped.window_label).toBe('Weekly (all models)')
    expect(remapped.reset_at).toBe('2026-08-09T14:00:00.000Z')
  })

  it('leaves other fields (auth, confidence, plan) untouched', () => {
    const remapped = applyClaudeBurnWindow(claudeLive)
    expect(remapped.auth_connected).toBe(true)
    expect(remapped.confidence).toBe('live')
    expect(remapped.plan_label).toBe('pro')
  })

  it('is a no-op when the weekly window is absent (estimate fallback)', () => {
    const noWindows: QuotaSnapshot = { ...claudeLive, windows: undefined }
    expect(applyClaudeBurnWindow(noWindows)).toEqual(noWindows)
  })

  it('is a no-op for non-Claude providers', () => {
    const grok: QuotaSnapshot = { ...claudeLive, provider: 'grok' }
    expect(applyClaudeBurnWindow(grok)).toEqual(grok)
  })

  it('uses Codex weekly quota instead of the five-hour session limit', () => {
    const codex: QuotaSnapshot = {
      ...claudeLive,
      provider: 'codex',
      used_pct: 73,
      remaining_pct: 27,
      window_label: 'Session',
      quota_windows: [
        {
          id: 'primary',
          kind: 'session',
          label: 'Session',
          used_pct: 73,
          resets_at: '2026-09-05T15:15:23.000Z',
          window_duration_mins: 300
        },
        {
          id: 'secondary',
          kind: 'weekly',
          label: 'Weekly',
          used_pct: 4,
          resets_at: '2026-09-11T15:50:29.000Z',
          window_duration_mins: 10080
        }
      ]
    }
    expect(applyBurnWindow(codex)).toMatchObject({
      used_pct: 4,
      remaining_pct: 96,
      reset_at: '2026-09-11T15:50:29.000Z',
      window_label: 'Weekly'
    })
  })
})

describe('provider enablement', () => {
  it('merges sparse changes and excludes disabled providers from all-provider totals', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database

    setSettings(db, { enabled_providers: { claude: false } })
    setSettings(db, { enabled_providers: { opencode: false } })
    expect(getSettings(db).enabled_providers).toEqual({
      claude: false,
      opencode: false
    })

    const insert = raw.prepare(`
      INSERT INTO usage_events (
        dedupe_key, provider, session_id, project, model, ts_ms,
        uncached_input, cached_input, cache_creation, output, reasoning,
        cost_usd, cache_savings_usd, reported_cost_usd, source
      ) VALUES (?, ?, ?, '', 'test-model', ?, ?, 0, 0, 0, 0, 0, 0, NULL, 'test')
    `)
    insert.run('grok:event', 'grok', 'grok-session', Date.now(), 100)
    insert.run('claude:event', 'claude', 'claude-session', Date.now(), 200)

    const overview = getOverview(db, 'all', 0)
    expect(overview.tokens_total).toBe(100)
    expect(overview.by_provider.map((row) => row.provider)).toEqual(['grok'])
    expect(getOverview(db, 'claude', 0).tokens_total).toBe(0)
    expect(getCollectorHealth(db).map((row) => row.provider)).toEqual([
      'grok',
      'codex',
      'cursor'
    ])
    raw.close()
  })
})

describe('onboarding settings', () => {
  it('identifies a new database while treating legacy settings as established', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database

    expect(getSettings(db).onboarding_completed).toBe(false)

    setSettings(db, { display_currency: 'EUR' })
    expect(getSettings(db).onboarding_completed).toBe(false)

    raw
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('app', ?)")
      .run(JSON.stringify({ display_currency: 'USD' }))
    expect(getSettings(db).onboarding_completed).toBe(true)
    raw.close()
  })
})

describe('usage analytics detail', () => {
  it('preserves every token class and cost signal by day, provider, and model', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    const insert = raw.prepare(`
      INSERT INTO usage_events (
        dedupe_key, provider, session_id, project, model, ts_ms,
        uncached_input, cached_input, cache_creation, output, reasoning,
        cost_usd, cache_savings_usd, reported_cost_usd, source
      ) VALUES (?, ?, ?, 'project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'test')
    `)
    const now = Date.now()
    insert.run('claude:1', 'claude', 'session-1', 'claude-sonnet-4-5', now, 100, 200, 30, 40, 10, 0.5, 0.2, 0.4)
    insert.run('claude:2', 'claude', 'session-1', 'claude-sonnet-4-5', now + 1, 10, 20, 3, 4, 1, null, 0.02, null)

    const overview = getOverview(db, 'claude', 0)
    expect(overview.token_breakdown).toEqual({
      uncached_input: 110,
      cached_input: 220,
      cache_creation: 33,
      output: 44,
      reasoning: 11,
      model_calls: 2
    })
    expect(overview.by_provider[0]).toMatchObject({
      provider: 'claude',
      tokens_total: 407,
      cached_input: 220,
      cache_creation: 33,
      provider_cost_usd: 0.4,
      cache_savings_usd: 0.22,
      unpriced_calls: 1,
      session_count: 1
    })

    const daily = getDailyUsage(db, 'claude', 0)
    expect(daily).toHaveLength(1)
    expect(daily[0]).toMatchObject({
      tokens_total: 407,
      uncached_input: 110,
      cached_input: 220,
      cache_creation: 33,
      output: 44,
      reasoning: 11,
      model_calls: 2,
      session_count: 1,
      api_equiv_usd: 0.5,
      provider_cost_usd: 0.4,
      cache_savings_usd: 0.22,
      unpriced_calls: 1
    })

    const models = getModelMix(db, 'claude', 0)
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      provider: 'claude',
      tokens_total: 407,
      cached_input: 220,
      cache_creation: 33,
      model_calls: 2,
      session_count: 1,
      api_equiv_usd: 0.5,
      provider_cost_usd: 0.4,
      cache_savings_usd: 0.22,
      unpriced_calls: 1,
      share: 1
    })

    raw.prepare(`
      INSERT INTO sessions (
        id, provider, project, model, tokens_total, status,
        started_at, source, created_at
      ) VALUES (?, ?, ?, ?, ?, 'complete', ?, 'test', ?)
    `).run(
      'session-1',
      'claude',
      'project',
      'anthropic/claude-sonnet-4-5',
      407,
      new Date(now).toISOString(),
      new Date(now).toISOString()
    )
    expect(
      getSessions(db, 'claude', 0, undefined, { model: 'claude-sonnet-4-5' })
    ).toHaveLength(1)
    raw.close()
  })
})

describe('analytics period comparison', () => {
  it('keeps the displayed overview and comparison snapshot on the same DST-aware window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-09T16:00:00.000Z'))
    try {
      const raw = new DatabaseSync(':memory:')
      raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
      for (const migration of MIGRATIONS) raw.exec(migration.sql)
      const db = raw as unknown as Database.Database
      setSettings(db, { timezone: 'America/New_York' })
      const insert = raw.prepare(`
        INSERT INTO usage_events (
          dedupe_key, provider, session_id, project, model, ts_ms,
          uncached_input, cached_input, cache_creation, output, reasoning,
          cost_usd, cache_savings_usd, reported_cost_usd, source
        ) VALUES (?, 'claude', ?, 'project', 'test-model', ?, ?, 0, 0, 0, 0, 0, 0, NULL, 'test')
      `)
      // Last three New York calendar dates are Mar 7–9, even though Mar 8
      // is a 23-hour day. The Mar 6 event must remain outside the window.
      insert.run('outside-dst', 'outside-dst', Date.parse('2026-03-06T18:00:00.000Z'), 500)
      insert.run('inside-dst', 'inside-dst', Date.parse('2026-03-08T18:00:00.000Z'), 200)

      const overview = getOverview(db, 'claude', 3)
      const snapshot = getAnalyticsSnapshot(db, { provider: 'claude', range_days: 3 })
      expect(overview.tokens_total).toBe(200)
      expect(snapshot.current.tokens_total).toBe(overview.tokens_total)
      raw.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drills into sessions using the usage timezone, not the UTC ISO date', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    setSettings(db, { timezone: 'America/New_York' })
    const eventAt = Date.parse('2026-03-01T02:30:00.000Z') // Feb 28 in New York.
    raw.prepare(`
      INSERT INTO usage_events (
        dedupe_key, provider, session_id, project, model, ts_ms,
        uncached_input, cached_input, cache_creation, output, reasoning,
        cost_usd, cache_savings_usd, reported_cost_usd, source
      ) VALUES ('day-edge', 'claude', 'day-edge-session', 'project', 'claude-sonnet-4-5', ?, 10, 0, 0, 0, 0, 0, 0, NULL, 'test')
    `).run(eventAt)
    raw.prepare(`
      INSERT INTO sessions (
        id, provider, project, model, tokens_total, status, started_at, source, created_at
      ) VALUES ('day-edge-session', 'claude', 'project', 'claude-sonnet-4-5', 10, 'complete', ?, 'test', ?)
    `).run(new Date(eventAt).toISOString(), new Date(eventAt).toISOString())

    expect(getSessions(db, 'claude', 0, undefined, { day: '2026-02-28' })).toMatchObject([
      { id: 'day-edge-session' }
    ])
    raw.close()
  })

  it('compares an exact custom window with the immediately preceding equal-length window', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    setSettings(db, { timezone: 'UTC' })
    const insert = raw.prepare(`
      INSERT INTO usage_events (
        dedupe_key, provider, session_id, project, model, ts_ms,
        uncached_input, cached_input, cache_creation, output, reasoning,
        cost_usd, cache_savings_usd, reported_cost_usd, source
      ) VALUES (?, 'claude', ?, 'project', 'claude-sonnet-4-5', ?, ?, 0, 0, 0, 0, ?, 0, NULL, 'test')
    `)

    // Sep 2–4 is the selected window; Aug 30–Sep 1 is the exact prior window.
    insert.run('prior', 'prior-session', Date.parse('2026-08-31T12:00:00.000Z'), 50, 0.5)
    insert.run('current-a', 'current-session', Date.parse('2026-09-02T12:00:00.000Z'), 100, 1)
    insert.run('current-b', 'current-session', Date.parse('2026-09-04T12:00:00.000Z'), 100, null)
    // The exclusive boundary must keep this future event out of both windows.
    insert.run('outside', 'outside-session', Date.parse('2026-09-05T00:00:00.000Z'), 500, 5)

    const selection = AnalyticsPeriodInputSchema.parse({
      start_day: '2026-09-02',
      end_day: '2026-09-04'
    })
    const snapshot = getAnalyticsSnapshot(
      db,
      { provider: 'claude', ...selection },
      Date.parse('2026-09-06T10:00:00.000Z')
    )

    expect(snapshot.window).toMatchObject({
      start_day: '2026-09-02',
      end_day: '2026-09-04',
      days: 3,
      timezone: 'UTC'
    })
    expect(snapshot.current).toMatchObject({
      tokens_total: 200,
      api_equiv_usd: 1,
      session_count: 1,
      unpriced_sessions: 1,
      token_breakdown: { model_calls: 2, uncached_input: 200 }
    })
    expect(snapshot.previous).toMatchObject({
      window: { start_day: '2026-08-30', end_day: '2026-09-01', days: 3 },
      totals: {
        tokens_total: 50,
        api_equiv_usd: 0.5,
        session_count: 1,
        token_breakdown: { model_calls: 1 }
      }
    })

    raw.prepare(`
      INSERT INTO sessions (
        id, provider, project, model, tokens_total, status, started_at, source, created_at
      ) VALUES ('current-session', 'claude', 'project', 'claude-sonnet-4-5', 200, 'complete', ?, 'test', ?)
    `).run('2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z')
    // This session began before the custom period, but its two usage events
    // fall inside it, so an event-grain analytics filter must retain it.
    raw.prepare(`
      INSERT INTO sessions (
        id, provider, project, model, tokens_total, status, started_at, source, created_at
      ) VALUES ('outside-session', 'claude', 'project', 'claude-sonnet-4-5', 500, 'complete', ?, 'test', ?)
    `).run('2026-09-05T00:00:00.000Z', '2026-09-05T00:00:00.000Z')

    const customOverview = getOverview(db, 'claude', selection)
    expect(customOverview.tokens_total).toBe(200)
    expect(customOverview.range_days).toBeNull()
    expect(getDailyUsage(db, 'claude', selection).map((point) => point.tokens_total)).toEqual([100, 0, 100])
    const hourly = getDailyUsage(db, 'claude', selection, 'hour')
    expect(hourly).toHaveLength(72)
    expect(hourly.find((point) => point.day === '2026-09-02 12:00 +00:00')).toMatchObject({ tokens_total: 100 })
    expect(hourly.find((point) => point.day === '2026-09-03 12:00 +00:00')).toMatchObject({ tokens_total: 0 })
    expect(getDailyUsage(db, 'claude', selection, 'week')).toMatchObject([
      { day: '2026-08-31', tokens_total: 200 }
    ])
    expect(getDailyUsage(db, 'claude', selection, 'month')).toMatchObject([
      { day: '2026-09-01', tokens_total: 200 }
    ])
    expect(getModelMix(db, 'claude', selection)).toMatchObject([
      { model: 'claude-sonnet-4-5', tokens_total: 200 }
    ])
    expect(getSessions(db, 'claude', selection).map((session) => session.id)).toEqual([
      'current-session'
    ])
    const customExport = JSON.parse(exportAsJson(db, 'claude', selection))
    expect(customExport.filter).toMatchObject({
      provider: 'claude',
      start_day: '2026-09-02',
      end_day: '2026-09-04'
    })
    expect(customExport.filter).not.toHaveProperty('range_days')
    expect(customExport.overview.range_days).toBeNull()
    raw.close()
  })

  it('does not invent zero-valued hours beyond the current local hour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:37:00.000Z'))
    try {
      const raw = new DatabaseSync(':memory:')
      raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
      for (const migration of MIGRATIONS) raw.exec(migration.sql)
      const db = raw as unknown as Database.Database
      setSettings(db, { timezone: 'UTC' })
      raw.prepare(`
        INSERT INTO usage_events (
          dedupe_key, provider, session_id, project, model, ts_ms,
          uncached_input, cached_input, cache_creation, output, reasoning,
          cost_usd, cache_savings_usd, reported_cost_usd, source
        ) VALUES ('this-morning', 'claude', 'current-session', 'project', 'claude-sonnet-4-5', ?, 10, 0, 0, 0, 0, 0, 0, NULL, 'test')
      `).run(Date.parse('2026-09-06T10:15:00.000Z'))

      const hourly = getDailyUsage(
        db,
        'claude',
        { start_day: '2026-09-06', end_day: '2026-09-06' },
        'hour'
      )
      expect(hourly.at(-1)).toMatchObject({ day: '2026-09-06 11:00 +00:00' })
      expect(hourly).not.toContainEqual(expect.objectContaining({ day: '2026-09-06 12:00 +00:00' }))
      raw.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fabricate a prior period for lifetime analytics', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database

    const snapshot = getAnalyticsSnapshot(db, { provider: 'all', range_days: 0 })
    expect(snapshot.window.label).toBe('Lifetime')
    expect(snapshot.previous).toBeNull()
    expect(() => getDailyUsage(db, 'all', 0, 'hour')).toThrow(
      'Lifetime usage charts support daily resolution only.'
    )
    raw.close()
  })
})

describe('quota snapshot detail persistence', () => {
  it('round-trips normalized windows and quota diagnostics', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    const snapshot: QuotaSnapshot = {
      ...claudeLive,
      quota_windows: [
        {
          id: 'five_hour',
          kind: 'session',
          label: 'Session (5h)',
          used_pct: 8,
          resets_at: '2026-08-04T21:50:00.000Z',
          window_duration_mins: 300
        }
      ],
      transport: 'http',
      unavailable: undefined
    }
    insertQuotaSnapshot(db, snapshot)
    const restored = getLatestQuotas(db).find((row) => row.provider === 'claude')
    expect(restored?.quota_windows).toEqual(snapshot.quota_windows)
    expect(restored?.transport).toBe('http')
    raw.close()
  })

  it('uses the stored Codex weekly window for history and runway cards', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    const capturedAt = new Date().toISOString()
    insertQuotaSnapshot(db, {
      ...claudeLive,
      provider: 'codex',
      captured_at: capturedAt,
      used_pct: 73,
      remaining_pct: 27,
      reset_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      window_label: 'Session',
      quota_windows: [
        {
          id: 'primary',
          kind: 'session',
          label: 'Session',
          used_pct: 73,
          resets_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          window_duration_mins: 300
        },
        {
          id: 'secondary',
          kind: 'weekly',
          label: 'Weekly',
          used_pct: 4,
          resets_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
          window_duration_mins: 10080
        }
      ]
    })

    const observed = getBurn(db, 'codex', 7).filter((point) => !point.projected)
    expect(observed.at(-1)?.used_pct).toBe(4)
    expect(getProjections(db).find((card) => card.provider === 'codex')?.detail).toMatch(
      /96% remaining.*Weekly/
    )
    const codexSeries = getBurnSeries(db, 'codex', 7)
    expect(codexSeries).toHaveLength(1)
    expect(codexSeries[0]).toMatchObject({ provider: 'codex', label: 'Codex CLI' })
    expect(codexSeries[0].points[0]).toMatchObject({ used_pct: 4, projected: false })
    raw.close()
  })

  it('returns every Claude weekly model window for a combined burn graph', () => {
    const raw = new DatabaseSync(':memory:')
    raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    for (const migration of MIGRATIONS) raw.exec(migration.sql)
    const db = raw as unknown as Database.Database
    insertQuotaSnapshot(db, {
      ...claudeLive,
      quota_windows: [
        { id: 'seven_day', kind: 'weekly', label: 'Weekly (all models)', used_pct: 40, resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), window_duration_mins: 10080 },
        { id: 'seven_day_opus', kind: 'weekly', label: 'Weekly (Opus)', used_pct: 20, resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), window_duration_mins: 10080 },
        { id: 'seven_day_sonnet', kind: 'weekly', label: 'Weekly (Sonnet)', used_pct: 60, resets_at: new Date(Date.now() + 4 * 86_400_000).toISOString(), window_duration_mins: 10080 }
      ]
    })

    expect(getBurnSeries(db, 'claude', 7).map((series) => series.label)).toEqual([
      'Claude · All models',
      'Claude · Opus',
      'Claude · Sonnet'
    ])
    raw.close()
  })
})
