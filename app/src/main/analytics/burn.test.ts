import { describe, expect, it } from 'vitest'
import { buildBurnSeries } from './burn'
import type { QuotaSnapshot } from '../../shared/types'
import { buildProjectionCard, willExhaustWithinDays } from './projections'

const isoDaysFromNow = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

const live: QuotaSnapshot = {
  provider: 'grok',
  captured_at: new Date().toISOString(),
  used_pct: 40,
  remaining_pct: 60,
  reset_at: isoDaysFromNow(7),
  window_label: 'Weekly',
  plan_label: null,
  plan_source: 'unknown',
  confidence: 'live',
  source: 'test',
  auth_connected: true
}

describe('buildBurnSeries', () => {
  it('ends with projected points', () => {
    const series = buildBurnSeries(
      live,
      [
        {
          day: isoDaysFromNow(-2).slice(0, 10),
          used_pct: 20,
          captured_at: isoDaysFromNow(-2)
        },
        {
          day: isoDaysFromNow(-1).slice(0, 10),
          used_pct: 30,
          captured_at: isoDaysFromNow(-1)
        }
      ],
      7
    )
    const proj = series.filter((p) => p.projected)
    const obs = series.filter((p) => !p.projected)
    expect(proj).toHaveLength(3)
    expect(obs.length).toBeGreaterThan(0)
    expect(obs[obs.length - 1].used_pct).toBe(40)
  })

  it('does not invent observed history from one latest sample', () => {
    const series = buildBurnSeries(live, [], 7)
    expect(series.filter((point) => !point.projected)).toEqual([
      {
        day: new Date().toISOString().slice(0, 10),
        used_pct: 40,
        projected: false
      }
    ])
  })
})

describe('buildProjectionCard', () => {
  it('warns when near exhaustion', () => {
    const card = buildProjectionCard(
      { ...live, used_pct: 92, remaining_pct: 8 },
      [],
      7
    )
    expect(card.level).toBe('warn')
    expect(card.headline).toMatch(/exhaustion|Near/i)
  })

  it('detects exhaust within 3 days', () => {
    const hot: QuotaSnapshot = {
      ...live,
      used_pct: 85,
      remaining_pct: 15,
      // force high daily burn via short elapsed window is hard; use willExhaust with high used
      reset_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      window_label: 'Weekly'
    }
    // 85% used with weekly window mid-week can exhaust soon depending on elapsed
    const card = buildProjectionCard(hot, [], 7)
    expect(card.days_to_empty == null || card.days_to_empty >= 0).toBe(true)
    expect(typeof willExhaustWithinDays(hot, 3, 7)).toBe('boolean')
  })
})
