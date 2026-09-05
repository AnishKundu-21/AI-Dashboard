import { describe, expect, it } from 'vitest'
import { formatResetAt } from './format'

describe('formatResetAt', () => {
  it('shows both a countdown and the exact configured-zone time', () => {
    expect(
      formatResetAt(
        '2026-09-05T15:15:00.000Z',
        'en-US',
        'UTC',
        Date.parse('2026-09-05T12:00:00.000Z')
      )
    ).toBe('in 3h 15m · Sep 5, 3:15 PM')
  })

  it('does not present an invalid timestamp as a date', () => {
    expect(formatResetAt('not-a-date')).toBe('—')
  })
})
