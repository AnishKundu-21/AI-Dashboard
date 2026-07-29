import type { AppSettings, QuotaSnapshot } from '../../../shared/types'
import { resolvePlan, windowLabelFromSeconds } from '../plan'

/** Pure mapper: ChatGPT wham/usage → QuotaSnapshot */
export function mapCodexUsage(
  body: unknown,
  opts: {
    settings: AppSettings
    authConnected: boolean
    capturedAt?: string
    source?: string
    resetCreditsAvailable?: boolean
  }
): QuotaSnapshot {
  const root = asRecord(body) ?? {}
  const planType =
    typeof root.plan_type === 'string' ? root.plan_type : null

  const rateLimit = asRecord(root.rate_limit)
  const primary = asRecord(rateLimit?.primary_window)
  const secondary = asRecord(rateLimit?.secondary_window)

  const usedRaw = primary?.used_percent
  const used =
    typeof usedRaw === 'number' && Number.isFinite(usedRaw)
      ? clampPct(usedRaw)
      : null

  const windowSeconds =
    typeof primary?.limit_window_seconds === 'number'
      ? primary.limit_window_seconds
      : null

  let resetAt: string | null = null
  if (typeof primary?.reset_at === 'number') {
    resetAt = new Date(primary.reset_at * 1000).toISOString()
  } else if (typeof primary?.reset_after_seconds === 'number') {
    resetAt = new Date(
      Date.now() + primary.reset_after_seconds * 1000
    ).toISOString()
  }

  const plan = resolvePlan(opts.settings, 'codex', planType, 'api')
  const windows = [
    mapWindow(primary, 'Primary'),
    mapWindow(secondary, 'Secondary')
  ].filter((window): window is NonNullable<QuotaSnapshot['windows']>[number] => window != null)

  const remainingTextParts: string[] = []
  if (opts.resetCreditsAvailable) {
    remainingTextParts.push('reset credits available')
  }

  return {
    provider: 'codex',
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    used_pct: used,
    remaining_pct: used != null ? clampPct(100 - used) : null,
    reset_at: resetAt,
    window_label: windowLabelFromSeconds(windowSeconds) ?? 'Weekly',
    plan_label: plan.plan_label,
    plan_source: plan.plan_source,
    confidence: used != null ? 'live' : 'estimate',
    source: opts.source ?? 'chatgpt.com/backend-api/wham/usage',
    auth_connected: opts.authConnected,
    stale: false,
    live_captured_at:
      used != null ? (opts.capturedAt ?? new Date().toISOString()) : null,
    windows: windows.length ? windows : undefined,
    remaining_text: remainingTextParts.length
      ? remainingTextParts.join(' · ')
      : undefined
  }
}

function mapWindow(
  window: Record<string, unknown> | null,
  fallbackLabel: string
): NonNullable<QuotaSnapshot['windows']>[number] | null {
  if (!window) return null
  const usedRaw = window.used_percent
  const used =
    typeof usedRaw === 'number' && Number.isFinite(usedRaw)
      ? clampPct(usedRaw)
      : null
  const seconds =
    typeof window.limit_window_seconds === 'number'
      ? window.limit_window_seconds
      : null
  let reset: string | null = null
  if (typeof window.reset_at === 'number') {
    reset = new Date(window.reset_at * 1000).toISOString()
  } else if (typeof window.reset_after_seconds === 'number') {
    reset = new Date(Date.now() + window.reset_after_seconds * 1000).toISOString()
  }
  if (used == null && seconds == null && reset == null) return null
  return {
    label: windowLabelFromSeconds(seconds) ?? fallbackLabel,
    used_pct: used,
    remaining_pct: used == null ? null : clampPct(100 - used),
    reset_at: reset
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
