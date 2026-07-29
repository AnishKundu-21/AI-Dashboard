import type { AppSettings, QuotaSnapshot } from '../../../shared/types'
import { periodTypeLabel, resolvePlan } from '../plan'

/** Pure mapper: Grok cli-chat-proxy billing → QuotaSnapshot */
export function mapGrokBilling(
  body: unknown,
  opts: {
    settings: AppSettings
    authConnected: boolean
    capturedAt?: string
    source?: string
  }
): QuotaSnapshot {
  const root = asRecord(body) ?? {}
  const config = asRecord(root.config) ?? root

  const usedRaw = config.creditUsagePercent
  const used =
    typeof usedRaw === 'number' && Number.isFinite(usedRaw)
      ? clampPct(usedRaw)
      : null

  const period = asRecord(config.currentPeriod)
  const periodType =
    typeof period?.type === 'string' ? period.type : null
  const resetAt =
    typeof period?.end === 'string'
      ? period.end
      : typeof config.billingPeriodEnd === 'string'
        ? config.billingPeriodEnd
        : null

  const products: Record<string, number> = {}
  const productUsage = config.productUsage
  if (Array.isArray(productUsage)) {
    for (const item of productUsage) {
      const row = asRecord(item)
      if (!row) continue
      const name = typeof row.product === 'string' ? row.product : null
      const pct =
        typeof row.usagePercent === 'number' ? row.usagePercent : null
      if (name && pct != null) products[name] = clampPct(pct)
    }
  }

  // Grok billing body typically does not include plan tier
  const plan = resolvePlan(opts.settings, 'grok', null, 'unknown')

  return {
    provider: 'grok',
    captured_at: opts.capturedAt ?? new Date().toISOString(),
    used_pct: used,
    remaining_pct: used != null ? clampPct(100 - used) : null,
    reset_at: resetAt,
    window_label: periodTypeLabel(periodType) ?? 'Weekly',
    plan_label: plan.plan_label,
    plan_source: plan.plan_source,
    confidence: used != null ? 'live' : 'estimate',
    source: opts.source ?? 'cli-chat-proxy.grok.com/v1/billing',
    auth_connected: opts.authConnected,
    stale: false,
    live_captured_at:
      used != null ? (opts.capturedAt ?? new Date().toISOString()) : null,
    windows: [
      {
        label: periodTypeLabel(periodType) ?? 'Weekly',
        used_pct: used,
        remaining_pct: used != null ? clampPct(100 - used) : null,
        reset_at: resetAt
      }
    ],
    products: Object.keys(products).length > 0 ? products : undefined
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
