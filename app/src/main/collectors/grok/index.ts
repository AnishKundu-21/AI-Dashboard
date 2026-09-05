import type { ProviderAdapter, AdapterContext, CollectResult } from '../base'
import { disconnectedSnapshot, estimateSnapshot } from '../base'
import { fetchJson, HttpError } from '../http'
import { getGrokHome } from '../../util/paths'
import { readGrokAuth, isGrokTokenExpired } from './auth'
import { mapGrokBilling } from './mapBilling'
import { collectGrokSessions } from './sessions'
import { getScanCache, markScanCacheDirty } from '../cache'
import type { QuotaSnapshot } from '../../../shared/types'

const BILLING_URL =
  'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

export const grokAdapter: ProviderAdapter = {
  id: 'grok',

  async isConnected(): Promise<boolean> {
    return readGrokAuth(getGrokHome()) != null
  },

  async refreshQuota(ctx: AdapterContext): Promise<QuotaSnapshot> {
    const auth = readGrokAuth(getGrokHome())
    if (!auth) {
      return disconnectedSnapshot('grok', 'no ~/.grok/auth.json')
    }

    if (!ctx.networkQuotaRefresh) {
      return estimateSnapshot('grok', 'network quota refresh disabled', {
        plan_label: ctx.settings.plans?.grok?.value ?? null,
        plan_source: ctx.settings.plans?.grok?.mode === 'manual' ? 'user' : 'unknown'
      })
    }

    // Prefer re-read if expired — CLI may have refreshed disk token
    let token = auth.token
    if (isGrokTokenExpired(auth)) {
      const again = readGrokAuth(getGrokHome())
      if (again && !isGrokTokenExpired(again)) {
        token = again.token
      }
    }

    try {
      const body = await fetchJson(BILLING_URL, {
        headers: { Authorization: `Bearer ${token}` }
      })
      return mapGrokBilling(body, {
        settings: ctx.settings,
        authConnected: true
      })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : null
      return estimateSnapshot(
        'grok',
        status
          ? `billing HTTP ${status} — using estimate fallback`
          : `billing failed — ${err instanceof Error ? err.message : 'error'}`,
        {
          plan_label: ctx.settings.plans?.grok?.value ?? null,
          plan_source:
            ctx.settings.plans?.grok?.mode === 'manual' ? 'user' : 'unknown'
        }
      )
    }
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    const collected = collectGrokSessions(getGrokHome(), getScanCache())
    markScanCacheDirty()
    return { ...collected, upserted: collected.sessions.length }
  }
}
