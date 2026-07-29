import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { SessionRow } from '../../../shared/types'
import { apiEquivUsd } from '../../pricing/rates'
import { projectNameFromCwd } from '../../util/project'
import { dominantModel } from '../models'

const MAX_FILES = 250

interface CacheEntry {
  size: number
  mtimeMs: number
  row: SessionRow | null
}

const cache = new Map<string, CacheEntry>()

export function collectClaudeSessions(home: string): SessionRow[] {
  const projects = join(home, 'projects')
  if (!existsSync(projects)) return []
  return listJsonlFiles(projects)
    .map((path) => ({ path, mtimeMs: safeStat(path)?.mtimeMs ?? 0 }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_FILES)
    .map(({ path }) => readCached(path))
    .filter((row): row is SessionRow => row?.tokens_total != null)
}

export function parseClaudeSession(text: string, fallbackId: string): SessionRow | null {
  let sessionId: string | null = null
  let cwd: string | null = null
  let startedAt: string | null = null
  let endedAt: string | null = null
  let durationMs: number | null = null
  let providerCostUsd: number | null = null
  let status: SessionRow['status'] = 'unknown'
  let tokensIn = 0
  let tokensOut = 0
  let tokensCached = 0
  let modelCalls = 0
  let foundUsage = false
  const models: string[] = []
  const messageIds = new Set<string>()

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let root: Record<string, unknown>
    try {
      root = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    sessionId = stringValue(root.sessionId) ?? stringValue(root.session_id) ?? sessionId
    cwd = stringValue(root.cwd) ?? cwd
    const timestamp = isoTimestamp(root.timestamp)
    if (timestamp) {
      if (!startedAt || timestamp < startedAt) startedAt = timestamp
      if (!endedAt || timestamp > endedAt) endedAt = timestamp
    }

    const type = stringValue(root.type)
    const message = asRecord(root.message)
    if (type === 'assistant' && message) {
      const messageId = stringValue(message.id)
      if (messageId && messageIds.has(messageId)) continue
      if (messageId) messageIds.add(messageId)
      const usage = asRecord(message.usage)
      if (usage) {
        tokensIn += numberValue(usage.input_tokens)
        tokensOut += numberValue(usage.output_tokens)
        tokensCached +=
          numberValue(usage.cache_read_input_tokens) +
          numberValue(usage.cache_creation_input_tokens)
        foundUsage = true
        modelCalls++
      }
      const model = stringValue(message.model)
      if (model) models.push(model)
    }

    if (type === 'result') {
      status = root.is_error === true ? 'error' : 'complete'
      durationMs = finiteNumber(root.duration_ms) ?? durationMs
      providerCostUsd = finiteNumber(root.total_cost_usd) ?? providerCostUsd
    }
  }

  const id = sessionId ?? fallbackId
  if (!id) return null
  const model = dominantModel('claude', models) ?? 'Claude'
  const tokensTotal = foundUsage ? tokensIn + tokensOut : null
  if (durationMs == null && startedAt && endedAt) {
    const start = Date.parse(startedAt)
    const end = Date.parse(endedAt)
    if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
      durationMs = end - start
    }
  }

  return {
    id: `claude:${id}`,
    provider: 'claude',
    project: projectNameFromCwd(cwd),
    model,
    tokens_in: foundUsage ? tokensIn : null,
    tokens_out: foundUsage ? tokensOut : null,
    tokens_total: tokensTotal,
    tokens_cached: foundUsage ? tokensCached : null,
    tokens_reasoning: null,
    model_calls: foundUsage ? modelCalls : null,
    api_equiv_usd: apiEquivUsd(model, tokensTotal),
    provider_cost_usd: providerCostUsd,
    api_duration_ms: null,
    duration_ms: durationMs,
    status,
    started_at: startedAt,
    ended_at: endedAt,
    source: 'claude:projects-jsonl'
  }
}

function readCached(path: string): SessionRow | null {
  const stat = safeStat(path)
  if (!stat) return null
  const previous = cache.get(path)
  if (previous && previous.size === stat.size && previous.mtimeMs === stat.mtimeMs) {
    return previous.row
  }
  try {
    const row = parseClaudeSession(
      readFileSync(path, 'utf-8'),
      basename(path).replace(/\.jsonl$/i, '')
    )
    cache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, row })
    return row
  } catch {
    return null
  }
}

function listJsonlFiles(root: string): string[] {
  const output: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown): number {
  return finiteNumber(value) ?? 0
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function safeStat(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}
