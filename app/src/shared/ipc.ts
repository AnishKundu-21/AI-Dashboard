import { z } from 'zod'
import {
  AlertRowSchema,
  AppSettingsSchema,
  BurnPointSchema,
  DailyUsagePointSchema,
  DashboardFilterSchema,
  ExportFormatSchema,
  ModelMixItemSchema,
  OverviewMetricsSchema,
  ProjectionCardSchema,
  ProviderIdSchema,
  QuotaSnapshotSchema,
  RangeDaysSchema,
  SessionRowSchema
} from './types'

/** Channel names used by main ↔ renderer via contextBridge */
export const IPC = {
  getOverview: 'dashboard:getOverview',
  getQuotas: 'dashboard:getQuotas',
  getDailyUsage: 'dashboard:getDailyUsage',
  getBurn: 'dashboard:getBurn',
  getModelMix: 'dashboard:getModelMix',
  getSessions: 'dashboard:getSessions',
  getProjections: 'dashboard:getProjections',
  refreshQuotas: 'dashboard:refreshQuotas',
  exportData: 'dashboard:export',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  alertsList: 'alerts:list',
  alertsDismiss: 'alerts:dismiss',
  onChanged: 'events:changed'
} as const

export const GetOverviewInput = DashboardFilterSchema.pick({
  provider: true,
  range_days: true
})
export type GetOverviewInput = z.infer<typeof GetOverviewInput>

export const GetSessionsInput = DashboardFilterSchema
export type GetSessionsInput = z.infer<typeof GetSessionsInput>

export const GetBurnInput = z.object({
  provider: ProviderIdSchema,
  range_days: RangeDaysSchema.default(7)
})
export type GetBurnInput = z.infer<typeof GetBurnInput>

export const ExportInput = z.object({
  format: ExportFormatSchema,
  filter: DashboardFilterSchema
})
export type ExportInput = z.infer<typeof ExportInput>

export const SettingsSetInput = AppSettingsSchema.partial()
export type SettingsSetInput = z.infer<typeof SettingsSetInput>

export const AlertsDismissInput = z.object({ id: z.string() })
export type AlertsDismissInput = z.infer<typeof AlertsDismissInput>

/** API surface exposed on window.api (preload) */
export interface DashboardApi {
  getOverview: (input?: GetOverviewInput) => Promise<z.infer<typeof OverviewMetricsSchema>>
  getQuotas: () => Promise<z.infer<typeof QuotaSnapshotSchema>[]>
  getDailyUsage: (input?: GetOverviewInput) => Promise<z.infer<typeof DailyUsagePointSchema>[]>
  getBurn: (input: GetBurnInput) => Promise<z.infer<typeof BurnPointSchema>[]>
  getModelMix: (input?: GetOverviewInput) => Promise<z.infer<typeof ModelMixItemSchema>[]>
  getSessions: (input?: GetSessionsInput) => Promise<z.infer<typeof SessionRowSchema>[]>
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
