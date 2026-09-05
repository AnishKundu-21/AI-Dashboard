import { describe, expect, it } from 'vitest'
import {
  createOverrideRateTable,
  lookupRate,
  parseRateTable,
  EMPTY_RATE_TABLE
} from './rateTable'

const LITELLM_SAMPLE = {
  sample_spec: { input_cost_per_token: 1, output_cost_per_token: 1 },
  'claude-sonnet-4-5-20250929': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 3.75e-6
  },
  'anthropic/claude-opus-4-1': {
    input_cost_per_token: 1.5e-5,
    output_cost_per_token: 7.5e-5,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 1.875e-5
  },
  'gpt-5-codex': {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5
  },
  'broken-half-priced': { input_cost_per_token: 1e-6 }
}

describe('parseRateTable', () => {
  it('keeps entries with both an input and an output rate', () => {
    const table = parseRateTable(LITELLM_SAMPLE)
    expect(table.get('claude-sonnet-4-5-20250929')).toEqual({
      input_cost_per_token: 3e-6,
      output_cost_per_token: 1.5e-5,
      cache_read_cost_per_token: 3e-7,
      cache_creation_cost_per_token: 3.75e-6
    })
  })

  it('drops half-priced entries rather than under-reporting them', () => {
    expect(parseRateTable(LITELLM_SAMPLE).has('broken-half-priced')).toBe(false)
  })

  it('skips the sample_spec placeholder', () => {
    expect(parseRateTable(LITELLM_SAMPLE).has('sample_spec')).toBe(false)
  })

  it('falls back to the input rate for missing cache rates', () => {
    const rate = parseRateTable(LITELLM_SAMPLE).get('gpt-5-codex')
    expect(rate?.cache_read_cost_per_token).toBe(1.25e-6)
    expect(rate?.cache_creation_cost_per_token).toBe(1.25e-6)
  })

  it('aliases an unambiguous qualified name to its bare form', () => {
    const table = parseRateTable(LITELLM_SAMPLE)
    expect(table.get('claude-opus-4-1')?.input_cost_per_token).toBe(1.5e-5)
  })

  it('refuses to alias a bare name two prefixes price differently', () => {
    const table = parseRateTable({
      'a/shared-name': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 },
      'b/shared-name': { input_cost_per_token: 9e-6, output_cost_per_token: 2e-6 }
    })
    expect(table.has('shared-name')).toBe(false)
  })

  it('survives a document that is not an object', () => {
    expect(parseRateTable(null).size).toBe(0)
    expect(parseRateTable('nope').size).toBe(0)
  })
})

describe('lookupRate', () => {
  const table = parseRateTable(LITELLM_SAMPLE)

  it('matches case-insensitively', () => {
    expect(lookupRate('Claude-Sonnet-4-5-20250929', table)).not.toBeNull()
  })

  it('falls back to the bare name for a qualified model id', () => {
    expect(lookupRate('bedrock/claude-opus-4-1', table)?.input_cost_per_token).toBe(
      1.5e-5
    )
  })

  it('returns null for an unknown model instead of guessing', () => {
    expect(lookupRate('some-model-shipped-yesterday', table)).toBeNull()
    expect(lookupRate(null, table)).toBeNull()
  })

  it('lets a user override beat the fetched table', () => {
    const overrides = createOverrideRateTable({
      'claude-sonnet-4-5-20250929': { input_per_million: 1, output_per_million: 2 }
    })
    expect(lookupRate('claude-sonnet-4-5-20250929', table, overrides)).toEqual({
      input_cost_per_token: 1e-6,
      output_cost_per_token: 2e-6,
      cache_read_cost_per_token: 1e-6,
      cache_creation_cost_per_token: 1e-6
    })
  })

  it('honours an explicit zero cache rate in an override', () => {
    const overrides = createOverrideRateTable({
      'free-cache': {
        input_per_million: 3,
        output_per_million: 15,
        cache_read_per_million: 0
      }
    })
    expect(
      lookupRate('free-cache', EMPTY_RATE_TABLE, overrides)?.cache_read_cost_per_token
    ).toBe(0)
  })
})
