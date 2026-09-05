import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import Database from 'better-sqlite3'
import type { UsageEvent } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { getGrokHome } from '../../util/paths'
import { collectUsage, type CollectedUsage, type SessionFacts } from '../aggregate'
import {
  readCached,
  splitLines,
  type ParseChunk,
  type ParseOutput,
  type ScanCache
} from '../scanCache'
import { GROK_SOURCE, mightCarryGrokUsage, parseGrokLine } from './parse'

/** Only bounds the sqlite index read; the transcript scan itself is unbounded. */
const MAX_INDEXED = 1000

interface SessionDocRow {
  session_id: string
  cwd: string | null
  updated_at: number | string | null
}

interface GrokFileFacts {
  api_duration_ms: number
  model_calls: number
}

function parseChunk(sessionId: string): (
  chunk: ParseChunk<GrokFileFacts>
) => ParseOutput<GrokFileFacts> {
  return (chunk) => {
    const split = splitLines(chunk.text)
    const facts: GrokFileFacts = chunk.state
      ? { ...chunk.state }
      : { api_duration_ms: 0, model_calls: 0 }
    const events: UsageEvent[] = []
    const tailEvents: UsageEvent[] = []

    for (const line of split.lines) {
      if (!mightCarryGrokUsage(line)) continue
      const parsed = parseGrokLine(line, sessionId)
      events.push(...parsed.events)
      facts.api_duration_ms += parsed.extras.api_duration_ms
      facts.model_calls += parsed.extras.model_calls
    }

    if (split.tail.trim() && mightCarryGrokUsage(split.tail)) {
      tailEvents.push(...parseGrokLine(split.tail, sessionId).events)
    }

    return {
      events,
      tail_events: tailEvents,
      facts,
      state: facts,
      consumed: split.consumed
    }
  }
}

/**
 * Collects Grok metadata from session summaries plus usage from each session's
 * `updates.jsonl`. Prompt and response fields are never read or returned.
 */
export function collectGrokSessions(
  home = getGrokHome(),
  cache: ScanCache = new Map()
): CollectedUsage {
  const sessionsRoot = join(home, 'sessions')
  if (!existsSync(sessionsRoot)) return { sessions: [], events: [] }

  const active = readActiveSessions(home)
  const indexed = readIndexedSessions(sessionsRoot)
  const events: UsageEvent[] = []
  const facts: SessionFacts[] = []
  const seen = new Set<string>()

  for (const entry of listSessionDirectories(sessionsRoot)) {
    const summary = readJsonObject(join(entry.path, 'summary.json'))
    if (!summary) continue
    const info = asRecord(summary.info)
    const id = stringValue(info?.id) ?? basename(entry.path)
    if (!id || seen.has(id)) continue
    seen.add(id)

    const updatesPath = join(entry.path, 'updates.jsonl')
    const result = existsSync(updatesPath)
      ? readCached<GrokFileFacts>(cache, updatesPath, 'grok', parseChunk(id))
      : null
    if (!result || result.events.length === 0) continue

    events.push(...result.events)

    const fileFacts = result.facts as GrokFileFacts | undefined
    const cwd =
      stringValue(info?.cwd) ??
      stringValue(summary.git_root_dir) ??
      indexed.get(id)?.cwd ??
      active.get(id)?.cwd ??
      null
    const startedAt =
      isoTimestamp(summary.created_at) ??
      active.get(id)?.opened_at ??
      indexed.get(id)?.updated_at ??
      null
    const endedAt =
      isoTimestamp(summary.last_active_at) ??
      isoTimestamp(summary.updated_at) ??
      indexed.get(id)?.updated_at ??
      startedAt
    const isActive = active.has(id)

    facts.push({
      id: `grok:${id}`,
      provider: 'grok',
      project: projectNameFromCwd(cwd),
      status: isActive ? 'unknown' : 'complete',
      started_at: startedAt,
      ended_at: isActive ? null : endedAt,
      duration_ms:
        durationBetween(startedAt, endedAt) ??
        (fileFacts?.api_duration_ms || null),
      api_duration_ms: fileFacts?.api_duration_ms || null,
      model_calls: fileFacts?.model_calls || null,
      source: GROK_SOURCE
    })
  }

  return collectUsage(events, facts)
}

function listSessionDirectories(root: string): Array<{ path: string; mtimeMs: number }> {
  const output: Array<{ path: string; mtimeMs: number }> = []
  for (const project of safeDirectories(root)) {
    for (const session of safeDirectories(join(root, project))) {
      const path = join(root, project, session)
      if (!existsSync(join(path, 'summary.json'))) continue
      const usagePath = join(path, 'updates.jsonl')
      output.push({
        path,
        mtimeMs: existsSync(usagePath)
          ? safeMtime(usagePath)
          : safeMtime(join(path, 'summary.json'))
      })
    }
  }
  return output.sort((a, b) => b.mtimeMs - a.mtimeMs)
}

function safeDirectories(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function readIndexedSessions(
  root: string
): Map<string, { cwd: string | null; updated_at: string | null }> {
  const output = new Map<string, { cwd: string | null; updated_at: string | null }>()
  const dbPath = join(root, 'session_search.sqlite')
  if (!existsSync(dbPath)) return output

  let db: Database.Database | null = null
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true })
    const rows = db
      .prepare(
        `SELECT session_id, cwd, updated_at
         FROM session_docs
         ORDER BY updated_at DESC
         LIMIT ${MAX_INDEXED}`
      )
      .all() as SessionDocRow[]
    for (const row of rows) {
      if (!row.session_id) continue
      output.set(row.session_id, {
        cwd: row.cwd,
        updated_at: coerceTimestamp(row.updated_at)
      })
    }
  } catch {
    // The CLI may temporarily lock or replace its index.
  } finally {
    db?.close()
  }
  return output
}

function readActiveSessions(
  home: string
): Map<string, { cwd: string | null; opened_at: string | null }> {
  const output = new Map<string, { cwd: string | null; opened_at: string | null }>()
  const raw = readJson(join(home, 'active_sessions.json'))
  if (!Array.isArray(raw)) return output
  for (const item of raw) {
    const row = asRecord(item)
    const id = stringValue(row?.session_id)
    if (!id) continue
    output.set(id, {
      cwd: stringValue(row?.cwd),
      opened_at: isoTimestamp(row?.opened_at)
    })
  }
  return output
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as unknown
  } catch {
    return null
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  return asRecord(readJson(path))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function durationBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return null
  return endMs - startMs
}

function safeMtime(path: string): number {
  try {
    return statSync(path).mtimeMs
  } catch {
    return 0
  }
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'number') return coerceTimestamp(value)
  if (typeof value !== 'string' || !value.trim()) return null
  return coerceTimestamp(value)
}

function coerceTimestamp(value: number | string | null | undefined): string | null {
  if (value == null) return null
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    return new Date(ms).toISOString()
  }
  const numeric = Number(value)
  if (!Number.isNaN(numeric) && numeric > 1_000_000) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000
    return new Date(ms).toISOString()
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}
