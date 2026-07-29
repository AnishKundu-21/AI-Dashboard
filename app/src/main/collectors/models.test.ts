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
