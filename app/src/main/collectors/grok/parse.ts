/**
 * Pure line parser for Grok Build session logs (`updates.jsonl`).
 *
 * Usage lands only on `turn_completed` updates. The previous collector summed
 * every line carrying a `usage` object, which counts interim updates on top of
 * the completed turn they belong to; gating on the update kind fixes that.
 *
 * Per-model breakdowns live under `usage.modelUsage`. When present each model
 * becomes its own event, so a turn that used two models is priced at two rates
 * rather than one.
 */
import { splitInput, tokenCount, type TokenTotals } from '../../../shared/tokens'
import type { UsageEvent } from '../../../shared/types'

export const GROK_SOURCE = 'grok:session-updates'

/**
 * Grok reports cost in integer ticks. The divisor below is what T3 Code
 * derived from Grok headless `total_cost_usd_ticks`; the previous
 * implementation here used 1e9, which overstates provider-reported cost
 * tenfold if 1e10 is right.
 */
export const GROK_COST_TICKS_PER_USD = 10_000_000_000

export function mightCarryGrokUsage(line: string): boolean {
  return line.includes('"turn_completed"')
}

export interface GrokLineExtras {
  /** Wall-clock the provider spent in API calls, summed by the caller. */
  api_duration_ms: number
  model_calls: number
}

export interface GrokLineResult {
  events: UsageEvent[]
  extras: GrokLineExtras
}

const EMPTY: GrokLineResult = {
  events: [],
  extras: { api_duration_ms: 0, model_calls: 0 }
}

export function parseGrokLine(line: string, sessionId: string): GrokLineResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return EMPTY
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY

  const record = parsed as Record<string, unknown>
  const params = asRecord(record.params)
  const update = params ? asRecord(params.update) : null
  if (!update || update.sessionUpdate !== 'turn_completed') return EMPTY

  const usage = asRecord(update.usage)
  if (!usage) return EMPTY

  const timestampMs = resolveTimestampMs(params, record)
  if (timestampMs === null) return EMPTY

  const session = stringOrNull(params?.sessionId) ?? sessionId
  // Every event of a turn shares the turn's identity, so a re-read of the file
  // upserts rather than duplicates. The model disambiguates within the turn.
  const promptId =
    stringOrNull(update.prompt_id) ?? stringOrNull(update.promptId) ?? String(timestampMs)

  const apiDurationMs = nonNegative(usage.apiDurationMs) ?? 0
  const modelUsage = asRecord(usage.modelUsage)
  const events: UsageEvent[] = []
  let modelCalls = 0

  if (modelUsage) {
    for (const [model, raw] of Object.entries(modelUsage)) {
      const totals = asRecord(raw)
      if (!model || !totals) continue
      const tokens = readTotals(totals)
      if (isEmptyTotals(tokens)) continue
      modelCalls += Math.max(1, nonNegative(totals.modelCalls) ?? 1)
      events.push({
        dedupe_key: `grok:${session}:${promptId}:${model}`,
        provider: 'grok',
        session_id: session,
        project: '',
        model,
        ts_ms: timestampMs,
        tokens,
        reported_cost_usd: costFromTicks(totals.costUsdTicks),
        source: GROK_SOURCE
      })
    }
  }

  if (events.length === 0) {
    const tokens = readTotals(usage)
    if (isEmptyTotals(tokens)) return EMPTY
    const meta = asRecord(update._meta) ?? asRecord(params?._meta)
    events.push({
      dedupe_key: `grok:${session}:${promptId}`,
      provider: 'grok',
      session_id: session,
      project: '',
      // Without a per-model breakdown the turn is attributed to whatever model
      // the update names; an unnamed one stays unpriced rather than guessed.
      model: stringOrNull(meta?.modelId) ?? stringOrNull(update.modelId) ?? '',
      ts_ms: timestampMs,
      tokens,
      reported_cost_usd: costFromTicks(usage.costUsdTicks),
      source: GROK_SOURCE
    })
    modelCalls = Math.max(1, nonNegative(usage.modelCalls) ?? 1)
  }

  return { events, extras: { api_duration_ms: apiDurationMs, model_calls: modelCalls } }
}

function readTotals(record: Record<string, unknown>): TokenTotals {
  const output = tokenCount(record.outputTokens)
  return {
    // Grok reports inputTokens inclusive of the cached portion, like Codex.
    ...splitInput(
      tokenCount(record.inputTokens),
      tokenCount(record.cachedReadTokens),
      tokenCount(record.cacheCreationTokens)
    ),
    output,
    reasoning: Math.min(output, tokenCount(record.reasoningTokens))
  }
}

function isEmptyTotals(tokens: TokenTotals): boolean {
  return (
    tokens.uncached_input +
      tokens.cached_input +
      tokens.cache_creation +
      tokens.output ===
    0
  )
}

export function costFromTicks(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  return value / GROK_COST_TICKS_PER_USD
}

/** Prefer the high-resolution agent clock; fall back to the outer stamp. */
function resolveTimestampMs(
  params: Record<string, unknown> | null,
  record: Record<string, unknown>
): number | null {
  const meta = params ? asRecord(params._meta) : null
  const agent = meta?.agentTimestampMs
  if (typeof agent === 'number' && Number.isFinite(agent)) return agent

  const timestamp = record.timestamp
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    // Grok writes seconds here; anything past 1e12 is already milliseconds.
    return timestamp > 1e12 ? timestamp : timestamp * 1000
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}
