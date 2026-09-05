import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CollectorHealth, QuotaSnapshot } from '@shared/types'
import { HealthCard } from './HealthCard'

const health: CollectorHealth = {
  provider: 'claude',
  source_label: '~/.claude',
  watcher_status: 'watching',
  last_scan_at: '2026-09-05T12:00:00.000Z',
  last_success_at: '2026-09-05T12:00:00.000Z',
  last_error: null,
  sessions_seen: 12,
  last_duration_ms: 84
}

const quota: QuotaSnapshot = {
  provider: 'claude',
  captured_at: '2026-09-05T12:00:00.000Z',
  used_pct: 42,
  remaining_pct: 58,
  reset_at: null,
  window_label: 'Session (5h)',
  plan_label: 'pro',
  plan_source: 'auth',
  confidence: 'estimate',
  source: 'oauth/usage HTTP 429 — estimate fallback',
  auth_connected: true,
  unavailable: {
    reason: 'probe_failed',
    message: 'The provider did not return a live usage figure.'
  },
  transport: 'http',
  reset_credits: {
    available_count: 1,
    next_expires_at: null,
    title: 'Full reset'
  }
}

describe('HealthCard', () => {
  it('shows local collector and quota transport diagnostics together', () => {
    const markup = renderToStaticMarkup(
      <HealthCard health={health} quota={quota} busy={false} onRescan={() => undefined} />
    )

    expect(markup).toContain('Local collector')
    expect(markup).toContain('Quota connection')
    expect(markup).toContain('Credentials available')
    expect(markup).toContain('Provider HTTP API')
    expect(markup).toContain('oauth/usage HTTP 429')
    expect(markup).toContain('pro · detected')
    expect(markup).toContain('1 available')
    expect(markup).toContain('Probe failed')
    expect(markup).toContain('The provider did not return a live usage figure.')
  })

  it('falls back to legacy windows when normalized windows are empty', () => {
    const markup = renderToStaticMarkup(
      <HealthCard
        health={health}
        quota={{
          ...quota,
          quota_windows: [],
          windows: [{ label: 'Weekly', used_pct: 20, remaining_pct: 80, reset_at: null }]
        }}
        busy={false}
        onRescan={() => undefined}
      />
    )

    expect(markup).toContain('<span>Windows reported</span><b>1</b>')
  })
})
