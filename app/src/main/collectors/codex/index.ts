import type { ProviderAdapter, AdapterContext, CollectResult } from '../base'
import { disconnectedSnapshot, estimateSnapshot } from '../base'
import { fetchJson, HttpError } from '../http'
import { getCodexHome } from '../../util/paths'
import { readCodexAuth } from './auth'
import { mapCodexUsage } from './mapUsage'
import { collectCodexSessions } from './sessions'
import { AppServerFailure, readRateLimits } from './appServer'
import { mapCodexRateLimits } from './mapRateLimits'
import { getScanCache, markScanCacheDirty } from '../cache'
import type { QuotaSnapshot } from '../../../shared/types'

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const RESET_CREDITS_URL =
  'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'

export const codexAdapter: ProviderAdapter = {
  id: 'codex',

  async isConnected(): Promise<boolean> {
    return readCodexAuth(getCodexHome()) != null
  },

  async refreshQuota(ctx: AdapterContext): Promise<QuotaSnapshot> {
    const auth = readCodexAuth(getCodexHome())
    if (!auth) {
      return disconnectedSnapshot('codex', 'no ~/.codex/auth.json tokens')
    }

    if (!ctx.networkQuotaRefresh) {
      return estimateSnapshot('codex', 'network quota refresh disabled', {
        plan_label: ctx.settings.plans?.codex?.value ?? null,
        plan_source:
          ctx.settings.plans?.codex?.mode === 'manual' ? 'user' : 'unknown',
        transport: 'none',
        unavailable: {
          reason: 'network_disabled',
          message: 'Network quota refresh is disabled in Settings.'
        }
      })
    }

    // Codex's own local protocol first. It needs no scraped bearer token,
    // refreshes auth itself, and reports both windows with their real
    // durations plus reset-credit detail. The HTTP path below is a private,
    // undocumented endpoint kept only as a fallback for older CLIs.
    try {
      return mapCodexRateLimits(await readRateLimits(), { settings: ctx.settings })
    } catch (error) {
      if (!(error instanceof AppServerFailure)) throw error
      // Fall through to HTTP, and say so in the source line.
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.access_token}`
    }
    if (auth.account_id) {
      headers['ChatGPT-Account-Id'] = auth.account_id
    }

    try {
      const body = await fetchJson(USAGE_URL, { headers })

      let resetCreditsAvailable = false
      try {
        const creditsBody = await fetchJson(RESET_CREDITS_URL, { headers })
        resetCreditsAvailable = hasAvailableResetCredits(creditsBody, body)
      } catch {
        // optional endpoint
        resetCreditsAvailable = hasAvailableResetCredits(null, body)
      }

      const snapshot = mapCodexUsage(body, {
        settings: ctx.settings,
        authConnected: true,
        resetCreditsAvailable
      })
      return {
        ...snapshot,
        transport: 'http',
        source: `${snapshot.source} · app-server unavailable`
      }
    } catch (err) {
      const status = err instanceof HttpError ? err.status : null
      return estimateSnapshot(
        'codex',
        status
          ? `wham/usage HTTP ${status} — estimate fallback`
          : `usage failed — ${err instanceof Error ? err.message : 'error'}`,
        {
          plan_label: ctx.settings.plans?.codex?.value ?? null,
          plan_source:
            ctx.settings.plans?.codex?.mode === 'manual' ? 'user' : 'unknown',
          transport: 'http',
          unavailable: {
            reason: 'probe_failed',
            message: 'The usage endpoint did not return a live figure.'
          }
        }
      )
    }
  },

  async collectSessions(_ctx: AdapterContext): Promise<CollectResult> {
    const collected = collectCodexSessions(getCodexHome(), getScanCache())
    markScanCacheDirty()
    return { ...collected, upserted: collected.sessions.length }
  }
}

function hasAvailableResetCredits(
  creditsBody: unknown,
  usageBody: unknown
): boolean {
  const fromUsage = asRecord(usageBody)?.rate_limit_reset_credits
  const u = asRecord(fromUsage)
  if (typeof u?.available_count === 'number' && u.available_count > 0) {
    return true
  }

  const root = asRecord(creditsBody)
  if (!root) return false
  if (Array.isArray(root.credits)) {
    return root.credits.some((c) => {
      const row = asRecord(c)
      return row?.status === 'available'
    })
  }
  return false
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}
