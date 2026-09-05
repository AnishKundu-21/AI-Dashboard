import { existsSync, readdirSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import type { SessionStatus, UsageEvent } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { collectUsage, type CollectedUsage, type SessionFacts } from '../aggregate'
import {
  readCached,
  splitLines,
  type ParseChunk,
  type ParseOutput,
  type ScanCache
} from '../scanCache'
import { CURSOR_SOURCE, mightCarryCursorUsage, parseCursorLine } from './parse'

interface CursorFileFacts {
  session_id: string | null
  cwd: string | null
  started_at_ms: number | null
  ended_at_ms: number | null
  status: SessionStatus
}

const emptyFacts = (): CursorFileFacts => ({
  session_id: null,
  cwd: null,
  started_at_ms: null,
  ended_at_ms: null,
  status: 'unknown'
})

function mergeFacts(a: CursorFileFacts, b: CursorFileFacts): CursorFileFacts {
  return {
    session_id: b.session_id ?? a.session_id,
    cwd: b.cwd ?? a.cwd,
    started_at_ms: minDefined(a.started_at_ms, b.started_at_ms),
    ended_at_ms: maxDefined(a.ended_at_ms, b.ended_at_ms),
    status: b.status !== 'unknown' ? b.status : a.status
  }
}

function parseChunk(
  fallbackId: string,
  previous: CursorFileFacts
): (chunk: ParseChunk<null>) => ParseOutput<null> {
  return (chunk) => {
    const split = splitLines(chunk.text)
    let facts = { ...previous }
    const events: UsageEvent[] = []
    const tailEvents: UsageEvent[] = []

    const consume = (line: string, into: UsageEvent[]): void => {
      if (!mightCarryCursorUsage(line)) return
      const parsed = parseCursorLine(line, fallbackId)
      facts = mergeFacts(facts, {
        session_id: parsed.session_id,
        cwd: parsed.cwd,
        started_at_ms: parsed.timestamp_ms,
        ended_at_ms: parsed.timestamp_ms,
        status: parsed.status
      })
      if (parsed.event) into.push(parsed.event)
    }

    for (const line of split.lines) consume(line, events)
    if (split.tail.trim()) consume(split.tail, tailEvents)
    return {
      events,
      tail_events: tailEvents,
      facts,
      state: null,
      consumed: split.consumed
    }
  }
}

export function collectCursorSessions(
  home: string,
  cache: ScanCache = new Map()
): CollectedUsage {
  const projectsRoot = join(home, 'projects')
  if (!existsSync(projectsRoot)) return { sessions: [], events: [] }

  const events: UsageEvent[] = []
  const factsBySession = new Map<string, CursorFileFacts & { fallbackProject: string }>()
  for (const path of listTranscriptFiles(projectsRoot)) {
    const fallbackId = basename(path).replace(/\.jsonl$/i, '') || basename(dirname(path))
    const old = cache.get(path)?.facts as CursorFileFacts | undefined
    const result = readCached<null>(cache, path, 'cursor', (chunk) =>
      parseChunk(
        fallbackId,
        chunk.start_offset === 0 ? emptyFacts() : (old ?? emptyFacts())
      )(chunk)
    )
    if (!result) continue
    const fileFacts = (result.facts as CursorFileFacts | undefined) ?? emptyFacts()
    const sessionId = fileFacts.session_id ?? fallbackId
    const prior = factsBySession.get(sessionId)
    factsBySession.set(sessionId, {
      ...mergeFacts(prior ?? emptyFacts(), fileFacts),
      fallbackProject: prior?.fallbackProject ?? projectFromTranscriptPath(projectsRoot, path)
    })
    events.push(...result.events)
  }

  const facts: SessionFacts[] = [...factsBySession].map(([sessionId, row]) => ({
    id: `cursor:${sessionId}`,
    provider: 'cursor',
    project: row.cwd ? projectNameFromCwd(row.cwd) : row.fallbackProject,
    status: row.status,
    started_at: isoOrNull(row.started_at_ms),
    ended_at: isoOrNull(row.ended_at_ms),
    duration_ms:
      row.started_at_ms != null && row.ended_at_ms != null
        ? Math.max(0, row.ended_at_ms - row.started_at_ms)
        : null,
    provider_cost_usd: null,
    source: CURSOR_SOURCE
  }))
  return collectUsage(events, facts)
}

function listTranscriptFiles(root: string): string[] {
  const output: string[] = []
  const walk = (dir: string, inTranscripts: boolean): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, inTranscripts || entry.name === 'agent-transcripts')
      else if (inTranscripts && entry.name.endsWith('.jsonl')) output.push(path)
    }
  }
  walk(root, false)
  return output
}

function projectFromTranscriptPath(root: string, path: string): string {
  const first = relative(root, path).split(sep)[0]
  if (!first) return 'unknown'
  const pieces = first.split('-').filter(Boolean)
  return pieces.at(-1) ?? first
}

function minDefined(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.min(a, b)
}

function maxDefined(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}
