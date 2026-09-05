import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppSettingsSchema } from '@shared/types'
import { Onboarding } from './Onboarding'

describe('Onboarding', () => {
  it('explains the local-first privacy contract before asking for choices', () => {
    const markup = renderToStaticMarkup(
      <Onboarding
        settings={AppSettingsSchema.parse({})}
        health={[]}
        onFinish={async () => undefined}
      />
    )

    expect(markup).toContain('Your AI usage, finally in one place.')
    expect(markup).toContain('Prompts and responses are never saved.')
    expect(markup).toContain('network access is also used to refresh provider quotas')
    expect(markup).toContain('model-price and exchange-rate tables')
    expect(markup).toContain('Step 1 of 3')
  })

  it('renders an accessible setup dialog with a skip action', () => {
    const markup = renderToStaticMarkup(
      <Onboarding
        settings={AppSettingsSchema.parse({})}
        health={[]}
        onFinish={async () => undefined}
      />
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('Skip for now')
  })
})
