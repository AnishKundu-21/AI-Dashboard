import { z } from 'zod'
import {
  AlertRowSchema,
  AnalyticsPeriodInputSchema,
  AnalyticsSnapshotSchema,
  AppSettingsSchema,
  BurnPointSchema,
  BurnSeriesSchema,
  CollectorHealthSchema,
  DailyUsagePointSchema,
  ExportFormatSchema,
  ModelMixItemSchema,
  ModelUsagePointSchema,
  OverviewMetricsSchema,
  ProjectionCardSchema,
  ProviderIdSchema,
  QuotaSnapshotSchema,
  RangeDaysSchema,
  SessionRowSchema,
  UsageResolutionSchema
} from './types'

/** Channel names used by main ↔ renderer via contextBridge */
export const IPC = {
  getOverview: 'dashboard:getOverview',
  getAnalyticsSnapshot: 'dashboard:getAnalyticsSnapshot',
  getQuotas: 'dashboard:getQuotas',
  getDailyUsage: 'dashboard:getDailyUsage',
  getModelUsage: 'dashboard:getModelUsage',
  getBurn: 'dashboard:getBurn',
  getBurnSeries: 'dashboard:getBurnSeries',
  getModelMix: 'dashboard:getModelMix',
  getSessions: 'dashboard:getSessions',
  getCollectorHealth: 'dashboard:getCollectorHealth',
  rescanProvider: 'dashboard:rescanProvider',
  getProjections: 'dashboard:getProjections',
  refreshQuotas: 'dashboard:refreshQuotas',
  exportData: 'dashboard:export',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  alertsList: 'alerts:list',
  alertsDismiss: 'alerts:dismiss',
  onChanged: 'events:changed'
} as const

const ProviderPeriodInputSchema = z
  .object({
    provider: z.union([ProviderIdSchema, z.literal('all')]).default('all')
  })
  .and(AnalyticsPeriodInputSchema)

export const GetOverviewInput = ProviderPeriodInputSchema
export type GetOverviewInput = z.input<typeof GetOverviewInput>

/** A resolved current/previous-period analytics snapshot. */
export const GetAnalyticsSnapshotInput = ProviderPeriodInputSchema
export type GetAnalyticsSnapshotInput = z.input<typeof GetAnalyticsSnapshotInput>

export const GetDailyUsageInput = ProviderPeriodInputSchema.and(
  z.object({ resolution: UsageResolutionSchema.default('day') })
)
export type GetDailyUsageInput = z.input<typeof GetDailyUsageInput>
export const GetModelUsageInput = GetDailyUsageInput
export type GetModelUsageInput = z.input<typeof GetModelUsageInput>

const SessionPeriodInputSchema = z
  .object({
    provider: z.union([ProviderIdSchema, z.literal('all')]).default('all'),
    search: z.string().optional(),
    model: z.string().optional(),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    sort_by: z
      .enum(['started_at', 'tokens_total', 'api_equiv_usd', 'duration_ms'])
      .default('started_at'),
    sort_dir: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0)
  })
  .and(AnalyticsPeriodInputSchema)

export const GetSessionsInput = SessionPeriodInputSchema
export type GetSessionsInput = z.input<typeof GetSessionsInput>

export const GetBurnInput = z.object({
  provider: ProviderIdSchema,
  range_days: RangeDaysSchema.default(7)
})
export type GetBurnInput = z.infer<typeof GetBurnInput>

export const GetBurnSeriesInput = z.object({
  provider: z.union([ProviderIdSchema, z.literal('all')]).default('all'),
  range_days: RangeDaysSchema.default(7)
})
export type GetBurnSeriesInput = z.infer<typeof GetBurnSeriesInput>

export const ExportInput = z.object({
  format: ExportFormatSchema,
  filter: SessionPeriodInputSchema
})
export type ExportInput = z.input<typeof ExportInput>

export const SettingsSetInput = AppSettingsSchema.partial()
export type SettingsSetInput = z.infer<typeof SettingsSetInput>

export const AlertsDismissInput = z.object({ id: z.string() })
export type AlertsDismissInput = z.infer<typeof AlertsDismissInput>

export const RescanProviderInput = z.object({ provider: ProviderIdSchema })
export type RescanProviderInput = z.infer<typeof RescanProviderInput>

/** API surface exposed on window.api (preload) */
export interface DashboardApi {
  getOverview: (input?: GetOverviewInput) => Promise<z.infer<typeof OverviewMetricsSchema>>
  getAnalyticsSnapshot: (
    input?: GetAnalyticsSnapshotInput
  ) => Promise<z.infer<typeof AnalyticsSnapshotSchema>>
  getQuotas: () => Promise<z.infer<typeof QuotaSnapshotSchema>[]>
  getDailyUsage: (input?: GetDailyUsageInput) => Promise<z.infer<typeof DailyUsagePointSchema>[]>
  getModelUsage: (input?: GetModelUsageInput) => Promise<z.infer<typeof ModelUsagePointSchema>[]>
  getBurn: (input: GetBurnInput) => Promise<z.infer<typeof BurnPointSchema>[]>
  getBurnSeries: (input?: GetBurnSeriesInput) => Promise<z.infer<typeof BurnSeriesSchema>[]>
  getModelMix: (input?: GetOverviewInput) => Promise<z.infer<typeof ModelMixItemSchema>[]>
  getSessions: (input?: GetSessionsInput) => Promise<z.infer<typeof SessionRowSchema>[]>
  getCollectorHealth: () => Promise<z.infer<typeof CollectorHealthSchema>[]>
  rescanProvider: (input: RescanProviderInput) => Promise<{ upserted: number }>
  getProjections: () => Promise<z.infer<typeof ProjectionCardSchema>[]>
  refreshQuotas: () => Promise<z.infer<typeof QuotaSnapshotSchema>[]>
  exportData: (
    input: ExportInput
  ) => Promise<{ ok: true; path?: string; content: string; cancelled?: boolean }>
  getSettings: () => Promise<z.infer<typeof AppSettingsSchema>>
  setSettings: (input: SettingsSetInput) => Promise<z.infer<typeof AppSettingsSchema>>
  listAlerts: () => Promise<z.infer<typeof AlertRowSchema>[]>
  dismissAlert: (input: AlertsDismissInput) => Promise<void>
  onChanged: (cb: () => void) => () => void
}
