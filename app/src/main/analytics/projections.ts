import type { ProviderId } from '../../shared/providers'
import type { ProjectionCard, QuotaSnapshot } from '../../shared/types'

export interface DailyTokens {
  day: string
  tokens_total: number
}

/**
 * Pure projection math from latest quota + recent daily token burn.
 */
export function buildProjectionCard(
  q: QuotaSnapshot,
  recentDaily: DailyTokens[],
  lookbackDays: number
): ProjectionCard {
  if (!q.auth_connected) {
    return {
      provider: q.provider,
      headline: 'Not connected',
      detail: 'Install the CLI and log in, then refresh quotas.',
      level: 'info',
      days_to_empty: null,
      daily_burn_pct: null,
      recommendation: 'Open the tool and complete login on this machine.'
    }
  }

  if (q.confidence !== 'live' || q.used_pct == null) {
    const tokenBurn = avgDailyTokens(recentDaily)
    return {
      provider: q.provider,
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

  const used = q.used_pct
  const remaining = q.remaining_pct ?? Math.max(0, 100 - used)
  const dailyBurnPct = estimateDailyBurnPct(q, lookbackDays)
  const daysToEmpty =
    dailyBurnPct != null && dailyBurnPct > 0.05
      ? +(remaining / dailyBurnPct).toFixed(1)
      : null

  if (used >= 90) {
    return {
      provider: q.provider,
      headline: 'Near exhaustion',
      detail: `${Math.round(used)}% used · ${Math.round(remaining)}% left${daysToEmpty != null ? ` · ~${daysToEmpty}d at current pace` : ''}.`,
      level: 'warn',
      days_to_empty: daysToEmpty,
      daily_burn_pct: dailyBurnPct,
      recommendation: 'Pause non-urgent agent work until the window resets.'
    }
  }

  if (used >= 70 || (daysToEmpty != null && daysToEmpty <= 3)) {
    return {
      provider: q.provider,
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

  if (dailyBurnPct != null && dailyBurnPct < 1 && remaining > 50) {
    return {
      provider: q.provider,
      headline: 'On track',
      detail: `${Math.round(remaining)}% remaining · ${q.window_label ?? 'current window'}${dailyBurnPct != null ? ` · ~${dailyBurnPct.toFixed(1)}%/day` : ''}.`,
      level: 'good',
      days_to_empty: daysToEmpty,
      daily_burn_pct: dailyBurnPct,
      recommendation: 'Healthy headroom for the rest of the window.'
    }
  }

  return {
    provider: q.provider,
    headline: 'On track',
    detail: `${Math.round(remaining)}% remaining · ${q.window_label ?? 'current window'}${daysToEmpty != null ? ` · ~${daysToEmpty}d runway` : ''}.`,
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
  lookbackDays: number
): number | null {
  if (q.used_pct == null) return null

  if (q.reset_at) {
    const reset = Date.parse(q.reset_at)
    if (!Number.isNaN(reset)) {
      // Assume window length from window_label when possible
      const windowDays = windowDaysGuess(q.window_label)
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
  if (id === 'grok') return 'Grok'
  if (id === 'claude') return 'Claude'
  return 'Codex'
}
