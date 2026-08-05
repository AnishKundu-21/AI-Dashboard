import type { ProviderAdapter, AdapterContext, CollectResult } from '../base'
import { disconnectedSnapshot, estimateSnapshot } from '../base'
import { fetchJson, HttpError } from '../http'
import { getClaudeHome } from '../../util/paths'
import { readClaudeAuth, isClaudeTokenExpired } from './auth'
import { mapClaudeUsage } from './mapUsage'
import { collectClaudeSessions } from './sessions'
import { resolvePlan } from '../plan'
import type { QuotaSnapshot } from '../../../shared/types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

export const claudeAdapter: ProviderAdapter = {
  id: 'claude',

  async isConnected(): Promise<boolean> {
    return readClaudeAuth(getClaudeHome()) != null
  },

  async refreshQuota(ctx: AdapterContext): Promise<QuotaSnapshot> {
    const auth = readClaudeAuth(getClaudeHome())
    if (!auth) {
      return disconnectedSnapshot(
        'claude',
        'no ~/.claude credentials — install Claude Code and login'
      )
    }

    const fallbackPlan = resolvePlan(
      ctx.settings,
      'claude',
      auth.subscription_type,
      'auth'
    )

    if (!ctx.networkQuotaRefresh) {
      return estimateSnapshot('claude', 'network quota refresh disabled', {
        plan_label: fallbackPlan.plan_label,
        plan_source: fallbackPlan.plan_source
      })
    }

    // Prefer re-read if expired — CLI may have refreshed disk token
    let token = auth.token
    if (isClaudeTokenExpired(auth)) {
      const again = readClaudeAuth(getClaudeHome())
      if (again && !isClaudeTokenExpired(again)) {
        token = again.token
      }
    }

    try {
      const body = await fetchJson(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      return mapClaudeUsage(body, {
        settings: ctx.settings,
        authConnected: true,
        subscriptionType: auth.subscription_type
      })
    } catch (err) {
      const status = err instanceof HttpError ? err.status : null
      return estimateSnapshot(
        'claude',
        status
          ? `oauth/usage HTTP ${status} — estimate fallback`
          : `usage failed — ${err instanceof Error ? err.message : 'error'}`,
        {
          plan_label: fallbackPlan.plan_label,
          plan_source: fallbackPlan.plan_source
        }
      )
    }
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    const sessions = collectClaudeSessions(getClaudeHome())
    return { sessions, upserted: sessions.length }
  }
}
