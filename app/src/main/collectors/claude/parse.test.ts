import { describe, expect, it } from 'vitest'
import { parseClaudeLine } from './parse'
import { dedupeEvents } from '../aggregate'
import type { UsageEvent } from '../../../shared/types'

function assistantLine(options: {
  messageId?: string | null
  requestId?: string | null
  timestamp?: string
  model?: string
  usage?: Record<string, number>
  sessionId?: string
}): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: options.sessionId ?? 's1',
    cwd: 'C:/Projects/demo',
    timestamp: options.timestamp ?? '2026-07-01T10:00:00Z',
    ...(options.requestId === null ? {} : { requestId: options.requestId ?? 'req-1' }),
    message: {
      ...(options.messageId === null ? {} : { id: options.messageId ?? 'msg-1' }),
      model: options.model ?? 'claude-sonnet-4-5-20250929',
      usage: options.usage ?? {
        input_tokens: 100,
        cache_read_input_tokens: 5_000,
        cache_creation_input_tokens: 200,
        output_tokens: 50
      }
    }
  })
}

function eventsFrom(lines: string[]): UsageEvent[] {
  const out: UsageEvent[] = []
  for (const line of lines) {
    const parsed = parseClaudeLine(line, 'fallback')
    if (parsed.event) out.push(parsed.event)
  }
  return out
}

describe('parseClaudeLine', () => {
  it('maps the four token classes without folding cache into input', () => {
    const [event] = eventsFrom([assistantLine({})])
    expect(event.tokens).toEqual({
      uncached_input: 100,
      cached_input: 5_000,
      cache_creation: 200,
      output: 50,
      reasoning: 0
    })
  })

  it('keeps the raw model id for rate lookup', () => {
    const [event] = eventsFrom([assistantLine({})])
    expect(event.model).toBe('claude-sonnet-4-5-20250929')
  })

  it('keys on the message and request pair', () => {
    const [event] = eventsFrom([
      assistantLine({ messageId: 'msg-9', requestId: 'req-9' })
    ])
    expect(event.dedupe_key).toBe('claude:msg-9:req-9')
  })

  it('collapses the repeated per-content-block records of one message', () => {
    // Claude writes one record per content block, each repeating the whole
    // usage object. Three blocks must count once, not three times.
    const events = eventsFrom([
      assistantLine({ messageId: 'msg-1', requestId: 'req-1' }),
      assistantLine({ messageId: 'msg-1', requestId: 'req-1' }),
      assistantLine({ messageId: 'msg-1', requestId: 'req-1' })
    ])
    const deduped = dedupeEvents(events)
    expect(deduped.events).toHaveLength(1)
    expect(deduped.dropped).toBe(2)
  })

  it('de-duplicates the same message replayed into a second transcript', () => {
    // A resumed or branched session repeats earlier messages in a new file;
    // per-file de-duplication alone would count them twice.
    const fileA = eventsFrom([assistantLine({ messageId: 'msg-1', sessionId: 's1' })])
    const fileB = eventsFrom([assistantLine({ messageId: 'msg-1', sessionId: 's2' })])
    expect(dedupeEvents([...fileA, ...fileB]).events).toHaveLength(1)
  })

  it('distinguishes two messages that share a request id', () => {
    const events = eventsFrom([
      assistantLine({ messageId: 'msg-1', requestId: 'req-1' }),
      assistantLine({ messageId: 'msg-2', requestId: 'req-1' })
    ])
    expect(dedupeEvents(events).events).toHaveLength(2)
  })

  it('gives a record with neither id a key that is never merged away', () => {
    const events = eventsFrom([
      assistantLine({
        messageId: null,
        requestId: null,
        timestamp: '2026-07-01T10:00:00Z'
      }),
      assistantLine({
        messageId: null,
        requestId: null,
        timestamp: '2026-07-01T10:00:01Z'
      })
    ])
    expect(dedupeEvents(events).events).toHaveLength(2)
  })

  it('ignores user, system and tool lines', () => {
    expect(
      eventsFrom([
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        JSON.stringify({ type: 'system', subtype: 'init' }),
        'not json at all'
      ])
    ).toHaveLength(0)
  })

  it('reads session facts off a result line without emitting an event', () => {
    const parsed = parseClaudeLine(
      JSON.stringify({
        type: 'result',
        sessionId: 's1',
        timestamp: '2026-07-01T10:05:00Z',
        is_error: false,
        duration_ms: 300_000,
        total_cost_usd: 0.42
      }),
      'fallback'
    )
    expect(parsed.event).toBeNull()
    expect(parsed.is_result).toBe(true)
    expect(parsed.duration_ms).toBe(300_000)
    expect(parsed.total_cost_usd).toBe(0.42)
  })

  it('drops an assistant line with no model rather than guessing one', () => {
    expect(
      eventsFrom([
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-07-01T10:00:00Z',
          message: { id: 'm', usage: { output_tokens: 10 } }
        })
      ])
    ).toHaveLength(0)
  })
})

describe('non-model records', () => {
  it('ignores Claude Code synthetic placeholders', () => {
    // A rate-limit notice the CLI composed itself: real in the transcript,
    // but not a model call, and with no rate of its own it would otherwise
    // mark a fully priced session as unpriced.
    const events = eventsFrom([
      JSON.stringify({
        type: 'assistant',
        sessionId: 's1',
        timestamp: '2026-07-01T10:00:00Z',
        requestId: 'req-1',
        message: {
          id: 'msg-synth',
          model: '<synthetic>',
          content: [{ text: "You've hit your session limit" }],
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0
          }
        }
      })
    ])
    expect(events).toHaveLength(0)
  })

  it('ignores an assistant record that reported no tokens', () => {
    expect(
      eventsFrom([
        assistantLine({ usage: { input_tokens: 0, output_tokens: 0 } })
      ])
    ).toHaveLength(0)
  })
})
