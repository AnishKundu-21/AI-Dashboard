import { describe, expect, it } from 'vitest'
import { initialCodexScanState, parseCodexLine } from './parse'
import { totalTokens } from '../../../shared/tokens'
import type { UsageEvent } from '../../../shared/types'

function line(value: unknown): string {
  return JSON.stringify(value)
}

function sessionMeta(id: string, timestamp: string, extra: object = {}): string {
  return line({
    type: 'session_meta',
    timestamp,
    payload: { id, cwd: 'C:/Projects/demo', ...extra }
  })
}

function turnContext(model: string, timestamp = '2026-07-01T10:00:00Z'): string {
  return line({ type: 'turn_context', timestamp, payload: { model } })
}

function tokenCountLine(
  timestamp: string,
  last: Record<string, number>,
  cumulative: Record<string, number> = {}
): string {
  return line({
    type: 'event_msg',
    timestamp,
    payload: {
      type: 'token_count',
      info: { last_token_usage: last, total_token_usage: cumulative }
    }
  })
}

function run(lines: string[]): UsageEvent[] {
  const state = initialCodexScanState()
  const events: UsageEvent[] = []
  for (const raw of lines) {
    const event = parseCodexLine(raw, state)
    if (event) events.push(event)
  }
  return events
}

describe('parseCodexLine', () => {
  it('sums per-turn deltas rather than the cumulative total', () => {
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine(
        '2026-07-01T10:00:05Z',
        { input_tokens: 100, output_tokens: 10 },
        { input_tokens: 100, output_tokens: 10 }
      ),
      tokenCountLine(
        '2026-07-01T10:00:20Z',
        { input_tokens: 50, output_tokens: 5 },
        { input_tokens: 150, output_tokens: 15 }
      )
    ])
    // Reading total_token_usage instead would have yielded 250 input.
    const totals = events.reduce((sum, event) => sum + totalTokens(event.tokens), 0)
    expect(totals).toBe(165)
  })

  it('drops a re-emitted identical token_count', () => {
    const usage = { input_tokens: 100, output_tokens: 10 }
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:05Z', usage),
      tokenCountLine('2026-07-01T10:00:06Z', usage)
    ])
    expect(events).toHaveLength(1)
  })

  it('splits the cached half out of the inclusive input figure', () => {
    const [event] = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:05Z', {
        input_tokens: 1_000,
        cached_input_tokens: 800,
        cache_write_input_tokens: 150,
        output_tokens: 40
      })
    ])
    expect(event.tokens).toEqual({
      uncached_input: 50,
      cached_input: 800,
      cache_creation: 150,
      output: 40,
      reasoning: 0
    })
  })

  it('clamps reasoning to its parent output count', () => {
    const [event] = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:05Z', {
        input_tokens: 10,
        output_tokens: 40,
        reasoning_output_tokens: 999
      })
    ])
    expect(event.tokens.reasoning).toBe(40)
  })

  it('suppresses the copied parent history at the head of a fork', () => {
    const events = run([
      sessionMeta('fork1', '2026-07-01T12:00:00Z', { forked_from_id: 'parent1' }),
      turnContext('gpt-5-codex'),
      // The parent burst: three turns re-stamped within milliseconds.
      tokenCountLine('2026-07-01T12:00:00.010Z', { input_tokens: 500, output_tokens: 50 }),
      tokenCountLine('2026-07-01T12:00:00.030Z', { input_tokens: 600, output_tokens: 60 }),
      tokenCountLine('2026-07-01T12:00:00.055Z', { input_tokens: 700, output_tokens: 70 }),
      // The fork's own first real turn, seconds later.
      tokenCountLine('2026-07-01T12:00:09Z', { input_tokens: 800, output_tokens: 80 })
    ])
    expect(events).toHaveLength(1)
    expect(events[0].tokens.uncached_input).toBe(800)
  })

  it('suppresses a subagent rollout the same way', () => {
    const events = run([
      sessionMeta('sub1', '2026-07-01T12:00:00Z', {
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent1' } } }
      }),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T12:00:00.010Z', { input_tokens: 500, output_tokens: 50 }),
      tokenCountLine('2026-07-01T12:00:12Z', { input_tokens: 900, output_tokens: 90 })
    ])
    expect(events).toHaveLength(1)
    expect(events[0].tokens.uncached_input).toBe(900)
  })

  it('keeps every turn of an ordinary rollout', () => {
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:00.010Z', { input_tokens: 100, output_tokens: 10 }),
      tokenCountLine('2026-07-01T10:00:00.020Z', { input_tokens: 200, output_tokens: 20 })
    ])
    expect(events).toHaveLength(2)
  })

  it('ignores an ancestor session_meta replayed into a fork', () => {
    const events = run([
      sessionMeta('child', '2026-07-01T12:00:00Z'),
      sessionMeta('ancestor', '2026-07-01T09:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T12:00:30Z', { input_tokens: 10, output_tokens: 1 })
    ])
    expect(events[0].session_id).toBe('child')
  })

  it('does not let a model-less token_count poison the duplicate signature', () => {
    const usage = { input_tokens: 100, output_tokens: 10 }
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      // Arrives before any turn_context, so it has no model yet.
      tokenCountLine('2026-07-01T10:00:01Z', usage),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:02Z', usage)
    ])
    expect(events).toHaveLength(1)
    expect(events[0].model).toBe('gpt-5-codex')
  })

  it('attributes turns to the model in force when they ran', () => {
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      tokenCountLine('2026-07-01T10:00:05Z', { input_tokens: 100, output_tokens: 10 }),
      turnContext('o3', '2026-07-01T10:01:00Z'),
      tokenCountLine('2026-07-01T10:01:05Z', { input_tokens: 200, output_tokens: 20 })
    ])
    expect(events.map((event) => event.model)).toEqual(['gpt-5-codex', 'o3'])
  })

  it('skips zero-token events and unparseable lines', () => {
    const events = run([
      sessionMeta('s1', '2026-07-01T10:00:00Z'),
      turnContext('gpt-5-codex'),
      '{not json',
      tokenCountLine('2026-07-01T10:00:05Z', { input_tokens: 0, output_tokens: 0 })
    ])
    expect(events).toHaveLength(0)
  })
})
