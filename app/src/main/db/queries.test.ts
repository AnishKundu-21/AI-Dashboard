import { describe, expect, it } from 'vitest'
import { applyClaudeBurnWindow } from './queries'
import type { QuotaSnapshot } from '../../shared/types'

const claudeLive: QuotaSnapshot = {
  provider: 'claude',
  captured_at: new Date().toISOString(),
  used_pct: 8,
  remaining_pct: 92,
  reset_at: '2026-08-04T21:50:00.000Z',
  window_label: 'Session (5h)',
  plan_label: 'pro',
  plan_source: 'auth',
  confidence: 'live',
  source: 'test',
  auth_connected: true,
  windows: [
    { label: 'Session (5h)', used_pct: 8, remaining_pct: 92, reset_at: '2026-08-04T21:50:00.000Z' },
    { label: 'Weekly (all models)', used_pct: 41, remaining_pct: 59, reset_at: '2026-08-09T14:00:00.000Z' }
  ]
}

describe('applyClaudeBurnWindow', () => {
  it('swaps Claude used_pct/reset/window_label to the weekly window', () => {
    const remapped = applyClaudeBurnWindow(claudeLive)
    expect(remapped.used_pct).toBe(41)
    expect(remapped.remaining_pct).toBe(59)
    expect(remapped.window_label).toBe('Weekly (all models)')
    expect(remapped.reset_at).toBe('2026-08-09T14:00:00.000Z')
  })

  it('leaves other fields (auth, confidence, plan) untouched', () => {
    const remapped = applyClaudeBurnWindow(claudeLive)
    expect(remapped.auth_connected).toBe(true)
    expect(remapped.confidence).toBe('live')
    expect(remapped.plan_label).toBe('pro')
  })

  it('is a no-op when the weekly window is absent (estimate fallback)', () => {
    const noWindows: QuotaSnapshot = { ...claudeLive, windows: undefined }
    expect(applyClaudeBurnWindow(noWindows)).toEqual(noWindows)
  })

  it('is a no-op for non-Claude providers', () => {
    const grok: QuotaSnapshot = { ...claudeLive, provider: 'grok' }
    expect(applyClaudeBurnWindow(grok)).toEqual(grok)
  })
})
