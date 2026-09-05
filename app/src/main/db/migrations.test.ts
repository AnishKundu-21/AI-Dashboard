/**
 * Migrations run against real SQLite, both from empty and from an existing
 * database. A migration that throws on upgrade leaves the app unable to open
 * its own store, so the upgrade path is exercised, not just the fresh one.
 *
 * Node's built-in SQLite is used rather than `better-sqlite3`, which is
 * compiled for Electron's ABI and cannot load under plain Node. The SQL is
 * what is under test, and both engines are SQLite.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { MIGRATIONS } from './schema'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'usage-db-'))
  dirs.push(dir)
  return join(dir, 'usage.db')
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Mirrors the runner in `db/index.ts`. */
function migrate(db: DatabaseSync, upTo = Number.POSITIVE_INFINITY): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  let current = row?.version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current || migration.version > upTo) continue
    db.exec(migration.sql)
    if (current === 0) {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(
        migration.version
      )
    } else {
      db.prepare('UPDATE schema_version SET version = ?').run(migration.version)
    }
    current = migration.version
  }
  return current
}

function columns(db: DatabaseSync, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((info) => info.name)
}

describe('migrations', () => {
  it('run in order without gaps', () => {
    const versions = MIGRATIONS.map((migration) => migration.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
    expect(versions[0]).toBe(1)
    expect(versions.at(-1)).toBe(versions.length)
  })

  it('build every table from empty', () => {
    const db = new DatabaseSync(tempDbPath())
    expect(migrate(db)).toBe(MIGRATIONS.length)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((table) => table.name)

    expect(tables).toEqual(
      expect.arrayContaining([
        'settings',
        'sessions',
        'quota_snapshots',
        'usage_daily',
        'alerts',
        'collector_health'
      ])
    )
    expect(columns(db, 'sessions')).toEqual(
      expect.arrayContaining(['cache_savings_usd', 'unpriced'])
    )
    db.close()
  })

  it('upgrade an existing v5 database and clear its pre-Phase-A rows', () => {
    const path = tempDbPath()
    const db = new DatabaseSync(path)
    expect(migrate(db, 5)).toBe(5)

    // A row written by the old collectors, with the old wrong totals.
    db.prepare(
      `INSERT INTO sessions (
         id, provider, project, model, tokens_in, tokens_out, tokens_total,
         api_equiv_usd, duration_ms, status, started_at, ended_at, source,
         machine_id, created_at
       ) VALUES (
         'claude:old', 'claude', 'demo', 'claude-sonnet-4-5-20250929',
         100, 20, 120, 0.00036, 2000, 'complete',
         '2026-07-29T10:00:00Z', '2026-07-29T10:00:02Z', 'claude:projects-jsonl',
         'local', '2026-07-29T10:00:02Z'
       )`
    ).run()
    db.prepare(
      `INSERT INTO usage_daily (day, provider, tokens_total, session_count, api_equiv_usd)
       VALUES ('2026-07-29', 'claude', 120, 1, 0.00036)`
    ).run()

    expect(migrate(db)).toBe(MIGRATIONS.length)

    // Rows are cleared so the next scan rebuilds them correctly from disk.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n
    ).toBe(0)
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM usage_daily').get() as { n: number }).n
    ).toBe(0)
    expect(columns(db, 'sessions')).toEqual(
      expect.arrayContaining(['cache_savings_usd', 'unpriced'])
    )
    db.close()
  })

  it('are idempotent when the runner reopens an up-to-date database', () => {
    const path = tempDbPath()
    const first = new DatabaseSync(path)
    migrate(first)
    first.close()

    const second = new DatabaseSync(path)
    expect(() => migrate(second)).not.toThrow()
    expect(
      (
        second.prepare('SELECT COUNT(*) AS n FROM schema_version').get() as {
          n: number
        }
      ).n
    ).toBe(1)
    second.close()
  })

  it('accept a write shaped like the one the collectors now make', () => {
    const db = new DatabaseSync(tempDbPath())
    migrate(db)
    expect(() =>
      db
        .prepare(
          `INSERT INTO sessions (
             id, provider, project, model, tokens_in, tokens_out, tokens_total,
             tokens_cached, tokens_reasoning, model_calls, api_equiv_usd,
             provider_cost_usd, api_duration_ms, cache_savings_usd, unpriced,
             duration_ms, status, started_at, ended_at, source, machine_id,
             created_at
           ) VALUES (
             'claude:new', 'claude', 'demo', 'claude-sonnet-4-5-20250929',
             100, 20, 160, 40, 0, 1, 0.000647,
             0.012, NULL, 0.000081, 0,
             2000, 'complete', '2026-07-29T10:00:00Z', '2026-07-29T10:00:02Z',
             'claude:projects-jsonl', 'local', '2026-07-29T10:00:02Z'
           )`
        )
        .run()
    ).not.toThrow()
    db.close()
  })
})
