/** Pure parser for Cursor Agent transcript JSONL records. */
import { splitInput, tokenCount, totalTokens, type TokenTotals } from '../../../shared/tokens'
import type { SessionStatus, UsageEvent } from '../../../shared/types'

export const CURSOR_SOURCE = 'cursor:agent-transcript'

export interface CursorLineResult {
  event: UsageEvent | null
  session_id: string | null
  cwd: string | null
  timestamp_ms: number | null
  status: SessionStatus
}

const EMPTY: CursorLineResult = {
  event: null,
  session_id: null,
  cwd: null,
  timestamp_ms: null,
  status: 'unknown'
}

export function mightCarryCursorUsage(line: string): boolean {
  return line.includes('"usage"') || line.includes('"turn_ended"')
}

/**
 * Cursor has shipped more than one transcript usage shape. The native
 * Anthropic-shaped fields report uncached input separately; hook/headless
 * camelCase fields report total input and therefore need splitting.
 */
export function parseCursorLine(
  line: string,
  fallbackSessionId: string
): CursorLineResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return EMPTY
  }
  const record = asRecord(parsed)
  if (!record) return EMPTY

  const message = asRecord(record.message)
  const timestampMs = parseTimestampMs(record.timestamp ?? message?.timestamp)
  const sessionId =
    stringOrNull(record.conversation_id) ??
    stringOrNull(record.session_id) ??
    stringOrNull(record.sessionId)
  const cwd =
    stringOrNull(record.cwd) ??
    stringOrNull(record.workspace_root) ??
    stringOrNull(record.workspaceRoot)
  const type = stringOrNull(record.type)

  if (type === 'turn_ended' || type === 'result') {
    return {
      ...EMPTY,
      session_id: sessionId,
      cwd,
      timestamp_ms: timestampMs,
      status: record.is_error === true || record.status === 'error' ? 'error' : 'complete'
    }
  }

  const role = stringOrNull(record.role) ?? stringOrNull(message?.role)
  if (type !== 'assistant' && role !== 'assistant') {
    return { ...EMPTY, session_id: sessionId, cwd, timestamp_ms: timestampMs }
  }

  const usage = asRecord(record.usage) ?? asRecord(message?.usage)
  if (!usage || timestampMs === null) {
    return { ...EMPTY, session_id: sessionId, cwd, timestamp_ms: timestampMs }
  }

  const output = tokenCount(usage.output_tokens ?? usage.outputTokens)
  const reasoning = Math.min(
    output,
    tokenCount(usage.reasoning_tokens ?? usage.reasoningTokens)
  )
  let input: Pick<TokenTotals, 'uncached_input' | 'cached_input' | 'cache_creation'>

  if (
    'cache_read_input_tokens' in usage ||
    'cache_creation_input_tokens' in usage
  ) {
    input = {
      // In the provider-native Anthropic shape input_tokens excludes both
      // cache fields, just as it does in Claude Code's transcript.
      uncached_input: tokenCount(usage.input_tokens),
      cached_input: tokenCount(usage.cache_read_input_tokens),
      cache_creation: tokenCount(usage.cache_creation_input_tokens)
    }
  } else {
    input = splitInput(
      tokenCount(usage.input_tokens ?? usage.inputTokens),
      tokenCount(usage.cache_read_tokens ?? usage.cacheReadTokens),
      tokenCount(usage.cache_write_tokens ?? usage.cacheWriteTokens)
    )
  }

  const tokens: TokenTotals = { ...input, output, reasoning }
  if (totalTokens(tokens) === 0) {
    return { ...EMPTY, session_id: sessionId, cwd, timestamp_ms: timestampMs }
  }

  const resolvedSession = sessionId ?? fallbackSessionId
  const model =
    stringOrNull(record.model_id) ??
    stringOrNull(record.model) ??
    stringOrNull(message?.model_id) ??
    stringOrNull(message?.model) ??
    ''
  const eventId =
    stringOrNull(record.generation_id) ??
    stringOrNull(record.id) ??
    stringOrNull(message?.id) ??
    `${timestampMs}:${model}:${totalTokens(tokens)}`

  return {
    event: {
      dedupe_key: `cursor:${resolvedSession}:${eventId}`,
      provider: 'cursor',
      session_id: resolvedSession,
      project: '',
      model,
      ts_ms: timestampMs,
      tokens,
      reported_cost_usd: null,
      source: CURSOR_SOURCE
    },
    session_id: sessionId,
    cwd,
    timestamp_ms: timestampMs,
    status: 'unknown'
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

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}
