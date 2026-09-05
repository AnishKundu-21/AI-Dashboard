import { describe, expect, it } from 'vitest'
import { openCodeModelKey, parseOpenCodeMessage } from './parse'
import { totalTokens } from '../../../shared/tokens'

/** Shape captured from a real OpenCode `message.data` row. */
function assistantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_f191b3a39001bBfP',
    session_id: 'ses_3f6f390fdffe',
    data: JSON.stringify({
      role: 'assistant',
      agent: 'build',
      path: { cwd: 'C:/Projects/Demo', root: 'C:/Projects/Demo' },
      cost: 0.0076621,
      tokens: {
        total: 31530,
        input: 170,
        output: 486,
        reasoning: 26,
        cache: { write: 0, read: 30848 }
      },
      modelID: 'grok-4.3',
      providerID: 'xai',
      time: { created: 1788600000000, completed: 1788600004000 },
      finish: 'stop',
      ...overrides
    })
  }
}

describe('parseOpenCodeMessage', () => {
  it('reconciles with the total OpenCode itself reports', () => {
    const parsed = parseOpenCodeMessage(assistantRow())
    expect(parsed.event).not.toBeNull()
    // OpenCode reports total 31530 for this message.
    expect(totalTokens(parsed.event!.tokens)).toBe(31530)
  })

  it('treats input as excluding the cached half', () => {
    // Unlike Codex and Grok, OpenCode does not fold cache reads into input.
    const parsed = parseOpenCodeMessage(assistantRow())
    expect(parsed.event!.tokens.uncached_input).toBe(170)
    expect(parsed.event!.tokens.cached_input).toBe(30848)
  })

  it('folds reasoning into output so it stays a subset', () => {
    // OpenCode counts reasoning beside output; the canonical model counts it
    // inside output, and folding keeps the total reconciling either way.
    const parsed = parseOpenCodeMessage(assistantRow())
    expect(parsed.event!.tokens.output).toBe(486 + 26)
    expect(parsed.event!.tokens.reasoning).toBe(26)
    expect(parsed.event!.tokens.reasoning).toBeLessThanOrEqual(
      parsed.event!.tokens.output
    )
  })

  it('carries the cost OpenCode actually paid', () => {
    const parsed = parseOpenCodeMessage(assistantRow())
    expect(parsed.event!.reported_cost_usd).toBeCloseTo(0.0076621, 9)
    expect(parsed.cost_usd).toBeCloseTo(0.0076621, 9)
  })

  it('qualifies the model with its upstream provider for rate lookup', () => {
    expect(parseOpenCodeMessage(assistantRow()).event!.model).toBe('xai/grok-4.3')
    expect(openCodeModelKey('anthropic', 'claude-opus-5')).toBe(
      'anthropic/claude-opus-5'
    )
    expect(openCodeModelKey(null, 'grok-4.3')).toBe('grok-4.3')
    expect(openCodeModelKey('xai', null)).toBe('')
  })

  it('reads the working directory for project attribution', () => {
    expect(parseOpenCodeMessage(assistantRow()).cwd).toBe('C:/Projects/Demo')
  })

  it('ignores user messages and zero-token assistant messages', () => {
    expect(parseOpenCodeMessage(assistantRow({ role: 'user' })).event).toBeNull()
    expect(
      parseOpenCodeMessage(
        assistantRow({
          tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } }
        })
      ).event
    ).toBeNull()
  })

  it('survives a malformed data blob', () => {
    expect(
      parseOpenCodeMessage({ id: 'a', session_id: 'b', data: '{not json' }).event
    ).toBeNull()
  })

  it('keys events on the message id so a rescan upserts', () => {
    const first = parseOpenCodeMessage(assistantRow()).event
    const second = parseOpenCodeMessage(assistantRow()).event
    expect(first!.dedupe_key).toBe(second!.dedupe_key)
    expect(first!.dedupe_key).toBe('opencode:msg_f191b3a39001bBfP')
  })
})
