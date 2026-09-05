/**
 * Pure line parser for Claude Code transcripts (`~/.claude/projects/**.jsonl`).
 *
 * Claude writes one record per assistant **content block**, and every one of
 * them repeats the same complete `usage` object for the parent message.
 * Summing them without dropping repeats overcounts several-fold, which is why
 * `dedupe_key` is `messageId:requestId` — the pair `ccusage` uses — and why
 * de-duplication has to happen across files, not just within one: a resumed or
 * branched session replays earlier messages into a new transcript.
 */
import { tokenCount, type TokenTotals } from '../../../shared/tokens'
import type { UsageEvent } from '../../../shared/types'

export const CLAUDE_SOURCE = 'claude:projects-jsonl'

/** Claude Code's placeholder for a message it composed itself, not a model call. */
export const SYNTHETIC_MODEL = '<synthetic>'

/** Cheap gate applied before `JSON.parse`; most transcript lines are tool output. */
export function mightCarryClaudeUsage(line: string): boolean {
  return line.includes('"usage"')
}

export interface ClaudeLineResult {
  event: UsageEvent | null
  /** Session-level facts a `result` line carries, folded in by the caller. */
  cwd: string | null
  session_id: string | null
  timestamp_ms: number | null
  is_result: boolean
  result_is_error: boolean
  duration_ms: number | null
  total_cost_usd: number | null
}

const EMPTY: ClaudeLineResult = {
  event: null,
  cwd: null,
  session_id: null,
  timestamp_ms: null,
  is_result: false,
  result_is_error: false,
  duration_ms: null,
  total_cost_usd: null
}

export function parseClaudeLine(
  line: string,
  fallbackSessionId: string
): ClaudeLineResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return EMPTY
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY

  const record = parsed as Record<string, unknown>
  const sessionId =
    stringOrNull(record.sessionId) ?? stringOrNull(record.session_id)
  const cwd = stringOrNull(record.cwd)
  const timestampMs = parseTimestampMs(record.timestamp)

  if (record.type === 'result') {
    return {
      ...EMPTY,
      cwd,
      session_id: sessionId,
      timestamp_ms: timestampMs,
      is_result: true,
      result_is_error: record.is_error === true,
      duration_ms: nonNegative(record.duration_ms),
      total_cost_usd: nonNegative(record.total_cost_usd)
    }
  }

  if (record.type !== 'assistant') {
    return { ...EMPTY, cwd, session_id: sessionId, timestamp_ms: timestampMs }
  }

  const message = asRecord(record.message)
  const usage = message ? asRecord(message.usage) : null
  if (!message || !usage || timestampMs === null) {
    return { ...EMPTY, cwd, session_id: sessionId, timestamp_ms: timestampMs }
  }

  const model = stringOrNull(message.model)
  // `<synthetic>` marks a message Claude Code composed locally — a rate-limit
  // notice, an interrupted turn — not a model call. Its usage is all zeros, so
  // counting it would add a phantom model call and, because the placeholder
  // has no rate, flag an otherwise fully priced session as unpriced.
  if (!model || model === SYNTHETIC_MODEL) {
    return { ...EMPTY, cwd, session_id: sessionId, timestamp_ms: timestampMs }
  }

  const tokens: TokenTotals = {
    uncached_input: tokenCount(usage.input_tokens),
    cached_input: tokenCount(usage.cache_read_input_tokens),
    cache_creation: tokenCount(usage.cache_creation_input_tokens),
    output: tokenCount(usage.output_tokens),
    // Anthropic folds thinking tokens into output_tokens and does not break
    // them out, so claiming a reasoning split here would be invention.
    reasoning: 0
  }

  // A record with no tokens carries no usage — matching the Codex and Grok
  // parsers, which already drop these.
  if (
    tokens.uncached_input + tokens.cached_input + tokens.cache_creation +
      tokens.output ===
    0
  ) {
    return { ...EMPTY, cwd, session_id: sessionId, timestamp_ms: timestampMs }
  }

  const messageId = stringOrNull(message.id)
  const requestId = stringOrNull(record.requestId)
  const resolvedSession = sessionId ?? fallbackSessionId

  return {
    ...EMPTY,
    cwd,
    session_id: sessionId,
    timestamp_ms: timestampMs,
    event: {
      // A record carrying neither id cannot be recognised again, so it gets a
      // key unique to its position instead — never merged, never dropped.
      dedupe_key:
        messageId || requestId
          ? `claude:${messageId ?? ''}:${requestId ?? ''}`
          : `claude:${resolvedSession}:${timestampMs}:${tokens.output}`,
      provider: 'claude',
      session_id: resolvedSession,
      project: '',
      model,
      ts_ms: timestampMs,
      tokens,
      reported_cost_usd: null,
      source: CLAUDE_SOURCE
    }
  }
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

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
