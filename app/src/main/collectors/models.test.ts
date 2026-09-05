import { describe, expect, it } from 'vitest'
import { dominantModel, normalizeModelName } from './models'

describe('normalizeModelName', () => {
  it('accepts real Codex model identifiers', () => {
    expect(normalizeModelName('codex', 'openai/gpt-5.6-codex')).toBe('gpt-5.6-codex')
    expect(normalizeModelName('codex', 'o3')).toBe('o3')
  })

  it('rejects Codex workflow labels that are not model IDs', () => {
    expect(normalizeModelName('codex', 'codex-auto-review')).toBeNull()
  })

  it('rejects settings and arbitrary metadata values', () => {
    expect(normalizeModelName('codex', 'auto')).toBeNull()
    expect(normalizeModelName('codex', 'high')).toBeNull()
    expect(normalizeModelName('codex', 'balanced reasoning')).toBeNull()
  })

  it('selects the deterministic dominant model', () => {
    expect(
      dominantModel('codex', ['gpt-5.6-codex', 'random', 'o3', 'gpt-5.6-codex'])
    ).toBe('gpt-5.6-codex')
  })
})

describe('providers beyond the original three', () => {
  it('accepts a routed model id rather than relabelling it Unknown', () => {
    // OpenCode routes many upstreams; there is no family pattern to match on.
    expect(normalizeModelName('opencode', 'xai/grok-4.3')).toBe('grok-4.3')
    expect(normalizeModelName('opencode', 'github-copilot/claude-sonnet-4.5')).toBe(
      'claude-sonnet-4.5'
    )
    expect(normalizeModelName('opencode', 'gpt-5.6-sol')).toBe('gpt-5.6-sol')
  })

  it('still rejects UI placeholders that are not models', () => {
    expect(normalizeModelName('opencode', 'auto')).toBeNull()
    expect(normalizeModelName('opencode', 'unknown')).toBeNull()
    expect(normalizeModelName('opencode', '')).toBeNull()
  })
})
