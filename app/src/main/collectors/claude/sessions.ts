import { existsSync, readdirSync } from 'fs'
import { basename, join } from 'path'
import type { SessionRow, UsageEvent } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { collectUsage, type CollectedUsage, type SessionFacts } from '../aggregate'
import {
  readCached,
  splitLines,
  type ParseChunk,
  type ParseOutput,
  type ScanCache
} from '../scanCache'
import { CLAUDE_SOURCE, mightCarryClaudeUsage, parseClaudeLine } from './parse'

interface ClaudeFileFacts {
  session_id: string | null
  cwd: string | null
  started_at_ms: number | null
  ended_at_ms: number | null
  duration_ms: number | null
  total_cost_usd: number | null
  status: SessionRow['status']
}

function emptyFacts(): ClaudeFileFacts {
  return {
    session_id: null,
    cwd: null,
    started_at_ms: null,
    ended_at_ms: null,
    duration_ms: null,
    total_cost_usd: null,
    status: 'unknown'
  }
}

function mergeFacts(a: ClaudeFileFacts, b: ClaudeFileFacts): ClaudeFileFacts {
  return {
    session_id: b.session_id ?? a.session_id,
    cwd: b.cwd ?? a.cwd,
    started_at_ms: minDefined(a.started_at_ms, b.started_at_ms),
    ended_at_ms: maxDefined(a.ended_at_ms, b.ended_at_ms),
    duration_ms: b.duration_ms ?? a.duration_ms,
    total_cost_usd: b.total_cost_usd ?? a.total_cost_usd,
    status: b.status !== 'unknown' ? b.status : a.status
  }
}

/**
 * Parses one chunk of a Claude transcript.
 *
 * Stateless per line, so a resumed parse only needs the previous facts merged
 * back in — which `readCached` does by handing the caller both.
 */
function parseChunk(
  fallbackId: string,
  previous: ClaudeFileFacts
): (chunk: ParseChunk<null>) => ParseOutput<null> {
  return (chunk) => {
    const split = splitLines(chunk.text)
    let facts = { ...previous }
    const events: UsageEvent[] = []
    const tailEvents: UsageEvent[] = []

    const consume = (line: string, into: UsageEvent[]): void => {
      // Most transcript lines are tool output; skip the JSON parse for those.
      if (!mightCarryClaudeUsage(line) && !line.includes('"result"')) return
      const parsed = parseClaudeLine(line, fallbackId)
      facts = mergeFacts(facts, {
        session_id: parsed.session_id,
        cwd: parsed.cwd,
        started_at_ms: parsed.timestamp_ms,
        ended_at_ms: parsed.timestamp_ms,
        duration_ms: parsed.duration_ms,
        total_cost_usd: parsed.total_cost_usd,
        status: parsed.is_result
          ? parsed.result_is_error
            ? 'error'
            : 'complete'
          : 'unknown'
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

/**
 * Scans every Claude transcript on disk.
 *
 * There is deliberately no cap on file count: the scan cache makes an
 * unchanged file free, so bounding the scan would only hide history.
 */
export function collectClaudeSessions(
  home: string,
  cache: ScanCache = new Map()
): CollectedUsage {
  const projects = join(home, 'projects')
  if (!existsSync(projects)) return { sessions: [], events: [] }

  const events: UsageEvent[] = []
  const factsBySession = new Map<string, ClaudeFileFacts>()

  for (const path of listJsonlFiles(projects)) {
    const fallbackId = basename(path).replace(/\.jsonl$/i, '')
    const previous = new Map(factsBySession)
    const result = readCached<null>(cache, path, 'claude', (chunk) =>
      parseChunk(
        fallbackId,
        chunk.start_offset === 0
          ? emptyFacts()
          : (previous.get(fallbackId) ?? emptyFacts())
      )(chunk)
    )
    if (!result) continue

    const fileFacts = (result.facts as ClaudeFileFacts | undefined) ?? emptyFacts()
    const sessionId = fileFacts.session_id ?? fallbackId
    factsBySession.set(
      sessionId,
      mergeFacts(factsBySession.get(sessionId) ?? emptyFacts(), fileFacts)
    )
    events.push(...result.events)
  }

  const facts: SessionFacts[] = []
  for (const [sessionId, fileFacts] of factsBySession) {
    facts.push({
      id: `claude:${sessionId}`,
      provider: 'claude',
      project: projectNameFromCwd(fileFacts.cwd),
      status: fileFacts.status,
      started_at: isoOrNull(fileFacts.started_at_ms),
      ended_at: isoOrNull(fileFacts.ended_at_ms),
      duration_ms:
        fileFacts.duration_ms ??
        durationBetween(fileFacts.started_at_ms, fileFacts.ended_at_ms),
      provider_cost_usd: fileFacts.total_cost_usd,
      source: CLAUDE_SOURCE
    })
  }

  // De-duplication runs across files, not within one: a resumed or branched
  // session replays earlier messages into a new transcript, and those repeats
  // carry the same message/request pair.
  return collectUsage(events, facts)
}

function listJsonlFiles(root: string): string[] {
  const output: string[] = []
  const walk = (dir: string): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[]
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl')) output.push(path)
    }
  }
  walk(root)
  return output
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

function durationBetween(start: number | null, end: number | null): number | null {
  if (start === null || end === null || end < start) return null
  return end - start
}
