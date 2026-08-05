import type { AppSettings, QuotaSnapshot } from '../../../shared/types'
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

  const windows = [
    toWindow('Session (5h)', fiveHour),
    toWindow('Weekly (all models)', sevenDay),
    toWindow('Weekly (Opus)', sevenDayOpus),
    toWindow('Weekly (Sonnet)', sevenDaySonnet)
  ].filter(
    (window): window is NonNullable<QuotaSnapshot['windows']>[number] =>
      window != null
  )

  return {
    provider: 'claude',
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    used_pct: used != null ? clampPct(used) : null,
    remaining_pct: used != null ? clampPct(100 - used) : null,
    reset_at: fiveHour?.resets_at ?? null,
    window_label: 'Session (5h)',
    plan_label: plan.plan_label,
    plan_source: plan.plan_source,
    confidence: used != null ? 'live' : 'estimate',
    source: opts.source ?? 'api.anthropic.com/api/oauth/usage',
    auth_connected: opts.authConnected,
    stale: false,
    live_captured_at:
      used != null ? (opts.capturedAt ?? new Date().toISOString()) : null,
    windows: windows.length ? windows : undefined
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

function toWindow(
  label: string,
  window: UsageWindow | null
): NonNullable<QuotaSnapshot['windows']>[number] | null {
  if (!window) return null
  const used = window.utilization
  return {
    label,
    used_pct: used != null ? clampPct(used) : null,
    remaining_pct: used != null ? clampPct(100 - used) : null,
    reset_at: window.resets_at
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, +n.toFixed(2)))
}
