import { z } from 'zod'

/**
 * The canonical token model, shared by every provider.
 *
 * Providers report tokens in incompatible shapes: Claude splits cache reads
 * from cache writes and folds thinking into `output_tokens`, Codex reports a
 * cumulative `total_token_usage` whose `input_tokens` already contains the
 * cached half, and Grok reports its own arrangement again. Collectors
 * normalise into this shape so a token means the same thing everywhere and
 * the four classes can be priced at their own rates.
 */
export const TokenTotalsSchema = z.object({
  /** Input tokens billed at the full input rate. */
  uncached_input: z.number().nonnegative(),
  /** Cache *reads* — billed at roughly a tenth of the input rate. */
  cached_input: z.number().nonnegative(),
  /** Cache *writes* — billed above the input rate. */
  cache_creation: z.number().nonnegative(),
  output: z.number().nonnegative(),
  /**
   * Reasoning/thinking tokens. A **subset of `output`**, reported separately
   * for display only. Never add it into a total; that double counts.
   */
  reasoning: z.number().nonnegative()
})
export type TokenTotals = z.infer<typeof TokenTotalsSchema>

export const EMPTY_TOKEN_TOTALS: TokenTotals = Object.freeze({
  uncached_input: 0,
  cached_input: 0,
  cache_creation: 0,
  output: 0,
  reasoning: 0
})

export function addTotals(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    uncached_input: a.uncached_input + b.uncached_input,
    cached_input: a.cached_input + b.cached_input,
    cache_creation: a.cache_creation + b.cache_creation,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning
  }
}

/** Every token the provider processed. Excludes `reasoning` — see the field. */
export function totalTokens(totals: TokenTotals): number {
  return (
    totals.uncached_input +
    totals.cached_input +
    totals.cache_creation +
    totals.output
  )
}

/** All input-side tokens, cached and not. */
export function inputTokens(totals: TokenTotals): number {
  return totals.uncached_input + totals.cached_input + totals.cache_creation
}

export function isEmpty(totals: TokenTotals): boolean {
  return totalTokens(totals) === 0
}

/** Coerce an untrusted numeric field to a non-negative integer count. */
export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0
}

/**
 * Split a provider-reported input figure that already includes its cached
 * half, as Codex's `total_token_usage.input_tokens` does. Guards against a
 * cached figure larger than the total, which would otherwise yield a negative
 * uncached count.
 */
export function splitInput(
  totalInput: number,
  cachedRead: number,
  cacheWrite: number
): Pick<TokenTotals, 'uncached_input' | 'cached_input' | 'cache_creation'> {
  const cached = Math.min(cachedRead, totalInput)
  const created = Math.min(cacheWrite, Math.max(0, totalInput - cached))
  return {
    uncached_input: Math.max(0, totalInput - cached - created),
    cached_input: cached,
    cache_creation: created
  }
}
