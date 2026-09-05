import { describe, expect, it } from 'vitest'
import { parseCursorLine } from './parse'

describe('parseCursorLine', () => {
  it('maps provider-native transcript usage without counting cached input twice', () => {
    const result = parseCursorLine(
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-09-05T10:00:00Z',
        conversation_id: 'conv-1',
        cwd: 'C:\\work\\dashboard',
        model_id: 'claude-sonnet-4-20250514',
        generation_id: 'gen-1',
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 50,
          output_tokens: 25
        }
      }),
      'fallback'
    )
    expect(result.event?.tokens).toEqual({
      uncached_input: 100,
      cached_input: 900,
      cache_creation: 50,
      output: 25,
      reasoning: 0
    })
    expect(result.event?.dedupe_key).toBe('cursor:conv-1:gen-1')
    expect(result.cwd).toBe('C:\\work\\dashboard')
  })

  it('maps camelCase hook usage whose input total includes cache tokens', () => {
    const result = parseCursorLine(
      JSON.stringify({
        role: 'assistant',
        timestamp: 1788600000,
        model: 'gpt-5',
        usage: {
          inputTokens: 1000,
          cacheReadTokens: 800,
          cacheWriteTokens: 50,
          outputTokens: 200,
          reasoningTokens: 80
        }
      }),
      'fallback'
    )
    expect(result.event?.tokens).toEqual({
      uncached_input: 150,
      cached_input: 800,
      cache_creation: 50,
      output: 200,
      reasoning: 80
    })
    expect(result.event?.session_id).toBe('fallback')
  })

  it('ignores user records and zero-usage assistant records', () => {
    expect(
      parseCursorLine(JSON.stringify({ role: 'user', usage: { inputTokens: 4 } }), 'x')
        .event
    ).toBeNull()
    expect(
      parseCursorLine(
        JSON.stringify({ role: 'assistant', timestamp: 1788600000, usage: {} }),
        'x'
      ).event
    ).toBeNull()
  })
})
