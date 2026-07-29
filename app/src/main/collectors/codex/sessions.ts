import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import type { SessionRow } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { apiEquivUsd } from '../../pricing/rates'
import { getCodexHome } from '../../util/paths'
import { dominantModel } from '../models'

const MAX_FILES = 80

/**
 * Parse Codex rollout JSONL files for metadata + token totals.
 * Never stores message/prompt content.
 */
export function collectCodexSessions(home = getCodexHome()): SessionRow[] {
  const sessionsDir = join(home, 'sessions')
  if (!existsSync(sessionsDir)) return []

  const files = listJsonlFiles(sessionsDir)
    .map((p) => ({ path: p, mtime: safeMtime(p) }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, MAX_FILES)

  const out: SessionRow[] = []
  for (const f of files) {
    const row = parseSessionFile(f.path)
    if (row) out.push(row)
  }
  return out
}

function listJsonlFiles(dir: string): string[] {
  const results: string[] = []
  const walk = (d: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(d, name)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else if (name.endsWith('.jsonl')) results.push(full)
    }
  }
  walk(dir)
  return results
}

function safeMtime(p: string): number {
  try {
    return statSync(p).mtimeMs
  } catch {
    return 0
  }
}

function parseSessionFile(path: string): SessionRow | null {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return null
  }

  let sessionId: string | null = null
  let cwd: string | null = null
  let startedAt: string | null = null
  let endedAt: string | null = null
  const observedModels: string[] = []
  let tokensIn: number | null = null
  let tokensOut: number | null = null
  let tokensTotal: number | null = null
  let durationMs: number | null = null
  let status: SessionRow['status'] = 'unknown'

  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    if (!line.trim()) continue
    let obj: Record<string, unknown>
    try {
      obj = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    const type = obj.type
    const payload =
      obj.payload && typeof obj.payload === 'object'
        ? (obj.payload as Record<string, unknown>)
        : null

    if (type === 'session_meta' && payload) {
      if (typeof payload.session_id === 'string') sessionId = payload.session_id
      else if (typeof payload.id === 'string') sessionId = payload.id
      if (typeof payload.cwd === 'string') cwd = payload.cwd
      if (typeof payload.timestamp === 'string') startedAt = payload.timestamp
      else if (typeof obj.timestamp === 'string') startedAt = obj.timestamp
    }

    if (type === 'turn_context' && payload) {
      if (typeof payload.model === 'string' && payload.model) {
        observedModels.push(payload.model)
      }
      if (typeof payload.cwd === 'string') cwd = payload.cwd
    }

    if (type === 'event_msg' && payload) {
      const subtype = payload.type
      if (subtype === 'token_count') {
        const info =
          payload.info && typeof payload.info === 'object'
            ? (payload.info as Record<string, unknown>)
            : null
        const total =
          info?.total_token_usage && typeof info.total_token_usage === 'object'
            ? (info.total_token_usage as Record<string, unknown>)
            : null
        if (total) {
          if (typeof total.input_tokens === 'number') tokensIn = total.input_tokens
          if (typeof total.output_tokens === 'number') tokensOut = total.output_tokens
          if (typeof total.total_tokens === 'number') tokensTotal = total.total_tokens
        }
      }
      if (subtype === 'task_complete') {
        status = 'complete'
        if (typeof payload.duration_ms === 'number') durationMs = payload.duration_ms
        if (typeof payload.completed_at === 'string') endedAt = payload.completed_at
        if (typeof payload.started_at === 'string' && !startedAt) {
          startedAt = payload.started_at
        }
      }
    }
  }

  if (!sessionId) {
    // fallback: filename
    const base = path.split(/[/\\]/).pop() ?? ''
    const m = base.match(/([0-9a-f]{8}-[0-9a-f-]{27,})/i)
    sessionId = m?.[1] ?? base.replace(/\.jsonl$/, '')
  }

  const model = dominantModel('codex', observedModels) ?? 'Unknown'

  return {
    id: `codex:${sessionId}`,
    provider: 'codex',
    project: projectNameFromCwd(cwd),
    model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    tokens_total: tokensTotal,
    api_equiv_usd: apiEquivUsd(model, tokensTotal),
    duration_ms: durationMs,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    source: 'codex:sessions.jsonl'
  }
}
