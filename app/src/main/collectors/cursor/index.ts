import { existsSync } from 'fs'
import type { QuotaSnapshot } from '../../../shared/types'
import { getCursorHome } from '../../util/paths'
import type { AdapterContext, CollectResult, ProviderAdapter } from '../base'
import { disconnectedSnapshot } from '../base'
import { collectCursorSessions } from './sessions'
import { getScanCache, markScanCacheDirty } from '../cache'

export const cursorAdapter: ProviderAdapter = {
  id: 'cursor',

  async isConnected(): Promise<boolean> {
    return existsSync(`${getCursorHome()}/projects`)
  },

  async refreshQuota(_ctx: AdapterContext): Promise<QuotaSnapshot> {
    const connected = existsSync(`${getCursorHome()}/projects`)
    if (!connected) {
      return {
        ...disconnectedSnapshot('cursor', 'no Cursor agent transcripts found'),
        transport: 'none',
        unavailable: { reason: 'not_connected' }
      }
    }
    return {
      ...disconnectedSnapshot(
        'cursor',
        'Cursor local agent transcripts do not expose subscription quota'
      ),
      auth_connected: true,
      transport: 'local',
      unavailable: {
        reason: 'unsupported',
        message: 'Cursor CLI exposes local usage, but not subscription quota.'
      }
    }
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    const collected = collectCursorSessions(getCursorHome(), getScanCache())
    markScanCacheDirty()
    return { ...collected, upserted: collected.sessions.length }
  }
}
