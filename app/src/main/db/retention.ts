import type Database from 'better-sqlite3'
import { getSettings } from './queries'

/** Apply the configured metadata retention window. */
export function applyRetention(
  db: Database.Database,
  retentionDays = getSettings(db).retention_days
): void {
  const days = Math.max(1, Math.floor(retentionDays))
  const modifier = `-${days} days`

  const prune = db.transaction(() => {
    db.prepare(
      `DELETE FROM sessions
       WHERE datetime(COALESCE(started_at, created_at)) < datetime('now', ?)`
    ).run(modifier)
    db.prepare(
      `DELETE FROM quota_snapshots WHERE datetime(captured_at) < datetime('now', ?)`
    ).run(modifier)
    db.prepare(
      `DELETE FROM alerts WHERE datetime(created_at) < datetime('now', ?)`
    ).run(modifier)
    db.prepare(`DELETE FROM usage_daily WHERE day < date('now', ?)`).run(modifier)
  })

  prune()
}
