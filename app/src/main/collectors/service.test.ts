import { describe, expect, it } from 'vitest'
import { classifyProviderChange } from './service'

describe('real-time provider file classification', () => {
  it('detects Grok usage and auth changes', () => {
    expect(
      classifyProviderChange('grok', 'sessions\\project\\id\\updates.jsonl')
    ).toBe('session')
    expect(classifyProviderChange('grok', 'active_sessions.json')).toBe('session')
    expect(classifyProviderChange('grok', 'auth.json')).toBe('quota')
    expect(classifyProviderChange('grok', 'sessions\\id\\terminal\\call.log')).toBe(
      'ignore'
    )
  })

  it('detects Codex rollout changes', () => {
    expect(
      classifyProviderChange('codex', 'sessions\\2026\\rollout.jsonl')
    ).toBe('session')
  })
})
