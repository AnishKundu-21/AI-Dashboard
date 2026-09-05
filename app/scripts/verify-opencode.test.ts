/**
 * Opt-in: proves the OpenCode parser against this machine's real store.
 *
 * Reads with Node's built-in SQLite rather than the collector's
 * `better-sqlite3`, which is compiled for Electron's ABI and cannot load here.
 * The parser and the aggregation under test are the real ones.
 */
import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parseOpenCodeMessage } from '../src/main/collectors/opencode/parse'
import { collectUsage, type SessionFacts } from '../src/main/collectors/aggregate'
import { totalTokens } from '../src/shared/tokens'
import { primeRateTable, resetPricingForTests, RATES_URL } from '../src/main/pricing/store'
import type { UsageEvent } from '../src/shared/types'

const home = join(homedir(), '.local', 'share', 'opencode')

describe('opencode real store', () => {
  it('parses real messages into priced events', async () => {
    const dbPath = join(home, 'opencode.db')
    if (!existsSync(dbPath)) {
      console.log('OpenCode not installed on this machine; skipping.')
      return
    }
    resetPricingForTests()
    primeRateTable(await (await fetch(RATES_URL)).json())

    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare('SELECT id, session_id, data FROM message').all() as Array<{
      id: string
      session_id: string
      data: string
    }>

    const events: UsageEvent[] = []
    const cwdBySession = new Map<string, string>()
    for (const row of rows) {
      const parsed = parseOpenCodeMessage(row)
      if (!parsed.event) continue
      events.push(parsed.event)
      if (parsed.cwd && !cwdBySession.has(row.session_id)) {
        cwdBySession.set(row.session_id, parsed.cwd)
      }
    }

    const facts: SessionFacts[] = [...new Set(events.map((e) => e.session_id))].map(
      (id) => ({
        id: `opencode:${id}`,
        provider: 'opencode',
        project: 'demo',
        status: 'unknown' as const,
        started_at: null,
        ended_at: null,
        duration_ms: null,
        source: 'opencode:sqlite'
      })
    )
    const collected = collectUsage(events, facts)

    console.log('\n=== OPENCODE (real store) ===')
    console.log(`message rows        ${rows.length}`)
    console.log(`usage events        ${events.length}`)
    console.log(`sessions            ${collected.sessions.length}`)
    const tokens = events.reduce((sum, e) => sum + totalTokens(e.tokens), 0)
    console.log(`tokens              ${(tokens / 1e6).toFixed(2)}M`)
    const reported = events.reduce((s, e) => s + (e.reported_cost_usd ?? 0), 0)
    const equiv = collected.sessions.reduce((s, r) => s + (r.api_equiv_usd ?? 0), 0)
    console.log(`opencode reported   $${reported.toFixed(4)}`)
    console.log(`our api-equivalent  $${equiv.toFixed(4)}`)
    console.log(`models              ${[...new Set(events.map((e) => e.model))].join(', ')}`)
    console.log(
      `unpriced sessions   ${collected.sessions.filter((s) => s.unpriced).length}`
    )
    db.close()
    resetPricingForTests()

    expect(events.length).toBeGreaterThan(0)
    // Our independent pricing should land near what OpenCode actually paid.
    if (reported > 0 && equiv > 0) {
      expect(equiv).toBeGreaterThan(reported * 0.2)
      expect(equiv).toBeLessThan(reported * 5)
    }
  }, 120_000)
})
