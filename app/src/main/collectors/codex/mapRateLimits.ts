/**
 * Maps `account/rateLimits/read` onto a quota snapshot.
 *
 * The response carries more than the private HTTP endpoint ever did: both
 * windows with their real durations, the plan, reset-credit detail, and an
 * account id. Everything here is pure so the mapping is testable without
 * spawning the app server.
 */
import type { QuotaSnapshot, UsageWindow } from '../../../shared/types'
import type { AppSettings } from '../../../shared/types'
import { resolvePlan } from '../plan'

const WEEK_MINS = 7 * 24 * 60
const MONTH_MINS = 30 * 24 * 60

interface RawWindow {
  usedPercent?: number | null
  resetsAt?: number | null
  windowDurationMins?: number | null
}

interface RawSnapshot {
  planType?: string | null
  primary?: RawWindow | null
  secondary?: RawWindow | null
  limitId?: string | null
}

interface RawCredits {
  availableCount?: number
  credits?: Array<{
    status?: string
    expiresAt?: number | null
    title?: string | null
  }> | null
}

export function clampPercent(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.min(100, value))
}

function isoFromEpochSeconds(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  // App-server versions have emitted both Unix seconds and milliseconds.
  const millis = value >= 1_000_000_000_000 ? value : value * 1000
  return new Date(millis).toISOString()
}

function kindForDuration(mins: number): UsageWindow['kind'] {
  if (mins >= MONTH_MINS) return 'monthly'
  if (mins >= WEEK_MINS) return 'weekly'
  return 'session'
}

function labelForKind(kind: UsageWindow['kind']): string {
  if (kind === 'session') return 'Session'
  if (kind === 'weekly') return 'Weekly'
  return 'Monthly'
}

/**
 * `primary` and `secondary` are positions, not durations.
 *
 * Codex normally sends `windowDurationMins`; when it does not, paid plans
 * expose the 5-hour and weekly pair while Free and Go expose one monthly
 * allowance, so the fallback depends on the plan.
 */
export function codexWindows(snapshot: RawSnapshot): UsageWindow[] {
  const monthlyPlan = snapshot.planType === 'free' || snapshot.planType === 'go'
  const positions: Array<[string, RawWindow | null | undefined, number]> = [
    ['primary', snapshot.primary, monthlyPlan ? MONTH_MINS : 5 * 60],
    ['secondary', snapshot.secondary, WEEK_MINS]
  ]

  const windows: UsageWindow[] = []
  for (const [id, window, fallbackMins] of positions) {
    const used = clampPercent(window?.usedPercent)
    if (!window || used === null) continue
    const durationMins =
      typeof window.windowDurationMins === 'number' && window.windowDurationMins > 0
        ? window.windowDurationMins
        : fallbackMins
    const kind = kindForDuration(durationMins)
    windows.push({
      id,
      kind,
      label: labelForKind(kind),
      used_pct: used,
      resets_at: isoFromEpochSeconds(window.resetsAt),
      window_duration_mins: durationMins
    })
  }
  return windows
}

export function codexResetCredits(
  raw: RawCredits | null | undefined
): QuotaSnapshot['reset_credits'] {
  if (!raw || typeof raw.availableCount !== 'number') return undefined
  const available = (raw.credits ?? []).filter(
    (credit) => credit?.status === 'available'
  )
  const expiries = available
    .map((credit) => credit.expiresAt)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  return {
    available_count: Math.max(0, raw.availableCount),
    next_expires_at:
      expiries.length > 0 ? isoFromEpochSeconds(Math.min(...expiries)) : null,
    title: available[0]?.title ?? null
  }
}

export function mapCodexRateLimits(
  body: unknown,
  context: { settings: AppSettings }
): QuotaSnapshot {
  const root = (body ?? {}) as {
    rateLimits?: RawSnapshot
    rateLimitResetCredits?: RawCredits | null
  }
  const snapshot = root.rateLimits ?? {}
  const windows = codexWindows(snapshot)
  const plan = resolvePlan(context.settings, 'codex', snapshot.planType ?? null, 'api')

  const capturedAt = new Date().toISOString()

  if (windows.length === 0) {
    // The account answered but has no subscription windows — an API-key or
    // third-party-provider account. That is a fact about the account, not a
    // failed read, and must not be retried as if it were transient.
    return {
      provider: 'codex',
      captured_at: capturedAt,
      used_pct: null,
      remaining_pct: null,
      reset_at: null,
      window_label: null,
      plan_label: plan.plan_label,
      plan_source: plan.plan_source,
      confidence: 'unknown',
      source: 'codex app-server: account has no subscription windows',
      auth_connected: true,
      stale: false,
      live_captured_at: null,
      quota_windows: [],
      transport: 'app-server',
      unavailable: {
        reason: 'unsupported',
        message: 'This Codex account does not report subscription limits.'
      }
    }
  }

  // The session window is what a user watches minute to minute, so it drives
  // the headline figure; the rest stay available as secondary windows.
  const primary =
    windows.find((window) => window.kind === 'session') ?? windows[0]

  return {
    provider: 'codex',
    captured_at: capturedAt,
    used_pct: primary.used_pct,
    remaining_pct: primary.used_pct === null ? null : 100 - primary.used_pct,
    reset_at: primary.resets_at,
    window_label: primary.label,
    plan_label: plan.plan_label,
    plan_source: plan.plan_source,
    confidence: 'live',
    source: 'codex app-server account/rateLimits/read',
    auth_connected: true,
    stale: false,
    live_captured_at: capturedAt,
    quota_windows: windows,
    windows: windows.map((window) => ({
      label: window.label,
      used_pct: window.used_pct,
      remaining_pct: window.used_pct === null ? null : 100 - window.used_pct,
      reset_at: window.resets_at
    })),
    transport: 'app-server',
    reset_credits: codexResetCredits(root.rateLimitResetCredits)
  }
}
