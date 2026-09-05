import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { UsageEvent } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { getCodexHome } from '../../util/paths'
import { collectUsage, type CollectedUsage, type SessionFacts } from '../aggregate'
import {
  readCached,
  splitLines,
  type ParseChunk,
  type ParseOutput,
  type ScanCache
} from '../scanCache'
import {
  CODEX_SOURCE,
  initialCodexScanState,
  mightCarryCodexUsage,
  parseCodexLine,
  type CodexScanState
} from './parse'

/**
 * Parses one chunk of a Codex rollout.
 *
 * Unlike Claude's, this parser carries state across lines — the current model,
 * the fork-suppression window, the duplicate-event signature — so the cache
 * stores that state at the resume offset and hands it back on the next scan.
 */
function parseChunk(chunk: ParseChunk<CodexScanState>): ParseOutput<CodexScanState> {
  const split = splitLines(chunk.text)
  const state = chunk.state
    ? { ...chunk.state }
    : initialCodexScanState()
  const events: UsageEvent[] = []
  const tailEvents: UsageEvent[] = []

  for (const line of split.lines) {
    if (!mightCarryCodexUsage(line)) continue
    const event = parseCodexLine(line, state)
    if (event) events.push(event)
  }

  // The unterminated tail is parsed against a copy: it will be re-read once the
  // writer finishes the line, and must not advance the persisted state.
  if (split.tail.trim() && mightCarryCodexUsage(split.tail)) {
    const tailState = { ...state }
    const event = parseCodexLine(split.tail, tailState)
    if (event) tailEvents.push(event)
  }

  return {
    events,
    tail_events: tailEvents,
    facts: {
      session_id: state.session_id,
      cwd: state.cwd,
      started_at_ms: state.started_at_ms,
      ended_at_ms: state.ended_at_ms,
      duration_ms: state.duration_ms,
      status_complete: state.status_complete
    },
    state,
    consumed: split.consumed
  }
}

interface CodexFileFacts {
  session_id: string
  cwd: string | null
  started_at_ms: number | null
  ended_at_ms: number | null
  duration_ms: number | null
  status_complete: boolean
}

/**
 * Scans every Codex rollout on disk.
 *
 * The previous implementation read the newest 80 files in full on every scan
 * and cached nothing, so an active session re-read them all each time a
 * watcher fired.
 */
export function collectCodexSessions(
  home = getCodexHome(),
  cache: ScanCache = new Map()
): CollectedUsage {
  const sessionsDir = join(home, 'sessions')
  if (!existsSync(sessionsDir)) return { sessions: [], events: [] }

  const events: UsageEvent[] = []
  const facts: SessionFacts[] = []
  const seen = new Set<string>()

  for (const path of listJsonlFiles(sessionsDir)) {
    const result = readCached<CodexScanState>(cache, path, 'codex', parseChunk)
    if (!result) continue

    const fileFacts = result.facts as CodexFileFacts | undefined
    const sessionId = fileFacts?.session_id || fallbackSessionId(path)
    if (!sessionId || seen.has(sessionId)) {
      events.push(...result.events)
      continue
    }
    seen.add(sessionId)

    events.push(...result.events)
    facts.push({
      id: `codex:${sessionId}`,
      provider: 'codex',
      project: projectNameFromCwd(fileFacts?.cwd ?? null),
      status: fileFacts?.status_complete ? 'complete' : 'unknown',
      started_at: isoOrNull(fileFacts?.started_at_ms ?? null),
      ended_at: isoOrNull(fileFacts?.ended_at_ms ?? null),
      duration_ms:
        fileFacts?.duration_ms ??
        durationBetween(
          fileFacts?.started_at_ms ?? null,
          fileFacts?.ended_at_ms ?? null
        ),
      source: CODEX_SOURCE
    })
  }

  return collectUsage(events, facts)
}

function fallbackSessionId(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? ''
  const match = base.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)
  return match?.[1] ?? base.replace(/\.jsonl$/i, '')
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

function isoOrNull(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

function durationBetween(start: number | null, end: number | null): number | null {
  if (start === null || end === null || end < start) return null
  return end - start
}
