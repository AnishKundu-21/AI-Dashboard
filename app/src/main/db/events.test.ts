/**
 * Event-store behaviour, against real SQLite.
 *
 * Node's built-in SQLite stands in for `better-sqlite3`, which is compiled for
 * Electron's ABI and cannot load under plain Node. It has no `.transaction()`
 * helper, so a thin shim supplies one; the SQL and the bucketing logic under
 * test are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import {
  recomputeDailyFromEvents,
  repriceEvents,
  refreshSessionRollups,
  upsertEvents
} from './events'
import { MIGRATIONS } from './schema'
import { primeRateTable, resetPricingForTests, setPriceOverrides } from '../pricing/store'
import type { UsageEvent } from '../../shared/types'

const RATES = {
  'claude-opus-5': {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 2.5e-5,
    cache_read_input_token_cost: 5e-7,
    cache_creation_input_token_cost: 6.25e-6
  },
  'claude-sonnet-5': {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 2e-7,
    cache_creation_input_token_cost: 2.5e-6
  }
}

let raw: DatabaseSync
let db: Database.Database

/** Minimal `better-sqlite3` surface over node:sqlite, for the code under test. */
function shim(inner: DatabaseSync): Database.Database {
  return {
    prepare: (sql: string) => inner.prepare(sql),
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        inner.exec('BEGIN')
        try {
          const result = fn(...args)
          inner.exec('COMMIT')
          return result
        } catch (error) {
          inner.exec('ROLLBACK')
          throw error
        }
      }
  } as unknown as Database.Database
}

beforeEach(() => {
  raw = new DatabaseSync(':memory:')
  raw.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  for (const migration of MIGRATIONS) raw.exec(migration.sql)
  db = shim(raw)
  resetPricingForTests()
  primeRateTable(RATES)
})

afterEach(() => {
  resetPricingForTests()
  raw.close()
})

function event(overrides: Partial<UsageEvent> & { dedupe_key: string }): UsageEvent {
  return {
    provider: 'claude',
    session_id: 'sess-1',
    project: 'demo',
    model: 'claude-opus-5',
    ts_ms: Date.parse('2026-07-04T10:00:00Z'),
    tokens: {
      uncached_input: 1_000,
      cached_input: 0,
      cache_creation: 0,
      output: 100,
      reasoning: 0
    },
    reported_cost_usd: null,
    source: 'test',
    ...overrides
  }
}

function dailyRows(): Array<{ day: string; provider: string; tokens_total: number }> {
  return raw
    .prepare('SELECT day, provider, tokens_total FROM usage_daily ORDER BY day')
    .all() as never
}

describe('upsertEvents', () => {
  it('prices each event at its own model rate', () => {
    upsertEvents(db, [
      event({ dedupe_key: 'a', model: 'claude-opus-5' }),
      event({ dedupe_key: 'b', model: 'claude-sonnet-5' })
    ])
    const rows = raw
      .prepare('SELECT dedupe_key, cost_usd FROM usage_events ORDER BY dedupe_key')
      .all() as Array<{ dedupe_key: string; cost_usd: number }>
    // opus: 1000*5e-6 + 100*2.5e-5 = 0.0075
    expect(rows[0].cost_usd).toBeCloseTo(0.0075, 9)
    // sonnet: 1000*2e-6 + 100*1e-5 = 0.003
    expect(rows[1].cost_usd).toBeCloseTo(0.003, 9)
  })

  it('is idempotent, so a rescan rewrites rather than doubles', () => {
    const events = [event({ dedupe_key: 'a' }), event({ dedupe_key: 'b' })]
    upsertEvents(db, events)
    upsertEvents(db, events)
    expect(
      (raw.prepare('SELECT COUNT(*) AS n FROM usage_events').get() as { n: number }).n
    ).toBe(2)
  })

  it('stores null cost for an unpriced model rather than zero', () => {
    upsertEvents(db, [event({ dedupe_key: 'a', model: 'model-with-no-rate' })])
    const row = raw
      .prepare('SELECT cost_usd, cache_savings_usd FROM usage_events')
      .get() as { cost_usd: number | null; cache_savings_usd: number | null }
    expect(row.cost_usd).toBeNull()
    expect(row.cache_savings_usd).toBeNull()
  })
})

describe('recomputeDailyFromEvents', () => {
  it('splits a session that ran past midnight across both days', () => {
    // One session, two calendar days in UTC.
    const events = [
      event({ dedupe_key: 'a', ts_ms: Date.parse('2026-07-04T23:30:00Z') }),
      event({ dedupe_key: 'b', ts_ms: Date.parse('2026-07-05T00:30:00Z') })
    ]
    upsertEvents(db, events)
    recomputeDailyFromEvents(db, events, 'UTC')

    expect(dailyRows()).toEqual([
      { day: '2026-07-04', provider: 'claude', tokens_total: 1100 },
      { day: '2026-07-05', provider: 'claude', tokens_total: 1100 }
    ])
  })

  it('buckets by the display timezone, not UTC', () => {
    // 23:30Z on Jul 4 is already 05:00 on Jul 5 in Kolkata (UTC+5:30).
    const events = [
      event({ dedupe_key: 'a', ts_ms: Date.parse('2026-07-04T23:30:00Z') })
    ]
    upsertEvents(db, events)
    recomputeDailyFromEvents(db, events, 'Asia/Kolkata')
    expect(dailyRows()).toEqual([
      { day: '2026-07-05', provider: 'claude', tokens_total: 1100 }
    ])
  })

  it('counts a session once per day it was active on', () => {
    const events = [
      event({ dedupe_key: 'a', session_id: 's1', ts_ms: Date.parse('2026-07-04T10:00:00Z') }),
      event({ dedupe_key: 'b', session_id: 's1', ts_ms: Date.parse('2026-07-04T11:00:00Z') }),
      event({ dedupe_key: 'c', session_id: 's2', ts_ms: Date.parse('2026-07-04T12:00:00Z') })
    ]
    upsertEvents(db, events)
    recomputeDailyFromEvents(db, events, 'UTC')
    const row = raw
      .prepare("SELECT session_count FROM usage_daily WHERE day = '2026-07-04'")
      .get() as { session_count: number }
    expect(row.session_count).toBe(2)
  })

  it('removes a day whose events have all gone', () => {
    const events = [event({ dedupe_key: 'a' })]
    upsertEvents(db, events)
    recomputeDailyFromEvents(db, events, 'UTC')
    expect(dailyRows()).toHaveLength(1)

    raw.exec('DELETE FROM usage_events')
    recomputeDailyFromEvents(db, events, 'UTC')
    expect(dailyRows()).toHaveLength(0)
  })

  it('rebuilds only the days it was given', () => {
    const july = [event({ dedupe_key: 'a', ts_ms: Date.parse('2026-07-04T10:00:00Z') })]
    const august = [event({ dedupe_key: 'b', ts_ms: Date.parse('2026-08-04T10:00:00Z') })]
    upsertEvents(db, [...july, ...august])
    recomputeDailyFromEvents(db, july, 'UTC')
    expect(dailyRows().map((r) => r.day)).toEqual(['2026-07-04'])

    recomputeDailyFromEvents(db, august, 'UTC')
    expect(dailyRows().map((r) => r.day)).toEqual(['2026-07-04', '2026-08-04'])
  })
})

describe('repriceEvents', () => {
  it('prices what a new override covers, without a rescan', () => {
    upsertEvents(db, [event({ dedupe_key: 'a', model: 'grok-4.6-build' })])
    expect(
      (raw.prepare('SELECT cost_usd FROM usage_events').get() as { cost_usd: null })
        .cost_usd
    ).toBeNull()

    setPriceOverrides({
      'grok-4.6-build': { input_per_million: 3, output_per_million: 15 }
    })
    expect(repriceEvents(db)).toBe(1)

    const row = raw.prepare('SELECT cost_usd FROM usage_events').get() as {
      cost_usd: number
    }
    // 1000 * 3e-6 + 100 * 1.5e-5
    expect(row.cost_usd).toBeCloseTo(0.0045, 9)
  })

  it('reports nothing changed when the table is unchanged', () => {
    upsertEvents(db, [event({ dedupe_key: 'a' })])
    expect(repriceEvents(db)).toBe(0)
  })
})

describe('refreshSessionRollups', () => {
  it('rolls repriced events back onto their session row', () => {
    raw.exec(`
      INSERT INTO sessions (
        id, provider, project, model, tokens_total, api_equiv_usd, unpriced,
        duration_ms, status, started_at, ended_at, source, machine_id, created_at
      ) VALUES (
        'claude:sess-1', 'claude', 'demo', 'grok-4.6-build', 1100, NULL, 1,
        0, 'complete', '2026-07-04T10:00:00Z', '2026-07-04T10:01:00Z',
        'test', 'local', '2026-07-04T10:01:00Z'
      )
    `)
    upsertEvents(db, [event({ dedupe_key: 'a', model: 'grok-4.6-build' })])

    setPriceOverrides({
      'grok-4.6-build': { input_per_million: 3, output_per_million: 15 }
    })
    repriceEvents(db)
    refreshSessionRollups(db)

    const row = raw
      .prepare('SELECT api_equiv_usd, unpriced FROM sessions')
      .get() as { api_equiv_usd: number; unpriced: number }
    expect(row.api_equiv_usd).toBeCloseTo(0.0045, 6)
    expect(row.unpriced).toBe(0)
  })
})
