import type Database from 'better-sqlite3'
import { getSettings } from './queries'

/** Apply the configured metadata retention window. */
export function applyRetention(
  db: Database.Database,
  retentionDays = getSettings(db).retention_days
): void {
  const days = Math.max(1, Math.floor(retentionDays))
  const modifier = `-${days} days`

  const cutoffMs = Date.now() - days * 86_400_000

  const prune = db.transaction(() => {
    // Events are the durable record and the largest table, so they are pruned
    // on the same window as everything else.
    db.prepare('DELETE FROM usage_events WHERE ts_ms < ?').run(cutoffMs)
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
