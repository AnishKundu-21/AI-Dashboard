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

  it('detects Cursor agent transcripts', () => {
    expect(
      classifyProviderChange(
        'cursor',
        'projects\\encoded-workspace\\agent-transcripts\\abc\\abc.jsonl'
      )
    ).toBe('session')
    expect(classifyProviderChange('cursor', 'projects\\cache.json')).toBe('ignore')
  })

  it('detects OpenCode database changes', () => {
    expect(classifyProviderChange('opencode', 'opencode.db')).toBe('session')
    expect(classifyProviderChange('opencode', 'opencode.db-wal')).toBe('session')
    expect(classifyProviderChange('opencode', 'other.db')).toBe('ignore')
  })
})
