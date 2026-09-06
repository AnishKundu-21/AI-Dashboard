import { z } from 'zod'
import { TokenTotalsSchema } from './tokens'

/**
 * Provider ids are validated by shape, not against a fixed list: a database or
 * export written by a build that knew about a provider must stay loadable by
 * one that does not.
 */
export const ProviderIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, 'provider ids are lowercase slugs')
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

export const UsageResolutionSchema = z.enum(['hour', 'day', 'week', 'month'])
export type UsageResolution = z.infer<typeof UsageResolutionSchema>

/** Keeps custom chart payloads bounded to the same one-year scale as presets. */
export const MAX_CUSTOM_ANALYTICS_DAYS = 366

/** An ISO calendar date, deliberately without a time or machine timezone. */
export const CalendarDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'calendar dates use YYYY-MM-DD')
  .refine((day) => {
    const parsed = new Date(`${day}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
  }, 'calendar date must exist')
export type CalendarDay = z.infer<typeof CalendarDaySchema>

const AnalyticsPeriodFieldsSchema = z.object({
  range_days: RangeDaysSchema.optional(),
  /** Inclusive start/end dates for a custom analytics window. */
  start_day: CalendarDaySchema.optional(),
  end_day: CalendarDaySchema.optional()
})

/**
 * A preset range or an explicit inclusive calendar range. Custom dates always
 * travel as a pair so main-process code never has to guess an open boundary.
 */
export const AnalyticsPeriodInputSchema = AnalyticsPeriodFieldsSchema.superRefine(
  (value, ctx) => {
    const hasCustomRange = Boolean(value.start_day || value.end_day)
    if (Boolean(value.start_day) !== Boolean(value.end_day)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_day and end_day must be supplied together',
        path: value.start_day ? ['end_day'] : ['start_day']
      })
    }
    if (value.start_day && value.end_day && value.start_day > value.end_day) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'start_day must not be after end_day',
        path: ['end_day']
      })
    }
    if (value.start_day && value.end_day) {
      const days = Math.floor(
        (Date.parse(`${value.end_day}T00:00:00.000Z`) -
          Date.parse(`${value.start_day}T00:00:00.000Z`)) /
          86_400_000
      ) + 1
      if (days > MAX_CUSTOM_ANALYTICS_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `custom analytics ranges are limited to ${MAX_CUSTOM_ANALYTICS_DAYS} days`,
          path: ['end_day']
        })
      }
    }
    if (hasCustomRange && value.range_days !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'custom dates cannot be combined with a preset range',
        path: ['range_days']
      })
    }
  }
).transform((value) => {
  if (value.start_day && value.end_day) {
    return { start_day: value.start_day, end_day: value.end_day }
  }
  return { range_days: value.range_days ?? 7 }
})
/** Raw renderer/IPC input. A custom range has no preset range-days field. */
export type AnalyticsPeriodInput = z.input<typeof AnalyticsPeriodInputSchema>
/** Validated main-process input. It is either a preset or a custom range. */
export type ResolvedAnalyticsPeriodInput = z.output<typeof AnalyticsPeriodInputSchema>

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

/** User-entered model prices, in USD per million tokens as vendors quote them. */
export const ModelPriceOverrideSchema = z.object({
  input_per_million: z.number().nonnegative(),
  output_per_million: z.number().nonnegative(),
  cache_read_per_million: z.number().nonnegative().optional(),
  cache_write_per_million: z.number().nonnegative().optional()
})
export type ModelPriceOverride = z.infer<typeof ModelPriceOverrideSchema>

/** Provenance of the rate table the displayed costs were computed from. */
export const PricingInfoSchema = z.object({
  status: z.enum(['fresh', 'cached', 'unavailable']),
  source: z.string(),
  fetched_at: z.string().nullable(),
  known_models: z.number()
})
export type PricingInfo = z.infer<typeof PricingInfoSchema>

/** Provenance of the FX rates, so converted money can say how current it is. */
export const FxInfoSchema = z.object({
  status: z.enum(['fresh', 'cached', 'unavailable']),
  source: z.string(),
  fetched_at: z.string().nullable(),
  rates_date: z.string().nullable(),
  currencies: z.array(z.string()),
  rates: z.record(z.string(), z.number())
})
export type FxInfo = z.infer<typeof FxInfoSchema>

export const AppSettingsSchema = z.object({
  display_currency: z.string().default('USD'),
  locale: z.string().default('en-US'),
  timezone: z.string().default('system'),
  notify_enabled: z.boolean().default(true),
  network_quota_refresh: z.boolean().default(true),
  retention_days: z.number().int().positive().default(90),
  /** Missing on older saved rows; the database reader treats those as complete. */
  onboarding_completed: z.boolean().optional(),
  /** Missing entries are enabled; explicit false disables collection and display. */
  enabled_providers: z.record(ProviderIdSchema, z.boolean()).default({}),
  /** Per-model price overrides, keyed by the exact provider model id. */
  price_overrides: z.record(z.string(), ModelPriceOverrideSchema).default({}),
  plans: z
    .record(ProviderIdSchema, PlanConfigSchema)
    .default({
      grok: { mode: 'auto', source: 'unknown' },
      claude: { mode: 'auto', source: 'unknown' },
      codex: { mode: 'auto', source: 'unknown' },
      cursor: { mode: 'auto', source: 'unknown' },
      opencode: { mode: 'auto', source: 'unknown' }
    })
})
export type AppSettings = z.infer<typeof AppSettingsSchema>

/**
 * One quota window, normalised across providers.
 *
 * `id` is what makes a sparse update merge onto the row an earlier probe drew,
 * rather than opening a second one; `kind` is what lets the UI order and label
 * windows without knowing which provider produced them.
 */
export const UsageWindowSchema = z.object({
  id: z.string(),
  kind: z.enum(['session', 'weekly', 'monthly', 'other']),
  label: z.string(),
  used_pct: z.number().min(0).max(100).nullable(),
  resets_at: z.string().nullable(),
  window_duration_mins: z.number().nullable()
})
export type UsageWindow = z.infer<typeof UsageWindowSchema>

/**
 * Why a quota figure is missing.
 *
 * These are genuinely different situations and were previously collapsed into
 * `estimate`: an API-key account *cannot* have subscription windows, which is
 * not the same as a probe that failed this time and will likely succeed next.
 */
export const QuotaUnavailableSchema = z.object({
  reason: z.enum([
    /** No credentials found for this provider. */
    'not_connected',
    /** Credentials exist but are not in a form this app recognises. */
    'auth_unreadable',
    /** This account has no subscription windows at all (API key, 3P provider). */
    'unsupported',
    /** The probe failed this time; the last good value may still be shown. */
    'probe_failed',
    /** The user turned network quota refresh off. */
    'network_disabled'
  ]),
  /** Short, user-facing, never carrying a token or a URL with credentials. */
  message: z.string().optional()
})
export type QuotaUnavailable = z.infer<typeof QuotaUnavailableSchema>

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
  windows: z
    .array(
      z.object({
        label: z.string(),
        used_pct: z.number().min(0).max(100).nullable(),
        remaining_pct: z.number().min(0).max(100).nullable(),
        reset_at: z.string().nullable()
      })
    )
    .optional(),
  products: z.record(z.string(), z.number()).optional(),
  remaining_text: z.string().optional(),
  /**
   * The normalised windows. `windows` above is the older, display-shaped list
   * kept for the current UI; this is what new code should read.
   */
  quota_windows: z.array(UsageWindowSchema).optional(),
  /** Present exactly when there is no usable figure, saying why. */
  unavailable: QuotaUnavailableSchema.optional(),
  /** Which mechanism produced this snapshot, for the diagnostics view. */
  transport: z.enum(['app-server', 'http', 'local', 'none']).optional(),
  /** Provider plan/account extras worth surfacing, e.g. Codex reset credits. */
  reset_credits: z
    .object({
      available_count: z.number(),
      next_expires_at: z.string().nullable(),
      title: z.string().nullable()
    })
    .optional()
})
export type QuotaSnapshot = z.infer<typeof QuotaSnapshotSchema>

export const UsageEventSchema = z.object({
  /**
   * Globally unique and stable across rescans, so re-reading a transcript
   * upserts the same row instead of adding a second one.
   */
  dedupe_key: z.string(),
  provider: ProviderIdSchema,
  session_id: z.string(),
  project: z.string(),
  /**
   * The raw provider model id, not a normalised display name: it is the key
   * the rate table is looked up by, and normalising first would lose the
   * version suffix that distinguishes two differently priced releases.
   */
  model: z.string(),
  ts_ms: z.number(),
  tokens: TokenTotalsSchema,
  /** Cost the provider itself reported, when it reports one. */
  reported_cost_usd: z.number().nullable(),
  source: z.string()
})
export type UsageEvent = z.infer<typeof UsageEventSchema>

export const SessionRowSchema = z.object({
  id: z.string(),
  provider: ProviderIdSchema,
  project: z.string(),
  model: z.string(),
  tokens_in: z.number().nullable(),
  tokens_out: z.number().nullable(),
  tokens_total: z.number().nullable(),
  tokens_cached: z.number().nullable().optional(),
  tokens_reasoning: z.number().nullable().optional(),
  model_calls: z.number().nullable().optional(),
  api_equiv_usd: z.number().nullable(),
  provider_cost_usd: z.number().nullable().optional(),
  api_duration_ms: z.number().nullable().optional(),
  /**
   * The canonical four-class split. `tokens_in` / `tokens_cached` and friends
   * above are flattened views of this, kept so existing consumers keep
   * working; anything doing arithmetic should read this instead.
   */
  tokens: TokenTotalsSchema.optional(),
  /** What prompt caching saved against the full input rate, in USD. */
  cache_savings_usd: z.number().nullable().optional(),
  /** True when no rate was found for the model, so `api_equiv_usd` is null. */
  unpriced: z.boolean().optional(),
  duration_ms: z.number().nullable(),
  status: SessionStatusSchema,
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  source: z.string()
})
export type SessionRow = z.infer<typeof SessionRowSchema>

export const CollectorHealthSchema = z.object({
  provider: ProviderIdSchema,
  source_label: z.string(),
  watcher_status: z.enum(['watching', 'polling', 'missing', 'error']),
  last_scan_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error: z.string().nullable(),
  sessions_seen: z.number().int().nonnegative(),
  last_duration_ms: z.number().int().nonnegative().nullable()
})
export type CollectorHealth = z.infer<typeof CollectorHealthSchema>

export const ProviderCostSchema = z.object({
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  uncached_input: z.number(),
  cached_input: z.number(),
  cache_creation: z.number(),
  output: z.number(),
  reasoning: z.number(),
  model_calls: z.number(),
  api_equiv_usd: z.number(),
  provider_cost_usd: z.number(),
  cache_savings_usd: z.number(),
  unpriced_calls: z.number(),
  session_count: z.number()
})
export type ProviderCost = z.infer<typeof ProviderCostSchema>

export const OverviewMetricsSchema = z.object({
  tokens_total: z.number(),
  api_equiv_usd: z.number(),
  session_count: z.number(),
  avg_used_pct: z.number().nullable(),
  /** Null for an explicit custom range; see the analytics window for its dates. */
  range_days: RangeDaysSchema.nullable(),
  avg_daily_tokens: z.number(),
  token_breakdown: z.object({
    uncached_input: z.number(),
    cached_input: z.number(),
    cache_creation: z.number(),
    output: z.number(),
    reasoning: z.number(),
    model_calls: z.number()
  }),
  by_provider: z.array(ProviderCostSchema),
  /** What prompt caching saved against full input rates, over the window. */
  cache_savings_usd: z.number(),
  /** Sessions containing at least one event whose model had no known rate. */
  unpriced_sessions: z.number(),
  pricing: PricingInfoSchema,
  fx: FxInfoSchema
})
export type OverviewMetrics = z.infer<typeof OverviewMetricsSchema>

/** The portion of an analytics snapshot that is meaningful to compare over time. */
export const AnalyticsTotalsSchema = z.object({
  tokens_total: z.number(),
  api_equiv_usd: z.number(),
  session_count: z.number(),
  cache_savings_usd: z.number(),
  unpriced_sessions: z.number(),
  token_breakdown: z.object({
    uncached_input: z.number(),
    cached_input: z.number(),
    cache_creation: z.number(),
    output: z.number(),
    reasoning: z.number(),
    model_calls: z.number()
  })
})
export type AnalyticsTotals = z.infer<typeof AnalyticsTotalsSchema>

/** A resolved calendar window returned by the main process, never guessed in the renderer. */
export const AnalyticsWindowSchema = z.object({
  start_day: CalendarDaySchema.nullable(),
  end_day: CalendarDaySchema.nullable(),
  days: z.number().int().positive().nullable(),
  timezone: z.string(),
  label: z.string()
})
export type AnalyticsWindow = z.infer<typeof AnalyticsWindowSchema>

export const AnalyticsSnapshotSchema = z.object({
  window: AnalyticsWindowSchema,
  current: AnalyticsTotalsSchema,
  previous: z
    .object({
      window: AnalyticsWindowSchema,
      totals: AnalyticsTotalsSchema
    })
    .nullable()
})
export type AnalyticsSnapshot = z.infer<typeof AnalyticsSnapshotSchema>

export const DailyUsagePointSchema = z.object({
  day: z.string(),
  /** Stable chronological key; distinct from the display bucket during DST. */
  bucket_start_ms: z.number(),
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  uncached_input: z.number(),
  cached_input: z.number(),
  cache_creation: z.number(),
  output: z.number(),
  reasoning: z.number(),
  model_calls: z.number(),
  session_count: z.number(),
  api_equiv_usd: z.number(),
  provider_cost_usd: z.number(),
  cache_savings_usd: z.number(),
  unpriced_calls: z.number()
})
export type DailyUsagePoint = z.infer<typeof DailyUsagePointSchema>

export const ModelMixItemSchema = z.object({
  model: z.string(),
  provider: ProviderIdSchema,
  tokens_total: z.number(),
  uncached_input: z.number(),
  cached_input: z.number(),
  cache_creation: z.number(),
  output: z.number(),
  reasoning: z.number(),
  model_calls: z.number(),
  session_count: z.number(),
  api_equiv_usd: z.number(),
  provider_cost_usd: z.number(),
  cache_savings_usd: z.number(),
  unpriced_calls: z.number(),
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
export type DashboardFilter = z.infer<typeof DashboardFilterSchema>

export const ExportFormatSchema = z.enum(['csv', 'json'])
export type ExportFormat = z.infer<typeof ExportFormatSchema>

export const BurnPointSchema = z.object({
  day: z.string(),
  used_pct: z.number(),
  projected: z.boolean()
})
export type BurnPoint = z.infer<typeof BurnPointSchema>

export const BurnSeriesSchema = z.object({
  id: z.string(),
  provider: ProviderIdSchema,
  label: z.string(),
  points: z.array(BurnPointSchema)
})
export type BurnSeries = z.infer<typeof BurnSeriesSchema>

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
