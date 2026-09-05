/**
 * Cost arithmetic over the canonical token model.
 *
 * The four token classes carry genuinely different prices — a cache read is
 * roughly a tenth of an input token, a cache write roughly a quarter above it
 * — so a single blended rate cannot approximate a coding agent's traffic,
 * which is dominated by cache reads.
 */
import type { TokenTotals } from '../../shared/tokens'
import type { ModelRate } from './rateTable'

export interface PricedUsage {
  /** `null` when the model has no rate; never a fabricated fallback. */
  cost_usd: number | null
  /** What the cached input would have cost at the full input rate, minus what it did. */
  cache_savings_usd: number
  unpriced: boolean
}

export const UNPRICED: PricedUsage = Object.freeze({
  cost_usd: null,
  cache_savings_usd: 0,
  unpriced: true
})

export function priceUsage(
  totals: TokenTotals,
  rate: ModelRate | null
): PricedUsage {
  if (!rate) return UNPRICED
  // `reasoning` is a subset of `output` and is deliberately not a term here.
  const cost =
    totals.uncached_input * rate.input_cost_per_token +
    totals.cached_input * rate.cache_read_cost_per_token +
    totals.cache_creation * rate.cache_creation_cost_per_token +
    totals.output * rate.output_cost_per_token

  // Deliberately unrounded. A single turn can cost a fraction of a cent, and
  // rounding here — before thousands of them are summed — both loses the small
  // ones entirely and lets the rounding error accumulate in one direction.
  // Callers round once, at the row or total they display.
  return {
    cost_usd: Number.isFinite(cost) ? cost : 0,
    cache_savings_usd:
      totals.cached_input *
      Math.max(0, rate.input_cost_per_token - rate.cache_read_cost_per_token),
    unpriced: false
  }
}
