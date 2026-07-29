import { existsSync } from 'fs'
import { join } from 'path'
import type { ProviderAdapter, AdapterContext, CollectResult } from '../base'
import { disconnectedSnapshot, estimateSnapshot } from '../base'
import { getClaudeHome } from '../../util/paths'
import type { QuotaSnapshot } from '../../../shared/types'
import { resolvePlan } from '../plan'

/**
 * Claude Code adapter — best-effort.
 * Live usage endpoints vary; when credentials exist we report connected
 * with estimate until a stable usage surface is confirmed on a logged-in machine.
 */
export const claudeAdapter: ProviderAdapter = {
  id: 'claude',

  async isConnected(): Promise<boolean> {
    return claudeCredentialsPresent()
  },

  async refreshQuota(ctx: AdapterContext): Promise<QuotaSnapshot> {
    if (!claudeCredentialsPresent()) {
      return disconnectedSnapshot(
        'claude',
        'no ~/.claude credentials — install Claude Code and login'
      )
    }

    const plan = resolvePlan(ctx.settings, 'claude', null, 'unknown')

    // Credentials present but no validated live usage API on this machine yet
    return estimateSnapshot(
      'claude',
      'credentials found · live usage API not yet mapped',
      {
        plan_label: plan.plan_label,
        plan_source: plan.plan_source,
        window_label: null
      }
    )
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    // Session store layout TBD after first logged-in machine
    return { sessions: [], upserted: 0 }
  }
}

function claudeCredentialsPresent(home = getClaudeHome()): boolean {
  const candidates = [
    join(home, '.credentials.json'),
    join(home, 'credentials.json'),
    join(home, '.claude.json')
  ]
  return candidates.some((p) => existsSync(p))
}
