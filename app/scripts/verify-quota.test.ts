/**
 * Opt-in quota probe: `npm run verify:real`.
 *
 * Exercises the real quota transports against this machine's logged-in CLIs.
 * Excluded from `npm test` for the same reason as the usage harness: it needs
 * real credentials and reaches the network.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { readRateLimits, stopAppServer } from '../src/main/collectors/codex/appServer'
import { mapCodexRateLimits } from '../src/main/collectors/codex/mapRateLimits'
import {
  describeClaudeAuthProblem,
  readClaudeAuthResult
} from '../src/main/collectors/claude/auth'
import { AppSettingsSchema } from '../src/shared/types'
import { homedir } from 'os'
import { join } from 'path'

const settings = AppSettingsSchema.parse({})

afterAll(() => {
  stopAppServer()
})

describe('codex app-server', () => {
  it(
    'answers account/rateLimits/read and maps to a live snapshot',
    async () => {
      const body = await readRateLimits()
      const snapshot = mapCodexRateLimits(body, { settings })

      console.log('\n=== CODEX QUOTA (app-server) ===')
      console.log(`transport      ${snapshot.transport}`)
      console.log(`confidence     ${snapshot.confidence}`)
      console.log(`plan           ${snapshot.plan_label} (${snapshot.plan_source})`)
      for (const window of snapshot.quota_windows ?? []) {
        console.log(
          `  ${window.label.padEnd(9)} ${String(window.used_pct).padStart(3)}% used · ` +
            `${window.window_duration_mins}min window · resets ${window.resets_at}`
        )
      }
      if (snapshot.reset_credits) {
        console.log(
          `reset credits  ${snapshot.reset_credits.available_count} available` +
            (snapshot.reset_credits.title ? ` — ${snapshot.reset_credits.title}` : '')
        )
      }
      if (snapshot.unavailable) {
        console.log(`unavailable    ${snapshot.unavailable.reason}`)
      }

      expect(snapshot.provider).toBe('codex')
      expect(snapshot.auth_connected).toBe(true)
      // Either it reported windows, or it said plainly why it could not.
      expect(
        (snapshot.quota_windows?.length ?? 0) > 0 || snapshot.unavailable != null
      ).toBe(true)
      // Nothing token-shaped may reach a stored snapshot.
      expect(JSON.stringify(snapshot)).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    },
    90_000
  )
})

describe('claude credentials', () => {
  it('reports a specific diagnosis rather than a generic one', () => {
    const result = readClaudeAuthResult(join(homedir(), '.claude'))
    console.log('\n=== CLAUDE AUTH ===')
    if (result.ok) {
      console.log(`readable       yes (shape: ${result.auth.shape})`)
      console.log(`subscription   ${result.auth.subscription_type ?? 'not reported'}`)
      console.log(
        `expires        ${
          result.auth.expires_at
            ? new Date(result.auth.expires_at).toISOString()
            : 'not reported'
        }`
      )
      expect(result.auth.token.length).toBeGreaterThan(20)
    } else {
      console.log(`readable       no`)
      console.log(`diagnosis      ${describeClaudeAuthProblem(result.problem)}`)
      expect(result.problem.reason).toBeTruthy()
    }
  })
})
