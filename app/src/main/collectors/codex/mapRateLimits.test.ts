import { describe, expect, it } from 'vitest'
import { codexResetCredits, codexWindows, mapCodexRateLimits } from './mapRateLimits'
import { AppSettingsSchema } from '../../../shared/types'

const settings = AppSettingsSchema.parse({})

/** Shape captured from a real `account/rateLimits/read` on a plus account. */
const LIVE_RESPONSE = {
  rateLimits: {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: 1788621323 },
    secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: 1789141829 },
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: false,
    planType: 'plus',
    rateLimitReachedType: null
  },
  rateLimitResetCredits: {
    availableCount: 1,
    credits: [
      {
        id: 'RateLimitResetCredit_b40f',
        resetType: 'codexRateLimits',
        status: 'available',
        grantedAt: 1788564921,
        expiresAt: 1791156921,
        title: 'Full reset (Weekly + 5 hr)',
        description: 'Thanks for using Codex!'
      }
    ]
  },
  accountId: '8ed1cce4-cfaf-4ec2-b34a-4e331a7f3388',
  rateLimitUpsell: null
}

describe('codexWindows', () => {
  it('maps both positions with their reported durations', () => {
    expect(codexWindows(LIVE_RESPONSE.rateLimits)).toEqual([
      {
        id: 'primary',
        kind: 'session',
        label: 'Session',
        used_pct: 1,
        resets_at: new Date(1788621323 * 1000).toISOString(),
        window_duration_mins: 300
      },
      {
        id: 'secondary',
        kind: 'weekly',
        label: 'Weekly',
        used_pct: 0,
        resets_at: new Date(1789141829 * 1000).toISOString(),
        window_duration_mins: 10080
      }
    ])
  })

  it('treats a missing duration on a paid plan as the 5-hour window', () => {
    const windows = codexWindows({
      planType: 'pro',
      primary: { usedPercent: 40 }
    })
    expect(windows[0].kind).toBe('session')
    expect(windows[0].window_duration_mins).toBe(300)
  })

  it('treats a missing duration on Free or Go as monthly', () => {
    // Free and Go expose one monthly allowance rather than the 5h/weekly pair.
    for (const planType of ['free', 'go']) {
      const windows = codexWindows({ planType, primary: { usedPercent: 40 } })
      expect(windows[0].kind, planType).toBe('monthly')
    }
  })

  it('clamps an out-of-range percentage', () => {
    expect(codexWindows({ primary: { usedPercent: 140 } })[0].used_pct).toBe(100)
    expect(codexWindows({ primary: { usedPercent: -5 } })[0].used_pct).toBe(0)
  })

  it('skips a window with no usable percentage', () => {
    expect(codexWindows({ primary: null, secondary: { usedPercent: 10 } })).toHaveLength(
      1
    )
  })
})

describe('codexResetCredits', () => {
  it('summarises available credits with their soonest expiry', () => {
    expect(codexResetCredits(LIVE_RESPONSE.rateLimitResetCredits)).toEqual({
      available_count: 1,
      next_expires_at: new Date(1791156921 * 1000).toISOString(),
      title: 'Full reset (Weekly + 5 hr)'
    })
  })

  it('ignores credits that are not available', () => {
    expect(
      codexResetCredits({
        availableCount: 0,
        credits: [{ status: 'redeemed', expiresAt: 1791156921 }]
      })
    ).toEqual({ available_count: 0, next_expires_at: null, title: null })
  })

  it('returns nothing when the field is absent', () => {
    expect(codexResetCredits(null)).toBeUndefined()
  })
})

describe('mapCodexRateLimits', () => {
  it('drives the headline from the session window', () => {
    const snapshot = mapCodexRateLimits(LIVE_RESPONSE, { settings })
    expect(snapshot.confidence).toBe('live')
    expect(snapshot.transport).toBe('app-server')
    expect(snapshot.used_pct).toBe(1)
    expect(snapshot.remaining_pct).toBe(99)
    expect(snapshot.window_label).toBe('Session')
    expect(snapshot.plan_label).toBe('plus')
    expect(snapshot.plan_source).toBe('api')
    expect(snapshot.unavailable).toBeUndefined()
  })

  it('keeps every window available alongside the headline', () => {
    const snapshot = mapCodexRateLimits(LIVE_RESPONSE, { settings })
    expect(snapshot.quota_windows).toHaveLength(2)
    expect(snapshot.windows?.map((w) => w.label)).toEqual(['Session', 'Weekly'])
  })

  it('reports an account with no windows as unsupported, not failed', () => {
    // An API-key account cannot have subscription windows. Retrying that as if
    // it were a transient failure would poll forever and mislabel the card.
    const snapshot = mapCodexRateLimits(
      { rateLimits: { planType: null } },
      { settings }
    )
    expect(snapshot.unavailable?.reason).toBe('unsupported')
    expect(snapshot.auth_connected).toBe(true)
    expect(snapshot.confidence).toBe('unknown')
    expect(snapshot.used_pct).toBeNull()
  })

  it('survives an empty or malformed body', () => {
    expect(mapCodexRateLimits(null, { settings }).unavailable?.reason).toBe(
      'unsupported'
    )
  })
})
