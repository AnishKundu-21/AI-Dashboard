import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QuotaSnapshot } from '@shared/types'
import { QuotaCard } from './QuotaCard'

const quota: QuotaSnapshot = {
  provider: 'claude',
  captured_at: '2026-09-05T12:00:00.000Z',
  used_pct: 11,
  remaining_pct: 89,
  reset_at: '2026-09-05T15:15:00.000Z',
  window_label: 'Session (5h)',
  plan_label: 'pro',
  plan_source: 'auth',
  confidence: 'live',
  source: 'fixture',
  auth_connected: true,
  quota_windows: [
    {
      id: 'five_hour',
      kind: 'session',
      label: 'Session (5h)',
      used_pct: 11,
      resets_at: '2026-09-05T15:15:00.000Z',
      window_duration_mins: 300
    },
    {
      id: 'seven_day',
      kind: 'weekly',
      label: 'Weekly',
      used_pct: 43,
      resets_at: '2026-09-11T15:50:00.000Z',
      window_duration_mins: 10080
    }
  ]
}

describe('QuotaCard', () => {
  it('labels auth-derived plans as detected and renders each reset window', () => {
    const markup = renderToStaticMarkup(
      <QuotaCard quota={quota} locale="en-US" timezone="UTC" />
    )
    expect(markup).toContain('pro · detected')
    expect(markup).toContain('Session (5h)')
    expect(markup).toContain('Weekly')
    expect(markup).toContain('Sep 5, 3:15 PM')
    expect(markup).toContain('Sep 11, 3:50 PM')
  })
})
