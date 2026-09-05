/**
 * Folds usage events into the session rows the dashboard reads.
 *
 * Pricing happens here, per event, at the event's own model rate — a session
 * that switched from Opus to Sonnet is billed at both rates rather than
 * whichever model appeared more often.
 */
import {
  EMPTY_TOKEN_TOTALS,
  addTotals,
  totalTokens,
  type TokenTotals
} from '../../shared/tokens'
import type { SessionRow, SessionStatus, UsageEvent } from '../../shared/types'
import type { ProviderId } from '../../shared/providers'
import { priceUsage } from '../pricing/cost'
import { rateForModel } from '../pricing/store'
import { normalizeModelName } from './models'

/** Session-level metadata, which events do not carry. */
export interface SessionFacts {
  id: string
  provider: ProviderId
  project: string
  status: SessionStatus
  started_at: string | null
  ended_at: string | null
  duration_ms: number | null
  api_duration_ms?: number | null
  provider_cost_usd?: number | null
  model_calls?: number | null
  source: string
}

export interface DedupeResult {
  events: UsageEvent[]
  dropped: number
}

/**
 * What a collector produces: the events themselves, which are the durable
 * record, plus the session rows rolled up from them for the session list.
 */
export interface CollectedUsage {
  sessions: SessionRow[]
  events: UsageEvent[]
}

/**
 * Drops repeats by `dedupe_key`, keeping the first.
 *
 * This has to run across every file of a provider, not per file: Claude
 * replays earlier messages into a new transcript when a session is resumed or
 * branched, so the same `messageId:requestId` legitimately appears twice on
 * disk and must be counted once.
 */
export function dedupeEvents(events: Iterable<UsageEvent>): DedupeResult {
  const seen = new Set<string>()
  const out: UsageEvent[] = []
  let dropped = 0
  for (const event of events) {
    if (seen.has(event.dedupe_key)) {
      dropped++
      continue
    }
    seen.add(event.dedupe_key)
    out.push(event)
  }
  return { events: out, dropped }
}

interface Accumulator {
  tokens: TokenTotals
  cost_usd: number
  cache_savings_usd: number
  priced_events: number
  unpriced_events: number
  model_calls: number
  reported_cost_usd: number | null
  /** Tokens per model, to pick the one that actually dominated the session. */
  by_model: Map<string, number>
  first_ts: number
  last_ts: number
}

function emptyAccumulator(): Accumulator {
  return {
    tokens: { ...EMPTY_TOKEN_TOTALS },
    cost_usd: 0,
    cache_savings_usd: 0,
    priced_events: 0,
    unpriced_events: 0,
    model_calls: 0,
    reported_cost_usd: null,
    by_model: new Map(),
    first_ts: Number.POSITIVE_INFINITY,
    last_ts: 0
  }
}

/**
 * Prices `events` and merges them onto `facts`, one row per session.
 *
 * A session whose events are all unpriced reports `api_equiv_usd: null` and
 * `unpriced: true` — never a fabricated figure. A partially priced session
 * reports what it could price and still flags itself, so the UI can say the
 * total is a floor.
 */
export function eventsToSessionRows(
  events: readonly UsageEvent[],
  facts: readonly SessionFacts[]
): SessionRow[] {
  const accumulators = new Map<string, Accumulator>()

  for (const event of events) {
    const key = `${event.provider}:${event.session_id}`
    let accumulator = accumulators.get(key)
    if (!accumulator) {
      accumulator = emptyAccumulator()
      accumulators.set(key, accumulator)
    }

    accumulator.tokens = addTotals(accumulator.tokens, event.tokens)
    accumulator.model_calls++
    accumulator.first_ts = Math.min(accumulator.first_ts, event.ts_ms)
    accumulator.last_ts = Math.max(accumulator.last_ts, event.ts_ms)

    if (event.model) {
      accumulator.by_model.set(
        event.model,
        (accumulator.by_model.get(event.model) ?? 0) + totalTokens(event.tokens)
      )
    }

    if (event.reported_cost_usd != null) {
      accumulator.reported_cost_usd =
        (accumulator.reported_cost_usd ?? 0) + event.reported_cost_usd
    }

    const priced = priceUsage(event.tokens, rateForModel(event.model))
    if (priced.unpriced) {
      accumulator.unpriced_events++
    } else {
      accumulator.priced_events++
      accumulator.cost_usd += priced.cost_usd ?? 0
      accumulator.cache_savings_usd += priced.cache_savings_usd
    }
  }

  return facts.map((fact) => {
    const accumulator =
      accumulators.get(`${fact.provider}:${sessionIdOf(fact)}`) ?? emptyAccumulator()
    const tokens = accumulator.tokens
    const total = totalTokens(tokens)
    const hasUsage = total > 0
    const model = displayModel(fact.provider, accumulator.by_model)

    return {
      id: fact.id,
      provider: fact.provider,
      project: fact.project,
      model,
      // Flattened views of `tokens`, kept for existing consumers. Note
      // `tokens_total` now includes cached tokens for every provider; it
      // previously excluded them for Claude and included them for Codex,
      // which made the two impossible to compare.
      tokens_in: hasUsage ? tokens.uncached_input : null,
      tokens_out: hasUsage ? tokens.output : null,
      tokens_total: hasUsage ? total : null,
      tokens_cached: hasUsage ? tokens.cached_input + tokens.cache_creation : null,
      tokens_reasoning: hasUsage ? tokens.reasoning : null,
      model_calls: fact.model_calls ?? (hasUsage ? accumulator.model_calls : null),
      api_equiv_usd:
        accumulator.priced_events > 0 ? round(accumulator.cost_usd) : null,
      provider_cost_usd:
        fact.provider_cost_usd ??
        (accumulator.reported_cost_usd != null
          ? round(accumulator.reported_cost_usd)
          : null),
      api_duration_ms: fact.api_duration_ms ?? null,
      tokens: hasUsage ? tokens : undefined,
      cache_savings_usd:
        accumulator.priced_events > 0 ? round(accumulator.cache_savings_usd) : null,
      unpriced: accumulator.unpriced_events > 0,
      duration_ms: fact.duration_ms,
      status: fact.status,
      started_at:
        fact.started_at ??
        (accumulator.first_ts < Number.POSITIVE_INFINITY
          ? new Date(accumulator.first_ts).toISOString()
          : null),
      ended_at:
        fact.ended_at ??
        (accumulator.last_ts > 0 ? new Date(accumulator.last_ts).toISOString() : null),
      source: fact.source
    }
  })
}

/**
 * The collector pipeline: de-duplicate, attribute each event to its session's
 * project, then roll up into session rows.
 *
 * Events keep the project on them because they outlive the rollup — a query
 * that groups by project reads events directly.
 */
export function collectUsage(
  events: readonly UsageEvent[],
  facts: readonly SessionFacts[]
): CollectedUsage {
  const { events: unique } = dedupeEvents(events)
  const projectBySession = new Map(
    facts.map((fact) => [sessionIdOf(fact), fact.project] as const)
  )
  const attributed = unique.map((event) =>
    event.project === '' && projectBySession.has(event.session_id)
      ? { ...event, project: projectBySession.get(event.session_id)! }
      : event
  )
  return {
    events: attributed,
    sessions: eventsToSessionRows(attributed, facts).filter(
      (row) => row.tokens_total != null
    )
  }
}

/** Session facts carry the prefixed row id; events carry the bare session id. */
function sessionIdOf(fact: SessionFacts): string {
  const prefix = `${fact.provider}:`
  return fact.id.startsWith(prefix) ? fact.id.slice(prefix.length) : fact.id
}

/**
 * The model that produced the most tokens, not the one that appeared most
 * often — a single expensive Opus turn matters more than ten cheap Haiku ones.
 */
function displayModel(
  provider: ProviderId,
  byModel: ReadonlyMap<string, number>
): string {
  let best: string | null = null
  let bestTokens = -1
  for (const [model, tokens] of byModel) {
    if (tokens > bestTokens) {
      best = model
      bestTokens = tokens
    }
  }
  if (!best) return 'Unknown'
  return normalizeModelName(provider, best) ?? best
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}
