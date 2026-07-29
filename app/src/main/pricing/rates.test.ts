import { describe, expect, it } from 'vitest'
import {
  apiEquivUsd,
  convertFromUsd,
  formatMoneyFromUsd,
  rateForModel
} from './rates'

describe('rateForModel', () => {
  it('matches specific models before generic', () => {
    expect(rateForModel('gpt-5.6-sol')).toBe(5.0)
    expect(rateForModel('Claude Opus')).toBe(15.0)
    expect(rateForModel('codex mini')).toBe(0.8)
    expect(rateForModel('Grok 4')).toBe(3.0)
  })
})

describe('apiEquivUsd', () => {
  it('computes cost for 1M tokens', () => {
    expect(apiEquivUsd('Opus', 1_000_000)).toBe(15)
  })

  it('returns null for empty tokens', () => {
    expect(apiEquivUsd('Opus', 0)).toBeNull()
    expect(apiEquivUsd('Opus', null)).toBeNull()
  })
})

describe('FX', () => {
  it('converts USD to INR approximately', () => {
    expect(convertFromUsd(1, 'INR')).toBeCloseTo(83.5)
  })

  it('formats with locale currency', () => {
    const s = formatMoneyFromUsd(10, 'INR', 'en-IN')
    expect(s).toMatch(/₹|INR|Rs/i)
  })
})
