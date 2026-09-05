/**
 * Model rate lookup.
 *
 * Rates come from LiteLLM's `model_prices_and_context_window.json` — the same
 * table `ccusage` prices against — so a model that ships today is priced today
 * without a release here. Everything in this module is pure; fetching and
 * caching the document lives in `pricing/store.ts`.
 */

/** All values are USD per single token, matching LiteLLM's own units. */
export interface ModelRate {
  input_cost_per_token: number
  output_cost_per_token: number
  cache_read_cost_per_token: number
  cache_creation_cost_per_token: number
}

export type RateTable = ReadonlyMap<string, ModelRate>

export const EMPTY_RATE_TABLE: RateTable = new Map()

/** User-supplied prices, entered per million tokens because that is how vendors quote them. */
export interface ModelPriceOverride {
  input_per_million: number
  output_per_million: number
  cache_read_per_million?: number
  cache_write_per_million?: number
}

export function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase()
}

/** The part after the last `/`, for `anthropic/claude-…` style qualified ids. */
function unqualified(key: string): string | null {
  const index = key.lastIndexOf('/')
  if (index < 0 || index === key.length - 1) return null
  return key.slice(index + 1)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

/**
 * Projects the LiteLLM document into a rate table.
 *
 * An entry missing either an input or an output rate is dropped rather than
 * half-priced: reporting a model as unpriced is honest, silently charging half
 * of it is not.
 *
 * Cache rates fall back to the input rate when absent, which is what a model
 * without prompt caching effectively bills.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>()
  if (typeof document !== 'object' || document === null) return table

  // Bare aliases are only safe when every qualified spelling agrees on price.
  const aliasCandidates = new Map<string, ModelRate | null>()

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (name === 'sample_spec') continue
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>

    const input = finiteNumber(entry.input_cost_per_token)
    const output = finiteNumber(entry.output_cost_per_token)
    if (input === null || output === null) continue

    const rate: ModelRate = {
      input_cost_per_token: input,
      output_cost_per_token: output,
      cache_read_cost_per_token:
        finiteNumber(entry.cache_read_input_token_cost) ?? input,
      cache_creation_cost_per_token:
        finiteNumber(entry.cache_creation_input_token_cost) ?? input
    }

    const key = normalizeModelKey(name)
    table.set(key, rate)

    const bare = unqualified(key)
    if (!bare) continue
    if (!aliasCandidates.has(bare)) {
      aliasCandidates.set(bare, rate)
    } else {
      const existing = aliasCandidates.get(bare)
      // Disagreeing prefixes make the bare name ambiguous; refuse to guess.
      if (existing && !rateEquals(existing, rate)) aliasCandidates.set(bare, null)
    }
  }

  for (const [bare, rate] of aliasCandidates) {
    if (rate && !table.has(bare)) table.set(bare, rate)
  }

  return table
}

function rateEquals(a: ModelRate, b: ModelRate): boolean {
  return (
    a.input_cost_per_token === b.input_cost_per_token &&
    a.output_cost_per_token === b.output_cost_per_token &&
    a.cache_read_cost_per_token === b.cache_read_cost_per_token &&
    a.cache_creation_cost_per_token === b.cache_creation_cost_per_token
  )
}

/** Turns the user's per-million overrides into a table shaped like the parsed one. */
export function createOverrideRateTable(
  overrides: Record<string, ModelPriceOverride>
): RateTable {
  const table = new Map<string, ModelRate>()
  for (const [model, prices] of Object.entries(overrides)) {
    const key = normalizeModelKey(model)
    if (!key) continue
    const input = prices.input_per_million / 1_000_000
    table.set(key, {
      input_cost_per_token: input,
      output_cost_per_token: prices.output_per_million / 1_000_000,
      // An omitted cache rate bills at input; an explicit 0 stays free.
      cache_read_cost_per_token:
        prices.cache_read_per_million != null
          ? prices.cache_read_per_million / 1_000_000
          : input,
      cache_creation_cost_per_token:
        prices.cache_write_per_million != null
          ? prices.cache_write_per_million / 1_000_000
          : input
    })
  }
  return table
}

/**
 * Resolves a model id to a rate. A user override always wins, so a private or
 * unreleased model can be priced by hand. Returns `null` when nothing matches;
 * callers must report that as unpriced rather than substituting a guess.
 */
export function lookupRate(
  model: string | null | undefined,
  table: RateTable,
  overrides: RateTable = EMPTY_RATE_TABLE
): ModelRate | null {
  if (!model) return null
  const key = normalizeModelKey(model)
  if (!key) return null

  const bare = unqualified(key)
  for (const candidate of bare ? [key, bare] : [key]) {
    const override = overrides.get(candidate)
    if (override) return override
  }
  for (const candidate of bare ? [key, bare] : [key]) {
    const rate = table.get(candidate)
    if (rate) return rate
  }
  return null
}
