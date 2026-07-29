import type Database from 'better-sqlite3'
import { Notification } from 'electron'
import type { QuotaSnapshot } from '../../shared/types'
import { getLatestQuotas } from '../db/queries'
import { getSettings } from '../db/queries'
import { willExhaustWithinDays } from '../analytics/projections'

/**
 * Simple rule engine. Creates undismissed alerts once per (rule_id, provider, day).
 */
export function evaluateAlerts(db: Database.Database): void {
  const quotas = getLatestQuotas(db)
  const day = new Date().toISOString().slice(0, 10)

  for (const q of quotas) {
    maybeInsert(db, {
      rule_id: 'not-connected',
      provider: q.provider,
      day,
      level: 'info',
      title: `${label(q)} not connected`,
      body: 'Install the CLI and log in, then refresh quotas.',
      when: !q.auth_connected
    })

    if (!q.auth_connected) continue

    if (q.stale) {
      maybeInsert(db, {
        rule_id: 'stale-live',
        provider: q.provider,
        day,
        level: 'info',
        title: `${label(q)} live quota is stale`,
        body: 'The last successful value is retained while the provider usage API is unavailable.',
        when: true
      })
      continue
    }

    if (q.confidence === 'estimate') {
      maybeInsert(db, {
        rule_id: 'estimate-only',
        provider: q.provider,
        day,
        level: 'info',
        title: `${label(q)} is estimate-only`,
        body: 'Connected, but no official remaining figure from the usage API.',
        when: true
      })
    }

    if (q.used_pct != null && q.used_pct >= 90) {
      maybeInsert(db, {
        rule_id: 'critical-burn',
        provider: q.provider,
        day,
        level: 'warn',
        title: `${label(q)} nearly exhausted`,
        body: `${Math.round(q.used_pct)}% used in the current window.`,
        when: true
      })
    } else if (q.used_pct != null && q.used_pct >= 70) {
      maybeInsert(db, {
        rule_id: 'high-burn',
        provider: q.provider,
        day,
        level: 'warn',
        title: `${label(q)} high burn`,
        body: `${Math.round(q.used_pct)}% used — pace yourself before the reset.`,
        when: true
      })
    }

    if (willExhaustWithinDays(q, 3, 7) && (q.used_pct ?? 0) < 90) {
      maybeInsert(db, {
        rule_id: 'projection-exhaust',
        provider: q.provider,
        day,
        level: 'warn',
        title: `${label(q)} may hit 100% within 3 days`,
        body: 'At the current burn pace, remaining quota may run out before the window resets.',
        when: true
      })
    }
  }
}

function label(q: QuotaSnapshot): string {
  return q.provider === 'grok'
    ? 'Grok'
    : q.provider === 'claude'
      ? 'Claude'
      : 'Codex'
}

function maybeInsert(
  db: Database.Database,
  opts: {
    rule_id: string
    provider: string
    day: string
    level: 'info' | 'warn' | 'error'
    title: string
    body: string
    when: boolean
  }
): void {
  if (!opts.when) return

  const id = `${opts.rule_id}:${opts.provider}:${opts.day}`
  const existing = db.prepare(`SELECT id FROM alerts WHERE id = ?`).get(id)
  if (existing) return

  db.prepare(
    `
    INSERT INTO alerts (id, provider, level, title, body, rule_id, created_at, dismissed_at, notified_at)
    VALUES (@id, @provider, @level, @title, @body, @rule_id, @created_at, NULL, NULL)
  `
  ).run({
    id,
    provider: opts.provider,
    level: opts.level,
    title: opts.title,
    body: opts.body,
    rule_id: opts.rule_id,
    created_at: new Date().toISOString()
  })

  const settings = getSettings(db)
  if (settings.notify_enabled && Notification.isSupported()) {
    try {
      new Notification({ title: opts.title, body: opts.body }).show()
      db.prepare(`UPDATE alerts SET notified_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        id
      )
    } catch {
      // Dashboard alert remains available if an OS notification cannot be shown.
    }
  }
}
