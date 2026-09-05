/**
 * End-to-end collector tests: real directory layouts on disk, through the
 * parsers, scan cache, de-duplication and pricing, out to session rows.
 *
 * These replace the old per-provider `sessions.test.ts` suites, which asserted
 * the pre-Phase-A numbers (Claude totals that excluded cached tokens, Grok
 * usage summed off every update line, a blended rate card).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { collectClaudeSessions } from './claude/sessions'
import { collectCodexSessions } from './codex/sessions'
import { collectGrokSessions } from './grok/sessions'
import { primeRateTable, resetPricingForTests } from '../pricing/store'
import type { ScanCache } from './scanCache'

const RATES = {
  'claude-sonnet-4-5-20250929': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_read_input_token_cost: 3e-7,
    cache_creation_input_token_cost: 3.75e-6
  },
  'gpt-5-codex': {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5
  },
  'grok-4': { input_cost_per_token: 3e-6, output_cost_per_token: 1.5e-5 }
}

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'))
  dirs.push(dir)
  return dir
}

function writeLines(path: string, lines: unknown[]): void {
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

beforeEach(() => {
  resetPricingForTests()
  primeRateTable(RATES)
})

afterEach(() => {
  resetPricingForTests()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('collectClaudeSessions', () => {
  function writeTranscript(home: string, name: string, lines: unknown[]): void {
    const dir = join(home, 'projects', 'C--Projects-UsefulApp')
    mkdirSync(dir, { recursive: true })
    writeLines(join(dir, name), lines)
  }

  function assistant(messageId: string, requestId: string): unknown {
    return {
      type: 'assistant',
      sessionId: 'session-7',
      cwd: 'C:\\Projects\\UsefulApp',
      timestamp: '2026-07-29T10:00:00Z',
      requestId,
      message: {
        id: messageId,
        model: 'claude-sonnet-4-5-20250929',
        content: 'private response',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 10
        }
      }
    }
  }

  it('counts cached tokens in the total and prices each class separately', () => {
    const home = tempHome()
    writeTranscript(home, 'a.jsonl', [
      assistant('msg-1', 'req-1'),
      {
        type: 'result',
        sessionId: 'session-7',
        timestamp: '2026-07-29T10:00:02Z',
        duration_ms: 2000,
        total_cost_usd: 0.012,
        is_error: false
      }
    ])

    const [row] = collectClaudeSessions(home)
    expect(row).toEqual(
      expect.objectContaining({
        id: 'claude:session-7',
        project: 'UsefulApp',
        model: 'claude-sonnet-4-5-20250929',
        tokens_in: 100,
        tokens_out: 20,
        tokens_cached: 40,
        // 100 + 30 + 10 + 20. The old collector reported 120 here, dropping
        // the cached tokens the user was actually billed for.
        tokens_total: 160,
        provider_cost_usd: 0.012,
        duration_ms: 2000,
        status: 'complete',
        unpriced: false
      })
    )
    // 100*3e-6 + 30*3e-7 + 10*3.75e-6 + 20*1.5e-5 = 0.0006465, rounded once
    // at the row. Events themselves are summed unrounded.
    expect(row.api_equiv_usd).toBe(0.000647)
    expect(row.cache_savings_usd).toBeCloseTo(30 * 2.7e-6, 9)
  })

  it('never lets prompt or response text reach a row', () => {
    const home = tempHome()
    writeTranscript(home, 'a.jsonl', [assistant('msg-1', 'req-1')])
    expect(JSON.stringify(collectClaudeSessions(home))).not.toContain(
      'private response'
    )
  })

  it('counts a message replayed into a second transcript once', () => {
    const home = tempHome()
    // A resumed session: the same message lands in both files.
    writeTranscript(home, 'a.jsonl', [assistant('msg-1', 'req-1')])
    writeTranscript(home, 'b.jsonl', [
      assistant('msg-1', 'req-1'),
      assistant('msg-2', 'req-2')
    ])

    const rows = collectClaudeSessions(home)
    expect(rows).toHaveLength(1)
    expect(rows[0].tokens_total).toBe(320)
  })

  it('reports an unknown model as unpriced instead of guessing a rate', () => {
    const home = tempHome()
    writeTranscript(home, 'a.jsonl', [
      {
        type: 'assistant',
        sessionId: 'session-x',
        cwd: 'C:\\Projects\\UsefulApp',
        timestamp: '2026-07-29T10:00:00Z',
        requestId: 'req-1',
        message: {
          id: 'msg-1',
          model: 'claude-something-unreleased',
          usage: { input_tokens: 100, output_tokens: 20 }
        }
      }
    ])

    const [row] = collectClaudeSessions(home)
    expect(row.unpriced).toBe(true)
    expect(row.api_equiv_usd).toBeNull()
    expect(row.tokens_total).toBe(120)
  })

  it('returns nothing when the CLI is not installed', () => {
    expect(collectClaudeSessions(tempHome())).toEqual([])
  })

  it('reuses the scan cache across calls', () => {
    const home = tempHome()
    writeTranscript(home, 'a.jsonl', [assistant('msg-1', 'req-1')])
    const cache: ScanCache = new Map()

    const first = collectClaudeSessions(home, cache)
    const second = collectClaudeSessions(home, cache)
    expect(cache.size).toBe(1)
    expect(second).toEqual(first)
  })
})

describe('collectCodexSessions', () => {
  function writeRollout(home: string, name: string, lines: unknown[]): void {
    const dir = join(home, 'sessions', '2026', '07', '29')
    mkdirSync(dir, { recursive: true })
    writeLines(join(dir, name), lines)
  }

  it('sums per-turn deltas and splits the inclusive input figure', () => {
    const home = tempHome()
    writeRollout(home, 'rollout-1.jsonl', [
      {
        type: 'session_meta',
        timestamp: '2026-07-29T09:00:00Z',
        payload: { id: 'codex-1', cwd: 'C:\\Projects\\UsefulApp' }
      },
      { type: 'turn_context', timestamp: '2026-07-29T09:00:01Z', payload: { model: 'gpt-5-codex' } },
      {
        type: 'event_msg',
        timestamp: '2026-07-29T09:00:05Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 800,
              output_tokens: 40
            },
            total_token_usage: { input_tokens: 1_000, output_tokens: 40 }
          }
        }
      },
      {
        type: 'event_msg',
        timestamp: '2026-07-29T09:01:00Z',
        payload: { type: 'task_complete', duration_ms: 60_000 }
      }
    ])

    const [row] = collectCodexSessions(home)
    expect(row).toEqual(
      expect.objectContaining({
        id: 'codex:codex-1',
        project: 'UsefulApp',
        model: 'gpt-5-codex',
        tokens_in: 200,
        tokens_cached: 800,
        tokens_out: 40,
        tokens_total: 1_040,
        status: 'complete'
      })
    )
  })

  it('does not count a fork twice', () => {
    const home = tempHome()
    const parentTurn = {
      type: 'event_msg',
      timestamp: '2026-07-29T09:00:05Z',
      payload: {
        type: 'token_count',
        info: { last_token_usage: { input_tokens: 1_000, output_tokens: 100 } }
      }
    }
    writeRollout(home, 'parent.jsonl', [
      {
        type: 'session_meta',
        timestamp: '2026-07-29T09:00:00Z',
        payload: { id: 'parent-1', cwd: 'C:\\Projects\\UsefulApp' }
      },
      { type: 'turn_context', timestamp: '2026-07-29T09:00:01Z', payload: { model: 'gpt-5-codex' } },
      parentTurn
    ])
    writeRollout(home, 'fork.jsonl', [
      {
        type: 'session_meta',
        timestamp: '2026-07-29T10:00:00Z',
        payload: {
          id: 'fork-1',
          cwd: 'C:\\Projects\\UsefulApp',
          forked_from_id: 'parent-1'
        }
      },
      { type: 'turn_context', timestamp: '2026-07-29T10:00:00Z', payload: { model: 'gpt-5-codex' } },
      // The copied parent history, re-stamped to the fork instant.
      {
        ...parentTurn,
        timestamp: '2026-07-29T10:00:00.020Z'
      },
      // The fork's own work.
      {
        type: 'event_msg',
        timestamp: '2026-07-29T10:00:12Z',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 500, output_tokens: 50 } }
        }
      }
    ])

    const rows = collectCodexSessions(home)
    const total = rows.reduce((sum, row) => sum + (row.tokens_total ?? 0), 0)
    // 1100 from the parent plus 550 from the fork; the copied burst is dropped.
    expect(total).toBe(1_650)
  })
})

describe('collectGrokSessions', () => {
  function writeSession(home: string, id: string, lines: unknown[]): void {
    const dir = join(home, 'sessions', 'UsefulApp', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'summary.json'),
      JSON.stringify({
        info: { id, cwd: 'C:\\Projects\\UsefulApp' },
        created_at: '2026-07-29T08:00:00Z',
        last_active_at: '2026-07-29T08:30:00Z'
      })
    )
    writeLines(join(dir, 'updates.jsonl'), lines)
  }

  function turn(promptId: string, usage: unknown, kind = 'turn_completed'): unknown {
    return {
      timestamp: 1_785_000_000,
      params: {
        sessionId: 'grok-1',
        _meta: { agentTimestampMs: 1_785_000_000_000 },
        update: { sessionUpdate: kind, prompt_id: promptId, usage }
      }
    }
  }

  it('counts only completed turns, not the interim updates before them', () => {
    const home = tempHome()
    writeSession(home, 'grok-1', [
      // Interim updates carrying running usage: previously summed on top of
      // the completed turn, counting the same tokens several times.
      turn('p1', { inputTokens: 50, outputTokens: 5 }, 'agent_message_chunk'),
      turn('p1', { inputTokens: 80, outputTokens: 8 }, 'agent_message_chunk'),
      turn('p1', {
        inputTokens: 100,
        outputTokens: 10,
        modelUsage: { 'grok-4': { inputTokens: 100, outputTokens: 10 } }
      })
    ])

    const [row] = collectGrokSessions(home)
    expect(row.tokens_total).toBe(110)
    expect(row.model).toBe('grok-4')
    expect(row.project).toBe('UsefulApp')
  })

  it('prices a two-model turn at both rates', () => {
    const home = tempHome()
    writeSession(home, 'grok-1', [
      turn('p1', {
        inputTokens: 300,
        outputTokens: 30,
        modelUsage: {
          'grok-4': { inputTokens: 200, outputTokens: 20 },
          'grok-unreleased': { inputTokens: 100, outputTokens: 10 }
        }
      })
    ])

    const [row] = collectGrokSessions(home)
    expect(row.tokens_total).toBe(330)
    // The known half is priced; the unknown half flags the row as a floor.
    expect(row.api_equiv_usd).toBeCloseTo(200 * 3e-6 + 20 * 1.5e-5, 9)
    expect(row.unpriced).toBe(true)
  })

  it('skips a session whose log carries no completed turn', () => {
    const home = tempHome()
    writeSession(home, 'grok-1', [
      turn('p1', { inputTokens: 10, outputTokens: 1 }, 'agent_message_chunk')
    ])
    expect(collectGrokSessions(home)).toEqual([])
  })
})
