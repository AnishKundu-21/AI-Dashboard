import { describe, expect, it } from 'vitest'
import { mapCodexUsage } from './mapUsage'
import type { AppSettings } from '../../../shared/types'

const settings: AppSettings = {
  display_currency: 'USD',
  locale: 'en-US',
  timezone: 'system',
  notify_enabled: true,
  network_quota_refresh: true,
  retention_days: 90,
  plans: {
    grok: { mode: 'auto', source: 'unknown' },
    claude: { mode: 'auto', source: 'unknown' },
    codex: { mode: 'auto', source: 'unknown' }
  }
}

const fixture = {
  plan_type: 'plus',
  email: 'should-not-appear-in-snapshot@example.com',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 1,
      limit_window_seconds: 604800,
      reset_after_seconds: 573609,
      reset_at: 1785906620
    }
  },
  rate_limit_reset_credits: { available_count: 2 }
}

describe('mapCodexUsage', () => {
  it('maps plan_type and used percent', () => {
    const snap = mapCodexUsage(fixture, {
      settings,
      authConnected: true,
      resetCreditsAvailable: true
    })
    expect(snap.provider).toBe('codex')
    expect(snap.confidence).toBe('live')
    expect(snap.used_pct).toBe(1)
    expect(snap.remaining_pct).toBe(99)
    expect(snap.plan_label).toBe('plus')
    expect(snap.plan_source).toBe('api')
    expect(snap.window_label).toBe('Weekly')
    expect(snap.reset_at).toBe(new Date(1785906620 * 1000).toISOString())
    expect(snap.remaining_text).toContain('reset credits')
    // email must not leak into snapshot fields
    expect(JSON.stringify(snap)).not.toContain('should-not-appear')
  })

  it('detects pro plan for another user shape', () => {
    const snap = mapCodexUsage(
      { ...fixture, plan_type: 'pro', rate_limit: { ...fixture.rate_limit, primary_window: { ...fixture.rate_limit.primary_window, used_percent: 0 } } },
      { settings, authConnected: true }
    )
    expect(snap.plan_label).toBe('pro')
    expect(snap.remaining_pct).toBe(100)
  })
})
