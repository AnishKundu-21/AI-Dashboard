import { describe, expect, it } from 'vitest'
import { priceUsage } from './cost'
import type { ModelRate } from './rateTable'
import { EMPTY_TOKEN_TOTALS, totalTokens } from '../../shared/tokens'

const SONNET: ModelRate = {
  input_cost_per_token: 3e-6,
  output_cost_per_token: 1.5e-5,
  cache_read_cost_per_token: 3e-7,
  cache_creation_cost_per_token: 3.75e-6
}

describe('priceUsage', () => {
  it('prices each token class at its own rate', () => {
    const priced = priceUsage(
      {
        uncached_input: 1_000,
        cached_input: 100_000,
        cache_creation: 10_000,
        output: 5_000,
        reasoning: 2_000
      },
      SONNET
    )
    // 0.003 + 0.03 + 0.0375 + 0.075
    expect(priced.cost_usd).toBeCloseTo(0.1455, 6)
  })

  it('does not bill reasoning tokens twice', () => {
    const withReasoning = priceUsage(
      { ...EMPTY_TOKEN_TOTALS, output: 5_000, reasoning: 4_999 },
      SONNET
    )
    const without = priceUsage({ ...EMPTY_TOKEN_TOTALS, output: 5_000 }, SONNET)
    expect(withReasoning.cost_usd).toBe(without.cost_usd)
  })

  it('is dominated by cache reads for a typical coding session', () => {
    // The old blended rate card priced only uncached input plus output, which
    // is the under-reporting this module exists to fix.
    const priced = priceUsage(
      {
        uncached_input: 2_000,
        cached_input: 900_000,
        cache_creation: 40_000,
        output: 20_000,
        reasoning: 0
      },
      SONNET
    )
    const blendedOnInputOutput = ((2_000 + 20_000) / 1_000_000) * 3
    expect(priced.cost_usd).toBeGreaterThan(blendedOnInputOutput * 5)
  })

  it('reports unpriced rather than inventing a rate', () => {
    const priced = priceUsage({ ...EMPTY_TOKEN_TOTALS, output: 100 }, null)
    expect(priced.unpriced).toBe(true)
    expect(priced.cost_usd).toBeNull()
  })

  it('measures cache savings against the full input rate', () => {
    const priced = priceUsage(
      { ...EMPTY_TOKEN_TOTALS, cached_input: 1_000_000 },
      SONNET
    )
    expect(priced.cache_savings_usd).toBeCloseTo(2.7, 6)
  })
})

describe('totalTokens', () => {
  it('counts all four billable classes and excludes reasoning', () => {
    expect(
      totalTokens({
        uncached_input: 1,
        cached_input: 2,
        cache_creation: 4,
        output: 8,
        reasoning: 8
      })
    ).toBe(15)
  })
})

describe('rounding', () => {
  it('does not round a sub-cent turn away before it can be summed', () => {
    const tiny: ModelRate = {
      input_cost_per_token: 1e-9,
      output_cost_per_token: 1e-9,
      cache_read_cost_per_token: 1e-9,
      cache_creation_cost_per_token: 1e-9
    }
    const one = priceUsage({ ...EMPTY_TOKEN_TOTALS, output: 100 }, tiny)
    expect(one.cost_usd).toBeGreaterThan(0)

    // Ten thousand such turns are worth a tenth of a cent, not nothing.
    const summed = Array.from({ length: 10_000 }).reduce<number>(
      (total) => total + (one.cost_usd ?? 0),
      0
    )
    expect(summed).toBeCloseTo(0.001, 9)
  })
})
