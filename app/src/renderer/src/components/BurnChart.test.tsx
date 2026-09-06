import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { BurnSeries } from '@shared/types'
import { BurnChart } from './BurnChart'

vi.mock('../lib/hooks', () => ({
  useChartHover: () => ({
    probe: { index: null, x: 0 },
    onMove: () => undefined,
    onLeave: () => undefined
  }),
  useElementWidth: () => [{ current: null }, 900],
  usePrefersReducedMotion: () => true
}))

const series: BurnSeries[] = [
  {
    id: 'claude:seven_day',
    provider: 'claude',
    label: 'Claude · All models',
    window_kind: 'weekly',
    forecast_confidence: 'high',
    points: [
      { day: '2026-09-04', used_pct: 35, projected: false },
      { day: '2026-09-05', used_pct: 43, projected: false },
      { day: '2026-09-06', used_pct: 51, projected: true }
    ]
  },
  {
    id: 'claude:seven_day_opus',
    provider: 'claude',
    label: 'Claude · Opus',
    window_kind: 'weekly',
    forecast_confidence: 'medium',
    points: [
      { day: '2026-09-04', used_pct: 10, projected: false },
      { day: '2026-09-05', used_pct: 20, projected: false },
      { day: '2026-09-06', used_pct: 30, projected: true }
    ]
  }
]

describe('BurnChart', () => {
  it('draws all quota allowance streams in one chart', () => {
    const markup = renderToStaticMarkup(<BurnChart series={series} />)
    expect(markup).toContain('Claude · All models')
    expect(markup).toContain('Claude · Opus')
    expect(markup).toContain('Dashed = 3-day forecast')
    expect(markup).toContain('Quota allowance burn and projection by provider')
  })
})
