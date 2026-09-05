import { describe, expect, it } from 'vitest'
import { AppSettingsSchema, DashboardFilterSchema } from './types'
import { GetBurnSeriesInput } from './ipc'

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

describe('provider settings', () => {
  it('defaults every unlisted provider to enabled through sparse settings', () => {
    expect(AppSettingsSchema.parse({}).enabled_providers).toEqual({})
  })

  it('accepts persisted provider enablement flags', () => {
    expect(
      AppSettingsSchema.parse({ enabled_providers: { claude: false } })
        .enabled_providers
    ).toEqual({ claude: false })
  })
})

describe('burn series filters', () => {
  it('accepts the combined all-models scope', () => {
    expect(GetBurnSeriesInput.parse({ provider: 'all', range_days: 7 })).toEqual({
      provider: 'all',
      range_days: 7
    })
  })
})
