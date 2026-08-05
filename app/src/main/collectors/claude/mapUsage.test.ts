import { describe, expect, it } from 'vitest'
import { mapClaudeUsage } from './mapUsage'
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
  five_hour: {
    utilization: 8.0,
    resets_at: '2026-08-04T21:50:00.291106+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null
  },
  seven_day: {
    utilization: 1.0,
    resets_at: '2026-08-09T14:00:00.291133+00:00',
    limit_dollars: null,
    used_dollars: null,
    remaining_dollars: null
  },
  seven_day_oauth_apps: null,
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null },
  limits: [
    { kind: 'session', group: 'session', percent: 8, severity: 'normal', is_active: true },
    { kind: 'weekly_all', group: 'weekly', percent: 1, severity: 'normal', is_active: false }
  ]
}

describe('mapClaudeUsage', () => {
  it('maps live session + weekly windows', () => {
    const snap = mapClaudeUsage(fixture, {
      settings,
      authConnected: true,
      subscriptionType: 'pro',
      capturedAt: '2026-08-04T17:20:00.000Z'
    })
    expect(snap.provider).toBe('claude')
    expect(snap.confidence).toBe('live')
    expect(snap.used_pct).toBe(8)
    expect(snap.remaining_pct).toBe(92)
    expect(snap.window_label).toBe('Session (5h)')
    expect(snap.reset_at).toBe('2026-08-04T21:50:00.291106+00:00')
    expect(snap.plan_label).toBe('pro')
    expect(snap.plan_source).toBe('auth')
    expect(snap.windows).toEqual([
      {
        label: 'Session (5h)',
        used_pct: 8,
        remaining_pct: 92,
        reset_at: '2026-08-04T21:50:00.291106+00:00'
      },
      {
        label: 'Weekly (all models)',
        used_pct: 1,
        remaining_pct: 99,
        reset_at: '2026-08-09T14:00:00.291133+00:00'
      }
    ])
  })

  it('falls back to estimate when windows are missing', () => {
    const snap = mapClaudeUsage(
      {},
      { settings, authConnected: true, subscriptionType: null }
    )
    expect(snap.confidence).toBe('estimate')
    expect(snap.used_pct).toBeNull()
    expect(snap.windows).toBeUndefined()
  })

  it('respects manual plan override', () => {
    const withPlan: AppSettings = {
      ...settings,
      plans: { ...settings.plans, claude: { mode: 'manual', value: 'Max', source: 'user' } }
    }
    const snap = mapClaudeUsage(fixture, {
      settings: withPlan,
      authConnected: true,
      subscriptionType: 'pro'
    })
    expect(snap.plan_label).toBe('Max')
    expect(snap.plan_source).toBe('user')
  })
})
