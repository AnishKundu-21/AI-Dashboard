import { afterEach, describe, expect, it } from 'vitest'
import {
  convertFromUsd,
  formatMoneyFromUsd,
  parseFxResponse,
  primeFxRates,
  resetFxForTests,
  supportedCurrencies
} from './fx'

afterEach(() => {
  resetFxForTests()
})

describe('parseFxResponse', () => {
  it('reads a Frankfurter payload', () => {
    const parsed = parseFxResponse({
      amount: 1,
      base: 'USD',
      date: '2026-09-04',
      rates: { INR: 88.12, EUR: 0.91 }
    })
    expect(parsed).toEqual({
      rates: { INR: 88.12, EUR: 0.91 },
      rates_date: '2026-09-04'
    })
  })

  it('rejects a payload based on another currency', () => {
    expect(parseFxResponse({ base: 'EUR', rates: { INR: 96 } })).toBeNull()
  })

  it('drops non-numeric and non-positive rates', () => {
    const parsed = parseFxResponse({
      base: 'USD',
      rates: { INR: 88.12, BAD: 'x', ZERO: 0 }
    })
    expect(parsed?.rates).toEqual({ INR: 88.12 })
  })

  it('returns null when nothing usable survives', () => {
    expect(parseFxResponse({ base: 'USD', rates: {} })).toBeNull()
    expect(parseFxResponse(null)).toBeNull()
  })
})

describe('convertFromUsd', () => {
  it('converts with a known rate', () => {
    primeFxRates({ INR: 88.12 }, '2026-09-04')
    const converted = convertFromUsd(10, 'INR')
    expect(converted.value).toBeCloseTo(881.2, 6)
    expect(converted.currency).toBe('INR')
    expect(converted.fell_back).toBe(false)
  })

  it('treats USD as the identity without needing a table', () => {
    expect(convertFromUsd(10, 'USD')).toEqual({
      value: 10,
      currency: 'USD',
      fell_back: false
    })
  })

  it('falls back to USD rather than mislabelling dollars', () => {
    // No rates loaded: the old hardcoded table would have quietly used 83.5.
    expect(convertFromUsd(10, 'INR')).toEqual({
      value: 10,
      currency: 'USD',
      fell_back: true
    })
  })

  it('formats the fallback in the currency it actually used', () => {
    expect(formatMoneyFromUsd(10, 'INR', 'en-IN')).toContain('$')
    primeFxRates({ INR: 88.12 })
    expect(formatMoneyFromUsd(10, 'INR', 'en-IN')).toContain('₹')
  })
})

describe('supportedCurrencies', () => {
  it('always offers USD, even with no rates loaded', () => {
    expect(supportedCurrencies()).toEqual(['USD'])
  })

  it('lists fetched currencies alphabetically after USD', () => {
    primeFxRates({ INR: 88.12, EUR: 0.91, AUD: 1.5 })
    expect(supportedCurrencies()).toEqual(['USD', 'AUD', 'EUR', 'INR'])
  })
})
