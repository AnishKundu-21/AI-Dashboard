import { describe, expect, it } from 'vitest'
import { enabledProviderIds, isProviderEnabled, providerIds } from './providers'

describe('provider selection', () => {
  it('keeps existing and newly registered providers enabled by default', () => {
    expect(enabledProviderIds({ enabled_providers: {} })).toEqual(providerIds())
  })

  it('removes only providers explicitly disabled by the user', () => {
    const settings = { enabled_providers: { claude: false, opencode: true } }

    expect(isProviderEnabled(settings, 'claude')).toBe(false)
    expect(isProviderEnabled(settings, 'opencode')).toBe(true)
    expect(isProviderEnabled(settings, 'codex')).toBe(true)
    expect(enabledProviderIds(settings)).toEqual([
      'grok',
      'codex',
      'cursor',
      'opencode'
    ])
  })
})
