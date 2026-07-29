import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { getDbPath } from '../util/paths'
import { MIGRATIONS } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call openDatabase() first.')
  }
  return db
}

export function openDatabase(dbPath = getDbPath()): Database.Database {
  if (db) return db

  mkdirSync(dirname(dbPath), { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    );
  `)

  const row = database.prepare('SELECT version FROM schema_version LIMIT 1').get() as
    | { version: number }
    | undefined
  let current = row?.version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue
    const tx = database.transaction(() => {
      database.exec(migration.sql)
      if (current === 0) {
        database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      } else {
        database.prepare('UPDATE schema_version SET version = ?').run(migration.version)
      }
      current = migration.version
    })
    tx()
  }

  if (!row && current === 0 && MIGRATIONS.length === 0) {
    database.prepare('INSERT INTO schema_version (version) VALUES (0)').run()
  }
}
