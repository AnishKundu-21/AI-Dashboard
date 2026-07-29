import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { collectGrokSessions, parseGrokUsageUpdates } from './sessions'

describe('parseGrokUsageUpdates', () => {
  it('aggregates structured Grok usage without returning content', () => {
    const lines = [
      {
        params: {
          update: {
            content: 'private prompt or response',
            usage: {
              inputTokens: 100,
              outputTokens: 20,
              totalTokens: 120,
              apiDurationMs: 250,
              modelUsage: {
                'grok-4.5-build': { modelCalls: 2, totalTokens: 120 }
              }
            }
          }
        }
      },
      {
        params: {
          update: {
            usage: {
              inputTokens: 40,
              outputTokens: 10,
              totalTokens: 50,
              apiDurationMs: 100,
              modelUsage: {
                'grok-4.5-build': { modelCalls: 1, totalTokens: 50 }
              }
            }
          }
        }
      }
    ]
      .map((value) => JSON.stringify(value))
      .join('\n')

    const result = parseGrokUsageUpdates(lines)
    expect(result).toEqual({
      tokensIn: 140,
      tokensOut: 30,
      tokensTotal: 170,
      tokensCached: 0,
      tokensReasoning: 0,
      modelCalls: 3,
      model: 'grok-4.5-build',
      apiDurationMs: 350,
      providerCostUsd: null
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('returns null counters when no usage objects exist', () => {
    expect(parseGrokUsageUpdates('{"params":{"update":{"content":"x"}}}')).toEqual({
      tokensIn: null,
      tokensOut: null,
      tokensTotal: null,
      tokensCached: null,
      tokensReasoning: null,
      modelCalls: null,
      model: null,
      apiDurationMs: null,
      providerCostUsd: null
    })
  })

  it('collects tokens and model from the real Grok session layout', () => {
    const home = mkdtempSync(join(tmpdir(), 'grok-collector-'))
    try {
      const sessionDir = join(home, 'sessions', 'encoded-project', 'session-1')
      mkdirSync(sessionDir, { recursive: true })
      writeFileSync(
        join(sessionDir, 'summary.json'),
        JSON.stringify({
          info: { id: 'session-1', cwd: 'C:\\Projects\\RealProject' },
          created_at: '2026-07-29T10:00:00.000Z',
          updated_at: '2026-07-29T10:05:00.000Z',
          current_model_id: 'grok-4.5'
        })
      )
      writeFileSync(
        join(sessionDir, 'updates.jsonl'),
        JSON.stringify({
          params: {
            update: {
              usage: {
                inputTokens: 900,
                outputTokens: 100,
                totalTokens: 1000,
                modelUsage: {
                  'grok-4.5-build': { modelCalls: 1, totalTokens: 1000 }
                }
              }
            }
          }
        })
      )

      expect(collectGrokSessions(home)).toEqual([
        expect.objectContaining({
          id: 'grok:session-1',
          project: 'RealProject',
          model: 'grok-4.5-build',
          tokens_in: 900,
          tokens_out: 100,
          tokens_total: 1000,
          duration_ms: 300_000,
          source: 'grok:session-files'
        })
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
