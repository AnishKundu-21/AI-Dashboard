import { describe, expect, it } from 'vitest'
import { AnalyticsPeriodInputSchema, AppSettingsSchema, DashboardFilterSchema } from './types'
import { GetAnalyticsSnapshotInput, GetBurnSeriesInput } from './ipc'

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

describe('analytics period input', () => {
  it('accepts one inclusive custom range alongside a provider filter', () => {
    expect(
      GetAnalyticsSnapshotInput.parse({
        provider: 'claude',
        start_day: '2026-09-02',
        end_day: '2026-09-04'
      })
    ).toMatchObject({
      provider: 'claude',
      range_days: 7,
      start_day: '2026-09-02',
      end_day: '2026-09-04'
    })
  })

  it('rejects incomplete, reversed, and impossible custom dates', () => {
    expect(() => AnalyticsPeriodInputSchema.parse({ start_day: '2026-09-02' })).toThrow()
    expect(() =>
      AnalyticsPeriodInputSchema.parse({
        start_day: '2026-09-04',
        end_day: '2026-09-02'
      })
    ).toThrow()
    expect(() =>
      AnalyticsPeriodInputSchema.parse({
        start_day: '2026-02-29',
        end_day: '2026-03-01'
      })
    ).toThrow()
    expect(() =>
      AnalyticsPeriodInputSchema.parse({
        range_days: 7,
        start_day: '2026-09-02',
        end_day: '2026-09-04'
      })
    ).toThrow()
  })
})
