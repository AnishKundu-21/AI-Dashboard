import { describe, expect, it } from 'vitest'
import { DashboardFilterSchema } from './types'

describe('dashboard date ranges', () => {
  it.each([0, 1, 3, 5, 7, 30, 180, 365])(
    'accepts range value %s',
    (rangeDays) => {
      expect(
        DashboardFilterSchema.parse({ range_days: rangeDays }).range_days
      ).toBe(rangeDays)
    }
  )

  it('rejects unsupported range values', () => {
    expect(() => DashboardFilterSchema.parse({ range_days: 2 })).toThrow()
  })
})
