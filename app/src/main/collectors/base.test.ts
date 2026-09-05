import { describe, expect, it } from 'vitest'
import { disconnectedSnapshot, estimateSnapshot } from './base'

describe('collector snapshot diagnostics', () => {
  it('keeps transport and unavailable details on estimate snapshots', () => {
    const snapshot = estimateSnapshot('grok', 'billing fallback', {
      transport: 'http',
      unavailable: {
        reason: 'probe_failed',
        message: 'The billing endpoint did not return a live usage figure.'
      }
    })

    expect(snapshot.transport).toBe('http')
    expect(snapshot.unavailable?.reason).toBe('probe_failed')
    expect(snapshot.unavailable?.message).toContain('live usage figure')
  })

  it('marks disconnected snapshots as having no transport', () => {
    expect(disconnectedSnapshot('claude', 'no credentials').transport).toBe('none')
  })
})
