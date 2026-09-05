import { describe, expect, it } from 'vitest'
import { GROK_COST_TICKS_PER_USD, costFromTicks, parseGrokLine } from './parse'

function turnCompleted(options: {
  usage: Record<string, unknown>
  promptId?: string
  agentTimestampMs?: number
  sessionUpdate?: string
}): string {
  return JSON.stringify({
    timestamp: 1_782_000_000,
    params: {
      sessionId: 'sess-1',
      _meta: { agentTimestampMs: options.agentTimestampMs ?? 1_782_000_000_000 },
      update: {
        sessionUpdate: options.sessionUpdate ?? 'turn_completed',
        prompt_id: options.promptId ?? 'prompt-1',
        usage: options.usage
      }
    }
  })
}

describe('parseGrokLine', () => {
  it('only counts turn_completed updates', () => {
    // Interim updates repeat the running usage; the previous collector summed
    // every line carrying a usage object and counted the turn several times.
    const interim = parseGrokLine(
      turnCompleted({
        sessionUpdate: 'agent_message_chunk',
        usage: { inputTokens: 100, outputTokens: 10 }
      }),
      'sess-1'
    )
    expect(interim.events).toHaveLength(0)
  })

  it('splits the cached half out of the inclusive input figure', () => {
    const { events } = parseGrokLine(
      turnCompleted({
        usage: {
          inputTokens: 1_000,
          cachedReadTokens: 700,
          cacheCreationTokens: 100,
          outputTokens: 60,
          modelUsage: {
            'grok-4': {
              inputTokens: 1_000,
              cachedReadTokens: 700,
              cacheCreationTokens: 100,
              outputTokens: 60
            }
          }
        }
      }),
      'sess-1'
    )
    expect(events[0].tokens).toEqual({
      uncached_input: 200,
      cached_input: 700,
      cache_creation: 100,
      output: 60,
      reasoning: 0
    })
  })

  it('emits one event per model so each is priced at its own rate', () => {
    const { events } = parseGrokLine(
      turnCompleted({
        usage: {
          inputTokens: 300,
          outputTokens: 30,
          modelUsage: {
            'grok-4': { inputTokens: 200, outputTokens: 20 },
            'grok-4-fast': { inputTokens: 100, outputTokens: 10 }
          }
        }
      }),
      'sess-1'
    )
    expect(events.map((event) => event.model).sort()).toEqual([
      'grok-4',
      'grok-4-fast'
    ])
    expect(new Set(events.map((event) => event.dedupe_key)).size).toBe(2)
  })

  it('keys events on the turn so a rescan upserts instead of duplicating', () => {
    const line = turnCompleted({
      promptId: 'prompt-7',
      usage: { inputTokens: 100, outputTokens: 10 }
    })
    const first = parseGrokLine(line, 'sess-1')
    const second = parseGrokLine(line, 'sess-1')
    expect(first.events[0].dedupe_key).toBe(second.events[0].dedupe_key)
  })

  it('prefers the high-resolution agent clock', () => {
    const { events } = parseGrokLine(
      turnCompleted({
        agentTimestampMs: 1_782_000_123_456,
        usage: { inputTokens: 100, outputTokens: 10 }
      }),
      'sess-1'
    )
    expect(events[0].ts_ms).toBe(1_782_000_123_456)
  })

  it('promotes a unix-seconds fallback timestamp to milliseconds', () => {
    const line = JSON.stringify({
      timestamp: 1_782_000_000,
      params: {
        sessionId: 'sess-1',
        update: {
          sessionUpdate: 'turn_completed',
          prompt_id: 'p1',
          usage: { inputTokens: 100, outputTokens: 10 }
        }
      }
    })
    expect(parseGrokLine(line, 'sess-1').events[0].ts_ms).toBe(1_782_000_000_000)
  })

  it('drops a turn that reported no tokens', () => {
    expect(
      parseGrokLine(
        turnCompleted({ usage: { inputTokens: 0, outputTokens: 0 } }),
        'sess-1'
      ).events
    ).toHaveLength(0)
  })
})

describe('costFromTicks', () => {
  it('converts ticks at 1e10 per dollar', () => {
    expect(costFromTicks(GROK_COST_TICKS_PER_USD)).toBe(1)
    expect(costFromTicks(2_500_000_000)).toBe(0.25)
  })

  it('rejects non-numeric and negative values', () => {
    expect(costFromTicks('nope')).toBeNull()
    expect(costFromTicks(-5)).toBeNull()
    expect(costFromTicks(undefined)).toBeNull()
  })
})
