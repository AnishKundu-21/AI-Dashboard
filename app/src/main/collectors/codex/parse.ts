/**
 * Pure line parser for Codex rollout files (`~/.codex/sessions/**.jsonl`).
 *
 * Two things make this harder than it looks:
 *
 * 1. `total_token_usage` is **cumulative** for the session, so it must never be
 *    summed across events. Per-turn deltas live in `last_token_usage`, and
 *    summing those reconciles with the final cumulative figure — provided
 *    consecutive duplicate events are dropped, which Codex re-emits on some
 *    stream boundaries.
 * 2. A forked or subagent rollout opens with the parent's entire history copied
 *    in, every line re-stamped to the fork instant. Those turns were already
 *    counted from the parent's own file, so the leading burst is suppressed.
 */
import { splitInput, tokenCount, type TokenTotals } from '../../../shared/tokens'
import type { UsageEvent } from '../../../shared/types'

export const CODEX_SOURCE = 'codex:rollout-jsonl'

/**
 * Copied parent lines are written in one synchronous burst; the child's first
 * real usage event only lands after an actual model turn. A second of
 * separation splits the two cleanly.
 */
const FORK_COPY_MAX_GAP_MS = 1000

export interface CodexScanState {
  model: string
  session_id: string
  cwd: string | null
  started_at_ms: number | null
  ended_at_ms: number | null
  duration_ms: number | null
  status_complete: boolean
  last_usage_signature: string | null
  saw_session_meta: boolean
  suppressing_fork_copies: boolean
  fork_copy_anchor_ms: number
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: '',
    session_id: '',
    cwd: null,
    started_at_ms: null,
    ended_at_ms: null,
    duration_ms: null,
    status_complete: false,
    last_usage_signature: null,
    saw_session_meta: false,
    suppressing_fork_copies: false,
    fork_copy_anchor_ms: 0
  }
}

export function mightCarryCodexUsage(line: string): boolean {
  return (
    line.includes('"token_count"') ||
    line.includes('"session_meta"') ||
    line.includes('"turn_context"') ||
    line.includes('"task_complete"')
  )
}

/** Feeds one line into `state`, returning an event when the line carried usage. */
export function parseCodexLine(
  line: string,
  state: CodexScanState
): UsageEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const payload = asRecord(record.payload)
  if (!payload) return null

  const timestampMs = parseTimestampMs(record.timestamp)

  if (record.type === 'session_meta') {
    // Only the first meta describes this file's own session. A forked rollout
    // repeats its ancestors' metas straight after; letting those through would
    // reassign every later event to an ancestor session.
    if (state.saw_session_meta) return null
    state.saw_session_meta = true
    state.session_id =
      stringOrNull(payload.id) ?? stringOrNull(payload.session_id) ?? ''
    state.cwd = stringOrNull(payload.cwd) ?? state.cwd
    state.started_at_ms =
      timestampMs ?? parseTimestampMs(payload.timestamp) ?? state.started_at_ms
    if (timestampMs !== null && isForkedSessionMeta(payload)) {
      state.suppressing_fork_copies = true
      state.fork_copy_anchor_ms = timestampMs
    }
    return null
  }

  if (record.type === 'turn_context') {
    // `token_count` carries no model of its own, so it is carried forward from
    // the most recent turn context. A session that switches models attributes
    // correctly from the switch onward.
    state.model = stringOrNull(payload.model) ?? state.model
    state.cwd = stringOrNull(payload.cwd) ?? state.cwd
    return null
  }

  if (payload.type === 'task_complete') {
    state.status_complete = true
    state.duration_ms = nonNegative(payload.duration_ms) ?? state.duration_ms
    state.ended_at_ms =
      parseTimestampMs(payload.completed_at) ?? timestampMs ?? state.ended_at_ms
    return null
  }

  if (payload.type !== 'token_count') return null

  const info = asRecord(payload.info)
  const last = info ? asRecord(info.last_token_usage) : null
  if (!last || timestampMs === null) return null

  // Only an otherwise-eligible event may consume the duplicate signature. A
  // token_count arriving before its turn_context has no model yet; poisoning
  // the signature with it would make the re-emitted copy — the one that does
  // have a model — look like a duplicate, losing those tokens entirely.
  if (!state.model) return null

  const signature = JSON.stringify(last)
  if (signature === state.last_usage_signature) return null
  state.last_usage_signature = signature

  if (state.suppressing_fork_copies) {
    if (timestampMs - state.fork_copy_anchor_ms < FORK_COPY_MAX_GAP_MS) {
      state.fork_copy_anchor_ms = timestampMs
      return null
    }
    state.suppressing_fork_copies = false
  }

  const output = tokenCount(last.output_tokens)
  const tokens: TokenTotals = {
    // Codex reports input_tokens inclusive of both cached halves.
    ...splitInput(
      tokenCount(last.input_tokens),
      tokenCount(last.cached_input_tokens),
      tokenCount(last.cache_write_input_tokens)
    ),
    output,
    // Reported inside output_tokens; surfaced separately for the token mix
    // and clamped so a bad payload cannot exceed its parent.
    reasoning: Math.min(output, tokenCount(last.reasoning_output_tokens))
  }

  if (
    tokens.uncached_input + tokens.cached_input + tokens.cache_creation + output ===
    0
  ) {
    return null
  }

  state.ended_at_ms = Math.max(state.ended_at_ms ?? 0, timestampMs) || timestampMs
  if (state.started_at_ms === null) state.started_at_ms = timestampMs

  return {
    // Events surviving fork suppression are unique to this rollout, so the key
    // only has to be stable across rescans of the same file.
    dedupe_key: `codex:${state.session_id}:${timestampMs}:${signature.length}:${output}`,
    provider: 'codex',
    session_id: state.session_id,
    project: '',
    model: state.model,
    ts_ms: timestampMs,
    tokens,
    // Codex does not report cost in the rollout.
    reported_cost_usd: null,
    source: CODEX_SOURCE
  }
}

/** Whether a `session_meta` payload marks the rollout as a fork or subagent. */
function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload.forked_from_id === 'string') return true
  const source = asRecord(payload.source)
  const subagent = source ? asRecord(source.subagent) : null
  const spawn = subagent ? asRecord(subagent.thread_spawn) : null
  return typeof spawn?.parent_thread_id === 'string'
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
