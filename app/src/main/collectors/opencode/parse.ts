/**
 * Pure mapper for OpenCode assistant messages.
 *
 * OpenCode stores usage in SQLite rather than JSONL, one row per message with
 * a JSON `data` blob. Only that blob is read — prompt and response text live in
 * the separate `part` table, which this collector never touches.
 *
 * Two provider-specific facts drive the mapping:
 *
 * - `tokens.input` **excludes** the cached half, unlike Codex and Grok where it
 *   includes it. It maps straight to `uncached_input`.
 * - `tokens.reasoning` is a **sibling** of `output` in OpenCode's total, not a
 *   subset of it as with Anthropic. The canonical model treats reasoning as
 *   part of output, so it is folded in — otherwise the totals would not
 *   reconcile with OpenCode's own `tokens.total`.
 */
import { tokenCount, type TokenTotals } from '../../../shared/tokens'
import type { UsageEvent } from '../../../shared/types'

export const OPENCODE_SOURCE = 'opencode:sqlite'

export interface OpenCodeMessageRow {
  id: string
  session_id: string
  data: string
}

/**
 * Builds the rate-table key.
 *
 * OpenCode records the upstream provider separately (`xai` + `grok-4.3`), and
 * LiteLLM keys those as `xai/grok-4.3`, so the qualified form is preferred; the
 * rate lookup falls back to the bare model name on its own.
 */
export function openCodeModelKey(
  providerId: unknown,
  modelId: unknown
): string {
  const model = typeof modelId === 'string' ? modelId.trim() : ''
  if (!model) return ''
  const provider = typeof providerId === 'string' ? providerId.trim() : ''
  return provider ? `${provider}/${model}` : model
}

export interface OpenCodeMessage {
  event: UsageEvent | null
  cwd: string | null
  cost_usd: number | null
  completed_at_ms: number | null
}

const EMPTY: OpenCodeMessage = {
  event: null,
  cwd: null,
  cost_usd: null,
  completed_at_ms: null
}

export function parseOpenCodeMessage(row: OpenCodeMessageRow): OpenCodeMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(row.data)
  } catch {
    return EMPTY
  }
  if (!parsed || typeof parsed !== 'object') return EMPTY

  const record = parsed as Record<string, unknown>
  if (record.role !== 'assistant') return EMPTY

  const usage = asRecord(record.tokens)
  if (!usage) return EMPTY

  const cache = asRecord(usage.cache)
  const output = tokenCount(usage.output)
  const reasoning = tokenCount(usage.reasoning)

  const tokens: TokenTotals = {
    uncached_input: tokenCount(usage.input),
    cached_input: tokenCount(cache?.read),
    cache_creation: tokenCount(cache?.write),
    // Folded together so `reasoning` stays a subset of `output`, which is the
    // invariant every consumer relies on.
    output: output + reasoning,
    reasoning
  }

  const total =
    tokens.uncached_input +
    tokens.cached_input +
    tokens.cache_creation +
    tokens.output
  if (total === 0) return EMPTY

  const time = asRecord(record.time)
  const createdMs = epochMs(time?.created)
  if (createdMs === null) return EMPTY

  const path = asRecord(record.path)
  const cost = record.cost

  return {
    cwd:
      stringOrNull(path?.cwd) ?? stringOrNull(path?.root) ?? null,
    cost_usd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    completed_at_ms: epochMs(time?.completed),
    event: {
      // Message ids are unique within OpenCode's store, so a rescan upserts.
      dedupe_key: `opencode:${row.id}`,
      provider: 'opencode',
      session_id: row.session_id,
      project: '',
      model: openCodeModelKey(record.providerID, record.modelID),
      ts_ms: createdMs,
      tokens,
      // OpenCode bills through the user's own provider keys and records what
      // it actually cost, which is a real bill rather than an equivalent.
      reported_cost_usd:
        typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
      source: OPENCODE_SOURCE
    }
  }
}

/** OpenCode writes epoch milliseconds; guard against seconds just in case. */
function epochMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value > 1e12 ? value : value * 1000
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}
