import type { ProviderAdapter, AdapterContext, CollectResult } from '../base'
import { disconnectedSnapshot } from '../base'
import { getOpenCodeHome } from '../../util/paths'
import { collectOpenCodeSessions } from './sessions'
import type { QuotaSnapshot } from '../../../shared/types'
import { existsSync } from 'fs'

export const openCodeAdapter: ProviderAdapter = {
  id: 'opencode',

  async isConnected(): Promise<boolean> {
    return existsSync(`${getOpenCodeHome()}/opencode.db`)
  },

  /**
   * OpenCode has no subscription quota to report: it runs against the user's
   * own provider keys and bills per call. That is a fact about the product,
   * not a failed probe, so it is reported as `unsupported` rather than left
   * showing a perpetual "unknown".
   */
  async refreshQuota(_ctx: AdapterContext): Promise<QuotaSnapshot> {
    const connected = existsSync(`${getOpenCodeHome()}/opencode.db`)
    if (!connected) {
      return {
        ...disconnectedSnapshot('opencode', 'no OpenCode store found'),
        transport: 'none',
        unavailable: { reason: 'not_connected' }
      }
    }
    return {
      ...disconnectedSnapshot(
        'opencode',
        'OpenCode bills per call through your own provider keys'
      ),
      auth_connected: true,
      transport: 'local',
      unavailable: {
        reason: 'unsupported',
        message: 'OpenCode has no subscription quota; see cost instead.'
      }
    }
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    const collected = collectOpenCodeSessions(getOpenCodeHome())
    return { ...collected, upserted: collected.sessions.length }
  }
}
