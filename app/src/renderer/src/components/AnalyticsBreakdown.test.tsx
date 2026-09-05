import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ModelMixItem, ProviderCost } from '@shared/types'
import { AnalyticsRankChart, AnalyticsTable } from './AnalyticsBreakdown'

vi.mock('../lib/hooks', () => ({
  useElementWidth: () => [{ current: null }, 620],
  usePrefersReducedMotion: () => true
}))

const provider: ProviderCost = {
  provider: 'claude',
  tokens_total: 407,
  uncached_input: 110,
  cached_input: 220,
  cache_creation: 33,
  output: 44,
  reasoning: 11,
  model_calls: 2,
  session_count: 1,
  api_equiv_usd: 0.5,
  provider_cost_usd: 0.4,
  cache_savings_usd: 0.22,
  unpriced_calls: 1
}

const model: ModelMixItem = {
  ...provider,
  model: 'claude-sonnet-4-5',
  share: 1
}

describe('analytics breakdown', () => {
  it('graphs providers and models for any collected measure', () => {
    const markup = renderToStaticMarkup(
      <>
        <AnalyticsRankChart rows={[provider]} kind="provider" metric="cached_input" currency="USD" locale="en-US" />
        <AnalyticsRankChart rows={[model]} kind="model" metric="cache_creation" currency="USD" locale="en-US" />
      </>
    )
    expect(markup).toContain('Claude Code')
    expect(markup).toContain('claude-sonnet-4-5')
    expect(markup).toContain('220')
    expect(markup).toContain('33')
  })

  it('shows the complete model accounting table', () => {
    const markup = renderToStaticMarkup(
      <AnalyticsTable rows={[model]} kind="model" currency="USD" locale="en-US" />
    )
    for (const heading of [
      'Total tokens',
      'Uncached input',
      'Cache read',
      'Cache write',
      'Cache hit',
      'Output',
      'Reasoning',
      'Calls',
      'Sessions',
      'API-equiv.',
      'Provider billed',
      'Cache saved',
      'Unpriced calls'
    ]) {
      expect(markup).toContain(heading)
    }
  })
})
