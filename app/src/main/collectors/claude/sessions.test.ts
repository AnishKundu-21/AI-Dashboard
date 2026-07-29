import { describe, expect, it } from 'vitest'
import { parseClaudeSession } from './sessions'

describe('parseClaudeSession', () => {
  it('aggregates Claude input, output, cache, calls, cost, and duration', () => {
    const text = [
      {
        type: 'assistant',
        sessionId: 'session-7',
        cwd: 'C:\\Projects\\UsefulApp',
        timestamp: '2026-07-29T10:00:00Z',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-5-20250929',
          content: 'private response',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 10
          }
        }
      },
      {
        type: 'result',
        sessionId: 'session-7',
        timestamp: '2026-07-29T10:00:02Z',
        duration_ms: 2000,
        total_cost_usd: 0.012,
        is_error: false
      }
    ].map((value) => JSON.stringify(value)).join('\n')

    const row = parseClaudeSession(text, 'fallback')
    expect(row).toEqual(expect.objectContaining({
      id: 'claude:session-7',
      project: 'UsefulApp',
      model: 'claude-sonnet-4-5-20250929',
      tokens_in: 100,
      tokens_out: 20,
      tokens_total: 120,
      tokens_cached: 40,
      model_calls: 1,
      provider_cost_usd: 0.012,
      duration_ms: 2000,
      status: 'complete'
    }))
    expect(JSON.stringify(row)).not.toContain('private response')
  })

  it('deduplicates repeated assistant message records', () => {
    const assistant = JSON.stringify({
      type: 'assistant',
      sessionId: 'dedupe',
      message: {
        id: 'same-message',
        model: 'claude-opus-4-1',
        usage: { input_tokens: 5, output_tokens: 2 }
      }
    })
    const row = parseClaudeSession(`${assistant}\n${assistant}`, 'fallback')
    expect(row).toEqual(expect.objectContaining({
      tokens_in: 5,
      tokens_out: 2,
      model_calls: 1
    }))
  })
})
