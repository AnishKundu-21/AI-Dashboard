import type { AppSettings, PlanSource, ProviderId } from '../../shared/types'

export interface ResolvedPlan {
  plan_label: string | null
  plan_source: PlanSource
}

/**
 * Plan resolution order (locked product decision):
 * 1. User manual override
 * 2. Detected from API/auth
 * 3. Unknown
 */
export function resolvePlan(
  settings: AppSettings,
  provider: ProviderId,
  detected: string | null | undefined,
  detectedSource: PlanSource = 'api'
): ResolvedPlan {
  const cfg = settings.plans?.[provider]
  if (cfg?.mode === 'manual' && cfg.value) {
    return { plan_label: cfg.value, plan_source: 'user' }
  }
  if (detected) {
    return { plan_label: detected, plan_source: detectedSource }
  }
  if (cfg?.detected) {
    return { plan_label: cfg.detected, plan_source: cfg.source ?? 'api' }
  }
  return { plan_label: null, plan_source: 'unknown' }
}

export function windowLabelFromSeconds(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null
  // 604800 = 7 days
  if (seconds >= 6 * 24 * 3600) return 'Weekly'
  if (seconds >= 20 * 3600) return 'Daily'
  if (seconds >= 4 * 3600) return '5h'
  if (seconds >= 45 * 60) return '1h'
  return `${Math.round(seconds / 60)}m`
}

export function periodTypeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  const t = type.toUpperCase()
  if (t.includes('WEEK')) return 'Weekly'
  if (t.includes('DAY') || t.includes('DAILY')) return 'Daily'
  if (t.includes('MONTH')) return 'Monthly'
  if (t.includes('HOUR')) return 'Hourly'
  return type
}
