import { providerMeta, type ProviderId } from '../../shared/providers'
import type {
  ForecastConfidence,
  ProjectionCard,
  QuotaSnapshot,
  UsageWindow
} from '../../shared/types'

export interface DailyTokens {
  day: string
  tokens_total: number
}

export type ForecastWindow = Pick<
  UsageWindow,
  'id' | 'kind' | 'label' | 'used_pct' | 'resets_at' | 'window_duration_mins'
>

/**
 * A provider can expose several independent allowances. Keep them separate:
 * a five-hour session limit and a seven-day allowance are not interchangeable.
 */
export function forecastWindows(q: QuotaSnapshot): ForecastWindow[] {
  if (q.quota_windows && q.quota_windows.length > 0) return q.quota_windows

  const label = q.window_label ?? 'Current window'
  return [{
    id: 'primary',
    kind: kindFromLabel(label),
    label,
    used_pct: q.used_pct,
    resets_at: q.reset_at,
    window_duration_mins: null
  }]
}

/**
 * Pure projection math from latest quota + recent daily token burn.
 */
export function buildProjectionCard(
  q: QuotaSnapshot,
  recentDaily: DailyTokens[],
  lookbackDays: number,
  selectedWindow?: ForecastWindow
): ProjectionCard {
  const window = selectedWindow ?? forecastWindows(q)[0]
  const used = window?.used_pct ?? q.used_pct
  const remaining = used == null ? null : Math.max(0, 100 - used)
  const label = window?.label ?? q.window_label ?? 'Current window'
  const confidence = forecastConfidence(q, window, used)
  const base = {
    id: `${q.provider}:${window?.id ?? 'primary'}`,
    provider: q.provider,
    window_kind: window?.kind ?? kindFromLabel(label),
    window_label: label,
    resets_at: window?.resets_at ?? q.reset_at,
    forecast_confidence: confidence
  } as const

  if (!q.auth_connected) {
    return {
      ...base,
      headline: 'Not connected',
      detail: 'Install the CLI and log in, then refresh quotas.',
      level: 'info',
      days_to_empty: null,
      daily_burn_pct: null,
      recommendation: 'Open the tool and complete login on this machine.'
    }
  }

  // A short session allowance is a current guardrail, not a multi-day budget.
  // It resets too often for day-based pace or runway to mean anything.
  if (window?.kind === 'session') {
    return {
      ...base,
      forecast_confidence: 'unknown',
      headline: 'Session snapshot',
      detail: used == null
        ? 'No current session usage figure from the provider.'
        : `${Math.round(used)}% used in the current ${label.toLowerCase()} window.`,
      level: used != null && used >= 70 ? 'warn' : 'info',
      days_to_empty: null,
      daily_burn_pct: null,
      recommendation: 'Short session windows show current usage and reset time only; no daily pace is projected.'
    }
  }

  if (q.confidence !== 'live' || used == null || !isLongHorizonWindow(window?.kind)) {
    const tokenBurn = avgDailyTokens(recentDaily)
    return {
      ...base,
      headline: 'Estimate only',
      detail:
        tokenBurn > 0
          ? `~${formatTokensShort(tokenBurn)} tokens/day locally · no official remaining %.`
          : 'No official remaining figure yet — sessions still tracked locally.',
      level: 'info',
      days_to_empty: null,
      daily_burn_pct: null,
      recommendation:
        'Keep network quota refresh on, or set plan label in Settings if you want a display name.'
    }
  }

  const resolvedRemaining = remaining ?? Math.max(0, 100 - used)
  const dailyBurnPct = estimateDailyBurnPct(
    { ...q, used_pct: used, remaining_pct: resolvedRemaining, reset_at: window?.resets_at ?? q.reset_at, window_label: label },
    lookbackDays,
    window?.window_duration_mins
  )
  const daysToEmpty =
    dailyBurnPct != null && dailyBurnPct > 0.05
      ? +(resolvedRemaining / dailyBurnPct).toFixed(1)
      : null

  if (used >= 90) {
    return {
      ...base,
      headline: 'Near exhaustion',
      detail: `${Math.round(used)}% used · ${Math.round(resolvedRemaining)}% left${daysToEmpty != null ? ` · ~${daysToEmpty}d at current pace` : ''}.`,
      level: 'warn',
      days_to_empty: daysToEmpty,
      daily_burn_pct: dailyBurnPct,
      recommendation: 'Pause non-urgent agent work until the window resets.'
    }
  }

  if (used >= 70 || (daysToEmpty != null && daysToEmpty <= 3)) {
    return {
      ...base,
      headline: daysToEmpty != null && daysToEmpty <= 3 ? 'May run out soon' : 'High burn',
      detail: `${Math.round(used)}% used${daysToEmpty != null ? ` · ~${daysToEmpty} days to empty at current pace` : ''}.`,
      level: 'warn',
      days_to_empty: daysToEmpty,
      daily_burn_pct: dailyBurnPct,
      recommendation:
        daysToEmpty != null && daysToEmpty <= 3
          ? 'Slow down or switch provider before mid-task limits.'
          : 'Watch burn; schedule heavy jobs after reset if possible.'
    }
  }

  if (dailyBurnPct != null && dailyBurnPct < 1 && resolvedRemaining > 50) {
    return {
      ...base,
      headline: 'On track',
      detail: `${Math.round(resolvedRemaining)}% remaining · ${label}${dailyBurnPct != null ? ` · ~${dailyBurnPct.toFixed(1)}%/day` : ''}.`,
      level: 'good',
      days_to_empty: daysToEmpty,
      daily_burn_pct: dailyBurnPct,
      recommendation: 'Healthy headroom for the rest of the window.'
    }
  }

  return {
    ...base,
    headline: 'On track',
    detail: `${Math.round(resolvedRemaining)}% remaining · ${label}${daysToEmpty != null ? ` · ~${daysToEmpty}d runway` : ''}.`,
    level: 'good',
    days_to_empty: daysToEmpty,
    daily_burn_pct: dailyBurnPct,
    recommendation:
      daysToEmpty != null && daysToEmpty < 7
        ? 'Room is fine; keep an eye on multi-agent runs.'
        : 'Usage pace looks sustainable for this window.'
  }
}

/** Prefer window-based burn; fall back to used/lookback. */
export function estimateDailyBurnPct(
  q: QuotaSnapshot,
  lookbackDays: number,
  windowDurationMins?: number | null
): number | null {
  if (q.used_pct == null) return null

  if (q.reset_at) {
    const reset = Date.parse(q.reset_at)
    if (!Number.isNaN(reset)) {
      const windowDays = windowDurationMins != null && windowDurationMins > 0
        ? windowDurationMins / (24 * 60)
        : windowDaysGuess(q.window_label)
      if (windowDays > 0) {
        // used so far over elapsed portion of window
        const start = reset - windowDays * 86_400_000
        const elapsedDays = Math.max(0.25, (Date.now() - start) / 86_400_000)
        return +(q.used_pct / elapsedDays).toFixed(2)
      }
    }
  }

  const days = Math.max(lookbackDays, 1)
  return +(q.used_pct / days).toFixed(2)
}

function forecastConfidence(
  q: QuotaSnapshot,
  window: ForecastWindow | undefined,
  used: number | null
): ForecastConfidence {
  if (!q.auth_connected || used == null) return 'unknown'
  if (q.confidence !== 'live') return 'low'
  if (window?.resets_at && window.window_duration_mins != null) return 'high'
  return 'medium'
}

function kindFromLabel(label: string): UsageWindow['kind'] {
  const normalized = label.toLowerCase()
  if (normalized.includes('session') || normalized.includes('hour')) return 'session'
  if (normalized.includes('week') || normalized.includes('seven day')) return 'weekly'
  if (normalized.includes('month')) return 'monthly'
  return 'other'
}

function isLongHorizonWindow(kind: UsageWindow['kind'] | undefined): boolean {
  return kind === 'weekly' || kind === 'monthly'
}

export function willExhaustWithinDays(
  q: QuotaSnapshot,
  withinDays: number,
  lookbackDays: number
): boolean {
  if (!q.auth_connected || q.used_pct == null) return false
  const remaining = q.remaining_pct ?? Math.max(0, 100 - q.used_pct)
  const daily = estimateDailyBurnPct(q, lookbackDays)
  if (daily == null || daily <= 0) return false
  return remaining / daily <= withinDays
}

function windowDaysGuess(label: string | null): number {
  if (!label) return 7
  const l = label.toLowerCase()
  if (l.includes('week')) return 7
  if (l.includes('day')) return 1
  if (l.includes('5h') || l.includes('hour')) return 0.2
  if (l.includes('month')) return 30
  return 7
}

function avgDailyTokens(rows: DailyTokens[]): number {
  if (rows.length === 0) return 0
  const sum = rows.reduce((s, r) => s + r.tokens_total, 0)
  return sum / rows.length
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}

export function providerLabel(id: ProviderId): string {
  return providerMeta(id).short
}
