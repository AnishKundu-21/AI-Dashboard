import type { ProviderId } from '../../shared/providers'
import type { AppSettings, QuotaSnapshot, SessionRow } from '../../shared/types'

export interface CollectResult {
  sessions: SessionRow[]
  upserted: number
}

export interface AdapterContext {
  /** When false, skip network quota calls and return estimate/unknown */
  networkQuotaRefresh: boolean
  settings: AppSettings
}

/**
 * Provider adapter contract.
 * Implementations must never persist prompt/response bodies.
 */
export interface ProviderAdapter {
  id: ProviderId
  isConnected(ctx: AdapterContext): Promise<boolean>
  refreshQuota(ctx: AdapterContext): Promise<QuotaSnapshot>
  collectSessions(ctx: AdapterContext): Promise<CollectResult>
}

export function disconnectedSnapshot(
  provider: ProviderId,
  source: string
): QuotaSnapshot {
  return {
    provider,
    captured_at: new Date().toISOString(),
    used_pct: null,
    remaining_pct: null,
    reset_at: null,
    window_label: null,
    plan_label: null,
    plan_source: 'unknown',
    confidence: 'unknown',
    source,
    auth_connected: false,
    stale: false,
    live_captured_at: null
  }
}

export function estimateSnapshot(
  provider: ProviderId,
  source: string,
  extras: Partial<Omit<QuotaSnapshot, 'provider' | 'captured_at' | 'confidence' | 'confidence_connected' | 'confidence'>> = {}
): QuotaSnapshot {
  return {
    provider,
    captured_at: new Date().toISOString(),
    used_pct: extras.used_pct ?? null,
    remaining_pct: extras.remaining_pct ?? null,
    reset_at: extras.reset_at ?? null,
    window_label: extras.window_label ?? null,
    plan_label: extras.plan_label ?? null,
    plan_source: extras.plan_source ?? 'unknown',
    confidence: 'estimate',
    source,
    auth_connected: true,
    stale: false,
    live_captured_at: null,
    products: extras.products,
    remaining_text: extras.remaining_text
  }
}
