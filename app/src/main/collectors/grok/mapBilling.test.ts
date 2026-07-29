import { describe, expect, it } from 'vitest'
import { mapGrokBilling } from './mapBilling'
import type { AppSettings } from '../../../shared/types'

const settings: AppSettings = {
  display_currency: 'USD',
  locale: 'en-US',
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
  config: {
    currentPeriod: {
      type: 'USAGE_PERIOD_TYPE_WEEKLY',
      start: '2026-07-28T16:19:41.409613+00:00',
      end: '2026-08-04T16:19:41.409613+00:00'
    },
    creditUsagePercent: 33.0,
    productUsage: [
      { product: 'GrokBuild', usagePercent: 18.0 },
      { product: 'GrokChat', usagePercent: 15.0 }
    ],
    onDemandUsed: { val: 0 },
    prepaidBalance: { val: 0 }
  }
}

describe('mapGrokBilling', () => {
  it('maps live weekly credits', () => {
    const snap = mapGrokBilling(fixture, {
      settings,
      authConnected: true,
      capturedAt: '2026-07-29T12:00:00.000Z'
    })
    expect(snap.provider).toBe('grok')
    expect(snap.confidence).toBe('live')
    expect(snap.used_pct).toBe(33)
    expect(snap.remaining_pct).toBe(67)
    expect(snap.window_label).toBe('Weekly')
    expect(snap.reset_at).toBe('2026-08-04T16:19:41.409613+00:00')
    expect(snap.products).toEqual({ GrokBuild: 18, GrokChat: 15 })
    expect(snap.plan_source).toBe('unknown')
    expect(snap.auth_connected).toBe(true)
  })

  it('respects manual plan override', () => {
    const withPlan: AppSettings = {
      ...settings,
      plans: {
        ...settings.plans,
        grok: { mode: 'manual', value: 'SuperGrok', source: 'user' }
      }
    }
    const snap = mapGrokBilling(fixture, {
      settings: withPlan,
      authConnected: true
    })
    expect(snap.plan_label).toBe('SuperGrok')
    expect(snap.plan_source).toBe('user')
  })
})
