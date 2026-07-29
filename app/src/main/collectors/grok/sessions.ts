import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync
} from 'fs'
import { basename, join } from 'path'
import Database from 'better-sqlite3'
import type { SessionRow } from '../../../shared/types'
import { projectNameFromCwd } from '../../util/project'
import { getGrokHome } from '../../util/paths'
import { apiEquivUsd } from '../../pricing/rates'
import { dominantModel, normalizeModelName } from '../models'

const MAX_SESSIONS = 250

interface SessionDocRow {
  session_id: string
  cwd: string | null
  updated_at: number | string | null
}

export interface GrokUsageTotals {
  tokensIn: number | null
  tokensOut: number | null
  tokensTotal: number | null
  tokensCached: number | null
  tokensReasoning: number | null
  modelCalls: number | null
  model: string | null
  apiDurationMs: number | null
  providerCostUsd: number | null
}

interface CachedUsage {
  size: number
  mtimeMs: number
  value: GrokUsageTotals
}

const usageCache = new Map<string, CachedUsage>()

/**
 * Collect Grok metadata from session summaries and usage-only fields in
 * updates.jsonl. Prompt and response fields are never returned or persisted.
 */
export function collectGrokSessions(home = getGrokHome()): SessionRow[] {
  const sessionsRoot = join(home, 'sessions')
  if (!existsSync(sessionsRoot)) return []

  const active = readActiveSessions(home)
  const indexed = readIndexedSessions(sessionsRoot)
  const rows: SessionRow[] = []
  const seen = new Set<string>()

  const dirs = listSessionDirectories(sessionsRoot)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SESSIONS)

  for (const entry of dirs) {
    const summary = readJsonObject(join(entry.path, 'summary.json'))
    if (!summary) continue
    const info = asRecord(summary.info)
    const id = stringValue(info?.id) ?? basename(entry.path)
    if (!id || seen.has(id)) continue

    const updatesPath = join(entry.path, 'updates.jsonl')
    const usage = readUsageFile(updatesPath)
    // Summary/index shells contain no measured usage and previously polluted
    // totals/session tables with zero-value records.
    if (usage.tokensTotal == null) continue
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
    const summaryModel = normalizeModelName(
      'grok',
      summary.current_model_id
    )
    const model = usage.model ?? summaryModel ?? 'Grok'
    const durationMs = durationBetween(startedAt, endedAt) ?? usage.apiDurationMs

    seen.add(id)
    rows.push({
      id: `grok:${id}`,
      provider: 'grok',
      project: projectNameFromCwd(cwd),
      model,
      tokens_in: usage.tokensIn,
      tokens_out: usage.tokensOut,
      tokens_total: usage.tokensTotal,
      tokens_cached: usage.tokensCached,
      tokens_reasoning: usage.tokensReasoning,
      model_calls: usage.modelCalls,
      api_equiv_usd: apiEquivUsd(model, usage.tokensTotal),
      provider_cost_usd: usage.providerCostUsd,
      api_duration_ms: usage.apiDurationMs,
      duration_ms: durationMs,
      status: active.has(id) ? 'unknown' : 'complete',
      started_at: startedAt,
      ended_at: active.has(id) ? null : endedAt,
      source: 'grok:session-files'
    })
  }

  return rows
}

/** Parse and aggregate only Grok's structured usage objects. */
export function parseGrokUsageUpdates(text: string): GrokUsageTotals {
  let tokensIn = 0
  let tokensOut = 0
  let tokensTotal = 0
  let apiDurationMs = 0
  let tokensCached = 0
  let tokensReasoning = 0
  let modelCalls = 0
  let providerCostTicks = 0
  let foundUsage = false
  const observedModels: string[] = []

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    let root: Record<string, unknown>
    try {
      root = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const params = asRecord(root.params)
    const update = asRecord(params?.update)
    const usage = asRecord(update?.usage)
    if (!usage) continue

    const input = finiteNumber(usage.inputTokens)
    const output = finiteNumber(usage.outputTokens)
    const total = finiteNumber(usage.totalTokens)
    if (input == null && output == null && total == null) continue

    foundUsage = true
    tokensIn += input ?? 0
    tokensOut += output ?? 0
    tokensTotal += total ?? (input ?? 0) + (output ?? 0)
    apiDurationMs += finiteNumber(usage.apiDurationMs) ?? 0
    tokensCached += finiteNumber(usage.cachedReadTokens) ?? 0
    tokensReasoning += finiteNumber(usage.reasoningTokens) ?? 0
    const topLevelCalls = finiteNumber(usage.modelCalls)
    modelCalls += topLevelCalls ?? 0
    providerCostTicks += finiteNumber(usage.costUsdTicks) ?? 0

    const modelUsage = asRecord(usage.modelUsage)
    if (modelUsage) {
      let nestedCalls = 0
      for (const [model, modelRaw] of Object.entries(modelUsage)) {
        const modelTotals = asRecord(modelRaw)
        const calls = Math.max(1, finiteNumber(modelTotals?.modelCalls) ?? 1)
        nestedCalls += calls
        for (let index = 0; index < calls; index++) observedModels.push(model)
      }
      if (topLevelCalls == null) modelCalls += nestedCalls
    }
    const meta = asRecord(update?._meta)
    const fallbackModel = stringValue(meta?.modelId)
    if (!modelUsage && fallbackModel) observedModels.push(fallbackModel)
  }

  return {
    tokensIn: foundUsage ? tokensIn : null,
    tokensOut: foundUsage ? tokensOut : null,
    tokensTotal: foundUsage ? tokensTotal : null,
    tokensCached: foundUsage ? tokensCached : null,
    tokensReasoning: foundUsage ? tokensReasoning : null,
    modelCalls: foundUsage ? modelCalls : null,
    model: dominantModel('grok', observedModels),
    apiDurationMs: foundUsage && apiDurationMs > 0 ? apiDurationMs : null,
    providerCostUsd:
      foundUsage && providerCostTicks > 0
        ? +(providerCostTicks / 1_000_000_000).toFixed(6)
        : null
  }
}

function readUsageFile(path: string): GrokUsageTotals {
  if (!existsSync(path)) return emptyUsage()
  try {
    const stat = statSync(path)
    const cached = usageCache.get(path)
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.value
    }
    const value = parseGrokUsageUpdates(readFileSync(path, 'utf-8'))
    usageCache.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, value })
    return value
  } catch {
    return emptyUsage()
  }
}

function emptyUsage(): GrokUsageTotals {
  return {
    tokensIn: null,
    tokensOut: null,
    tokensTotal: null,
    tokensCached: null,
    tokensReasoning: null,
    modelCalls: null,
    model: null,
    apiDurationMs: null,
    providerCostUsd: null
  }
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
  return output
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

function readIndexedSessions(root: string): Map<string, { cwd: string | null; updated_at: string | null }> {
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
         LIMIT ${MAX_SESSIONS}`
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

function readActiveSessions(home: string): Map<string, { cwd: string | null; opened_at: string | null }> {
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

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
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
