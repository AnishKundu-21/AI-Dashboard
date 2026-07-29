import { z } from 'zod'
import { PROVIDER_IDS } from './providers'

export const ProviderIdSchema = z.enum(PROVIDER_IDS)
export type ProviderId = z.infer<typeof ProviderIdSchema>

/** Zero represents the complete locally retained history. */
export const RangeDaysSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(7),
  z.literal(30),
  z.literal(180),
  z.literal(365)
])
export type RangeDays = z.infer<typeof RangeDaysSchema>

export const ConfidenceSchema = z.enum(['live', 'estimate', 'unknown'])
export type Confidence = z.infer<typeof ConfidenceSchema>

export const PlanSourceSchema = z.enum(['api', 'auth', 'user', 'unknown'])
export type PlanSource = z.infer<typeof PlanSourceSchema>

export const SessionStatusSchema = z.enum([
  'complete',
  'cancelled',
  'error',
  'rate_limited',
  'unknown'
])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const PlanConfigSchema = z.object({
  mode: z.enum(['auto', 'manual']),
  value: z.string().optional(),
  detected: z.string().optional(),
  source: PlanSourceSchema.optional()
})
export type PlanConfig = z.infer<typeof PlanConfigSchema>

export const AppSettingsSchema = z.object({
  display_currency: z.string().default('USD'),
  locale: z.string().default('en-US'),
  notify_enabled: z.boolean().default(true),
  network_quota_refresh: z.boolean().default(true),
  retention_days: z.number().int().positive().default(90),
  plans: z
    .record(ProviderIdSchema, PlanConfigSchema)
    .default({
      grok: { mode: 'auto', source: 'unknown' },
      claude: { mode: 'auto', source: 'unknown' },
      codex: { mode: 'auto', source: 'unknown' }
    })
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

export const QuotaSnapshotSchema = z.object({
  provider: ProviderIdSchema,
  captured_at: z.string(),
  used_pct: z.number().min(0).max(100).nullable(),
  remaining_pct: z.number().min(0).max(100).nullable(),
  reset_at: z.string().nullable(),
  window_label: z.string().nullable(),
  plan_label: z.string().nullable(),
  plan_source: PlanSourceSchema.nullable(),
  confidence: ConfidenceSchema,
  source: z.string(),
  auth_connected: z.boolean(),
  stale: z.boolean().optional(),
  live_captured_at: z.string().nullable().optional(),
  products: z.record(z.string(), z.number()).optional(),
  remaining_text: z.string().optional()
})
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>

export const SessionRowSchema = z.object({
  id: z.string(),
  provider: ProviderIdSchema,
  project: z.string(),
  model: z.string(),
  tokens_in: z.number().nullable(),
  tokens_out: z.number().nullable(),
  tokens_total: z.number().nullable(),
  api_equiv_usd: z.number().nullable(),
  duration_ms: z.number().nullable(),
  status: SessionStatusSchema,
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  source: z.string()
})
export type SessionRow = z.infer<typeof SessionRowSchema>

export const ProviderCostSchema = z.object({
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  api_equiv_usd: z.number(),
  session_count: z.number()
})
export type ProviderCost = z.infer<typeof ProviderCostSchema>

export const OverviewMetricsSchema = z.object({
  tokens_total: z.number(),
  api_equiv_usd: z.number(),
  session_count: z.number(),
  avg_used_pct: z.number().nullable(),
  range_days: RangeDaysSchema,
  avg_daily_tokens: z.number(),
  by_provider: z.array(ProviderCostSchema),
  rate_card_version: z.string()
})
export type OverviewMetrics = z.infer<typeof OverviewMetricsSchema>

export const DailyUsagePointSchema = z.object({
  day: z.string(),
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  session_count: z.number(),
  api_equiv_usd: z.number()
})
export type DailyUsagePoint = z.infer<typeof DailyUsagePointSchema>

export const ModelMixItemSchema = z.object({
  model: z.string(),
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  share: z.number()
})
export type ModelMixItem = z.infer<typeof ModelMixItemSchema>

export const AlertRowSchema = z.object({
  id: z.string(),
  provider: ProviderIdSchema.nullable(),
  level: z.enum(['info', 'warn', 'error']),
  title: z.string(),
  body: z.string(),
  rule_id: z.string(),
  created_at: z.string(),
  dismissed_at: z.string().nullable()
})
export type AlertRow = z.infer<typeof AlertRowSchema>

export const DashboardFilterSchema = z.object({
  provider: z.union([ProviderIdSchema, z.literal('all')]).default('all'),
  range_days: RangeDaysSchema.default(7),
  search: z.string().optional()
})
export type DashboardFilter = z.infer<typeof DashboardFilterSchema>

export const ExportFormatSchema = z.enum(['csv', 'json'])
export type ExportFormat = z.infer<typeof ExportFormatSchema>

export const BurnPointSchema = z.object({
  day: z.string(),
  used_pct: z.number(),
  projected: z.boolean()
})
export type BurnPoint = z.infer<typeof BurnPointSchema>

export const ProjectionCardSchema = z.object({
  provider: ProviderIdSchema,
  headline: z.string(),
  detail: z.string(),
  level: z.enum(['good', 'warn', 'info']),
  days_to_empty: z.number().nullable().optional(),
  daily_burn_pct: z.number().nullable().optional(),
  recommendation: z.string().optional()
})
export type ProjectionCard = z.infer<typeof ProjectionCardSchema>
