/**
 * Opt-in verification harness: `npm run verify:real`.
 *
 * Runs the collectors against this machine's actual CLI directories and prints
 * what they produce. Deliberately outside `src/`, so it is excluded from
 * `npm test` — it needs real transcripts and fetches the live rate table, and
 * its output depends on whoever runs it.
 *
 * Worth running after any collector or pricing change. It is what surfaced
 * Claude Code's `<synthetic>` placeholder records, which fixtures did not
 * contain.
 */
import { describe, expect, it } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'
import { existsSync } from 'fs'
import { collectClaudeSessions } from '../src/main/collectors/claude/sessions'
import { collectCodexSessions } from '../src/main/collectors/codex/sessions'
import { collectGrokSessions } from '../src/main/collectors/grok/sessions'
import { collectOpenCodeSessions } from '../src/main/collectors/opencode/sessions'
import { collectCursorSessions } from '../src/main/collectors/cursor/sessions'
import { primeRateTable, rateForModel, resetPricingForTests } from '../src/main/pricing/store'
import { RATES_URL } from '../src/main/pricing/store'
import type { ScanCache } from '../src/main/collectors/scanCache'
import { makeDayFormatter } from '../src/main/util/time'
import type { SessionRow, UsageEvent } from '../src/shared/types'

const RATES_TIMEOUT_MS = 30_000

function fmtUsd(value: number | null): string {
  return value == null ? 'unpriced' : `$${value.toFixed(4)}`
}

function fmtTokens(value: number | null): string {
  if (value == null) return '—'
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return String(value)
}

function summarise(label: string, rows: SessionRow[]): void {
  const total = (pick: (row: SessionRow) => number | null | undefined): number =>
    rows.reduce((sum, row) => sum + (pick(row) ?? 0), 0)

  const cost = total((row) => row.api_equiv_usd)
  const unpricedRows = rows.filter((row) => row.unpriced)
  const models = new Map<string, number>()
  for (const row of rows) {
    models.set(row.model, (models.get(row.model) ?? 0) + (row.tokens_total ?? 0))
  }

  console.log(`\n=== ${label} ===`)
  console.log(`sessions            ${rows.length}`)
  console.log(`tokens_total        ${fmtTokens(total((r) => r.tokens_total))}`)
  console.log(`  uncached input    ${fmtTokens(total((r) => r.tokens?.uncached_input))}`)
  console.log(`  cache read        ${fmtTokens(total((r) => r.tokens?.cached_input))}`)
  console.log(`  cache write       ${fmtTokens(total((r) => r.tokens?.cache_creation))}`)
  console.log(`  output            ${fmtTokens(total((r) => r.tokens?.output))}`)
  console.log(`  reasoning (of out) ${fmtTokens(total((r) => r.tokens?.reasoning))}`)
  console.log(`api-equiv cost      ${fmtUsd(cost)}`)
  console.log(`cache savings       ${fmtUsd(total((r) => r.cache_savings_usd))}`)
  console.log(
    `provider-reported   ${fmtUsd(total((r) => r.provider_cost_usd))} (where reported)`
  )
  console.log(`unpriced sessions   ${unpricedRows.length}`)
  if (unpricedRows.length > 0) {
    const names = [...new Set(unpricedRows.map((row) => row.model))]
    console.log(`  models missing a rate: ${names.join(', ')}`)
  }
  console.log('top models by tokens:')
  for (const [model, tokens] of [...models].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
    const rate = rateForModel(model)
    console.log(
      `  ${model.padEnd(34)} ${fmtTokens(tokens).padStart(8)}  ${
        rate ? `in $${(rate.input_cost_per_token * 1e6).toFixed(2)}/M` : 'NO RATE'
      }`
    )
  }

  const dated = rows.filter((row) => row.started_at).map((row) => row.started_at!)
  if (dated.length > 0) {
    console.log(
      `date range          ${dated.sort()[0]!.slice(0, 10)} .. ${dated.at(-1)!.slice(0, 10)}`
    )
  }
}

describe('real-data verification', () => {
  it(
    'collects this machine',
    async () => {
      resetPricingForTests()
      const response = await fetch(RATES_URL)
      const document = await response.json()
      primeRateTable(document)
      console.log(
        `\nrate table: ${Object.keys(document as object).length} raw entries from LiteLLM`
      )

      const homes = {
        claude: join(homedir(), '.claude'),
        codex: join(homedir(), '.codex'),
        grok: join(homedir(), '.grok'),
        cursor: join(homedir(), '.cursor'),
        opencode: join(homedir(), '.local', 'share', 'opencode')
      }

      const cache: ScanCache = new Map()
      const all: SessionRow[] = []
      const allEvents: UsageEvent[] = []

      if (existsSync(homes.claude)) {
        const t0 = Date.now()
        const collected = collectClaudeSessions(homes.claude, cache)
        const rows = collected.sessions
        allEvents.push(...collected.events)
        console.log(`\nclaude cold scan: ${Date.now() - t0}ms, ${cache.size} files cached`)
        summarise('CLAUDE', rows)
        all.push(...rows)

        const t1 = Date.now()
        const again = collectClaudeSessions(homes.claude, cache).sessions
        console.log(`claude warm scan: ${Date.now() - t1}ms`)
        expect(again.length).toBe(rows.length)

        // What the pre-Phase-A collector would have reported for the same data.
        const oldTotal = rows.reduce(
          (sum, row) =>
            sum + (row.tokens?.uncached_input ?? 0) + (row.tokens?.output ?? 0),
          0
        )
        const newTotal = rows.reduce((sum, row) => sum + (row.tokens_total ?? 0), 0)
        console.log(
          `\nclaude tokens_total before Phase A: ${fmtTokens(oldTotal)} ` +
            `-> now ${fmtTokens(newTotal)} (${(newTotal / Math.max(1, oldTotal)).toFixed(1)}x)`
        )
      }

      if (existsSync(homes.codex)) {
        const t0 = Date.now()
        const collected = collectCodexSessions(homes.codex, cache)
        const rows = collected.sessions
        allEvents.push(...collected.events)
        console.log(`\ncodex cold scan: ${Date.now() - t0}ms`)
        summarise('CODEX', rows)
        all.push(...rows)
      }

      if (existsSync(homes.grok)) {
        const t0 = Date.now()
        const collected = collectGrokSessions(homes.grok, cache)
        const rows = collected.sessions
        allEvents.push(...collected.events)
        console.log(`\ngrok cold scan: ${Date.now() - t0}ms`)
        summarise('GROK', rows)
        all.push(...rows)
      }

      if (existsSync(homes.cursor)) {
        const t0 = Date.now()
        const collected = collectCursorSessions(homes.cursor, cache)
        console.log(`\ncursor cold scan: ${Date.now() - t0}ms`)
        summarise('CURSOR', collected.sessions)
        all.push(...collected.sessions)
        allEvents.push(...collected.events)
      }

      if (existsSync(homes.opencode)) {
        const t0 = Date.now()
        const collected = collectOpenCodeSessions(homes.opencode)
        console.log(`
opencode scan: ${Date.now() - t0}ms`)
        summarise('OPENCODE', collected.sessions)
        all.push(...collected.sessions)
        allEvents.push(...collected.events)
      }

      summarise('ALL PROVIDERS', all)

      // Event grain: the point of persisting these is that a session spanning
      // midnight, or switching models, attributes to each part correctly.
      const dayOf = makeDayFormatter('system')
      const days = new Set(allEvents.map((e) => dayOf(e.ts_ms)))
      const multiDay = new Map<string, Set<string>>()
      const multiModel = new Map<string, Set<string>>()
      for (const e of allEvents) {
        const key = `${e.provider}:${e.session_id}`
        if (!multiDay.has(key)) multiDay.set(key, new Set())
        multiDay.get(key)!.add(dayOf(e.ts_ms))
        if (!multiModel.has(key)) multiModel.set(key, new Set())
        multiModel.get(key)!.add(e.model)
      }
      console.log(`
=== EVENTS ===`)
      console.log(`events              ${allEvents.length}`)
      console.log(`distinct days       ${days.size}`)
      console.log(
        `sessions spanning >1 day    ${[...multiDay.values()].filter((d) => d.size > 1).length}`
      )
      console.log(
        `sessions using >1 model     ${[...multiModel.values()].filter((m) => m.size > 1).length}`
      )
      expect(new Set(allEvents.map((e) => e.dedupe_key)).size).toBe(allEvents.length)

      // Invariants that must hold on real data, not just fixtures.
      for (const row of all) {
        if (!row.tokens) continue
        const sum =
          row.tokens.uncached_input +
          row.tokens.cached_input +
          row.tokens.cache_creation +
          row.tokens.output
        expect(row.tokens_total, `${row.id} total matches its parts`).toBe(sum)
        expect(
          row.tokens.reasoning,
          `${row.id} reasoning is a subset of output`
        ).toBeLessThanOrEqual(row.tokens.output)
        if (row.api_equiv_usd != null) {
          expect(row.api_equiv_usd, `${row.id} cost is not negative`).toBeGreaterThanOrEqual(0)
        }
      }
      expect(new Set(all.map((row) => row.id)).size, 'ids are unique').toBe(all.length)

      resetPricingForTests()
    },
    RATES_TIMEOUT_MS + 60_000
  )
})
