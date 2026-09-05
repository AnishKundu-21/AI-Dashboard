import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSettingsSchema } from '@shared/types'
import { SettingsPanel } from './SettingsPanel'

describe('SettingsPanel', () => {
  it('renders every registered provider even when it has no plan presets', () => {
    const settings = AppSettingsSchema.parse({})
    const markup = renderToStaticMarkup(
      <SettingsPanel settings={settings} onChange={async () => undefined} />
    )

    expect(markup).toContain('Grok Build')
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('Codex CLI')
    expect(markup).toContain('Cursor CLI')
    expect(markup).toContain('OpenCode')
    expect(markup).toContain('aria-label="Disable OpenCode"')
    expect(markup).toContain('Run setup again')
  })

  it('reflects disabled provider state without removing its selector', () => {
    const settings = AppSettingsSchema.parse({
      enabled_providers: { claude: false }
    })
    const markup = renderToStaticMarkup(
      <SettingsPanel settings={settings} onChange={async () => undefined} />
    )

    expect(markup).toContain('aria-label="Enable Claude Code"')
  })

  it('shows editable plan controls and presets for Cursor and OpenCode', () => {
    const settings = AppSettingsSchema.parse({
      plans: {
        cursor: { mode: 'manual', value: 'Pro+' },
        opencode: { mode: 'manual', value: 'OpenCode Zen' }
      }
    })
    const markup = renderToStaticMarkup(
      <SettingsPanel settings={settings} onChange={async () => undefined} />
    )

    expect(markup).toContain('id="plan-mode-cursor"')
    expect(markup).toContain('id="plan-value-cursor"')
    expect(markup).toContain('id="plan-mode-opencode"')
    expect(markup).toContain('id="plan-value-opencode"')
    expect(markup).toContain('Pro+')
    expect(markup).toContain('OpenCode Zen')
  })
})
