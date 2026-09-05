import { existsSync } from 'fs'
import Database from 'better-sqlite3'
import { projectNameFromCwd } from '../../util/project'
import { getOpenCodeHome } from '../../util/paths'
import { collectUsage, type CollectedUsage, type SessionFacts } from '../aggregate'
import type { UsageEvent } from '../../../shared/types'
import { OPENCODE_SOURCE, parseOpenCodeMessage } from './parse'

/**
 * Reads OpenCode usage out of its SQLite store.
 *
 * Only the `message` table is opened, and only its `data` blob is parsed;
 * prompt and response text live in `part`, which is never read. The database
 * is opened read-only so a running OpenCode is never blocked.
 */
export function collectOpenCodeSessions(
  home = getOpenCodeHome()
): CollectedUsage {
  const dbPath = `${home}/opencode.db`
  if (!existsSync(dbPath)) return { sessions: [], events: [] }

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })

    const sessionRows = db
      .prepare(
        `SELECT id, directory, title, time_created, time_updated, agent
         FROM session`
      )
      .all() as Array<{
      id: string
      directory: string | null
      time_created: number | null
      time_updated: number | null
    }>
    const sessionById = new Map(sessionRows.map((row) => [row.id, row]))

    const messageRows = db
      .prepare('SELECT id, session_id, data FROM message')
      .all() as Array<{ id: string; session_id: string; data: string }>

    const events: UsageEvent[] = []
    const cwdBySession = new Map<string, string>()
    const costBySession = new Map<string, number>()
    const seenSessions = new Set<string>()

    for (const row of messageRows) {
      const parsed = parseOpenCodeMessage(row)
      if (!parsed.event) continue
      events.push(parsed.event)
      seenSessions.add(row.session_id)
      if (parsed.cwd && !cwdBySession.has(row.session_id)) {
        cwdBySession.set(row.session_id, parsed.cwd)
      }
      if (parsed.cost_usd != null) {
        costBySession.set(
          row.session_id,
          (costBySession.get(row.session_id) ?? 0) + parsed.cost_usd
        )
      }
    }

    const facts: SessionFacts[] = []
    for (const sessionId of seenSessions) {
      const session = sessionById.get(sessionId)
      const cwd = cwdBySession.get(sessionId) ?? session?.directory ?? null
      const startedMs = session?.time_created ?? null
      const endedMs = session?.time_updated ?? null
      const reported = costBySession.get(sessionId)
      facts.push({
        id: `opencode:${sessionId}`,
        provider: 'opencode',
        project: projectNameFromCwd(cwd),
        // OpenCode does not record a terminal status per session.
        status: 'unknown',
        started_at: isoOrNull(startedMs),
        ended_at: isoOrNull(endedMs),
        duration_ms:
          startedMs != null && endedMs != null && endedMs >= startedMs
            ? endedMs - startedMs
            : null,
        provider_cost_usd:
          reported == null ? null : Math.round(reported * 1e6) / 1e6,
        source: OPENCODE_SOURCE
      })
    }

    return collectUsage(events, facts)
  } catch (error) {
    // Deliberately not swallowed. An empty result here is indistinguishable
    // from "OpenCode has no usage", which is how a native-module or schema
    // failure would hide for weeks; the collector service records the message
    // on the provider's health row instead.
    throw new Error(
      `OpenCode store unreadable: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    )
  } finally {
    db?.close()
  }
}

function isoOrNull(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms > 1e12 ? ms : ms * 1000).toISOString()
}
