import type { AppSettings, QuotaSnapshot, UsageWindow as NormalizedWindow } from '../../../shared/types'
import { resolvePlan } from '../plan'

interface UsageWindow {
  utilization: number | null
  resets_at: string | null
}

/** Pure mapper: Claude Code /api/oauth/usage → QuotaSnapshot */
export function mapClaudeUsage(
  body: unknown,
  opts: {
    settings: AppSettings
    authConnected: boolean
    subscriptionType?: string | null
    capturedAt?: string
    source?: string
  }
): QuotaSnapshot {
  const root = asRecord(body) ?? {}
  const fiveHour = asWindow(root.five_hour)
  const sevenDay = asWindow(root.seven_day)
  const sevenDayOpus = asWindow(root.seven_day_opus)
  const sevenDaySonnet = asWindow(root.seven_day_sonnet)

  const used = fiveHour?.utilization ?? null

  const plan = resolvePlan(
    opts.settings,
    'claude',
    opts.subscriptionType ?? null,
    'auth'
  )

  const quotaWindows = [
    toUsageWindow('five_hour', 'session', 'Session (5h)', 5 * 60, fiveHour),
    toUsageWindow('seven_day', 'weekly', 'Weekly (all models)', 7 * 24 * 60, sevenDay),
    toUsageWindow('seven_day_opus', 'weekly', 'Weekly (Opus)', 7 * 24 * 60, sevenDayOpus),
    toUsageWindow('seven_day_sonnet', 'weekly', 'Weekly (Sonnet)', 7 * 24 * 60, sevenDaySonnet)
  ].filter(
    (window): window is NormalizedWindow => window != null
  )
  const windows = quotaWindows.map((window) => ({
    label: window.label,
    used_pct: window.used_pct,
    remaining_pct: window.used_pct == null ? null : clampPct(100 - window.used_pct),
    reset_at: window.resets_at
  }))

  return {
    provider: 'claude',
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    used_pct: used != null ? clampPct(used) : null,
    remaining_pct: used != null ? clampPct(100 - used) : null,
    reset_at: normalizeReset(fiveHour?.resets_at),
    window_label: 'Session (5h)',
    plan_label: plan.plan_label,
    plan_source: plan.plan_source,
    confidence: used != null ? 'live' : 'estimate',
    source: opts.source ?? 'api.anthropic.com/api/oauth/usage',
    auth_connected: opts.authConnected,
    stale: false,
    live_captured_at:
      used != null ? (opts.capturedAt ?? new Date().toISOString()) : null,
    windows: windows.length ? windows : undefined,
    quota_windows: quotaWindows.length ? quotaWindows : undefined,
    transport: 'http'
  }
}

function asWindow(v: unknown): UsageWindow | null {
  const row = asRecord(v)
  if (!row) return null
  const utilization =
    typeof row.utilization === 'number' && Number.isFinite(row.utilization)
      ? row.utilization
      : null
  const resets_at = typeof row.resets_at === 'string' ? row.resets_at : null
  if (utilization == null && resets_at == null) return null
  return { utilization, resets_at }
}

function toUsageWindow(
  id: string,
  kind: NormalizedWindow['kind'],
  label: string,
  durationMins: number,
  window: UsageWindow | null
): NormalizedWindow | null {
  if (!window) return null
  const used = window.utilization
  return {
    id,
    kind,
    label,
    used_pct: used != null ? clampPct(used) : null,
    resets_at: normalizeReset(window.resets_at),
    window_duration_mins: durationMins
  }
}

function normalizeReset(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString()
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, +n.toFixed(2)))
}
