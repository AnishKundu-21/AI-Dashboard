export const PROVIDER_IDS = ['grok', 'claude', 'codex'] as const

export type ProviderId = (typeof PROVIDER_IDS)[number]

export const PROVIDER_META: Record<
  ProviderId,
  { name: string; short: string; color: string }
> = {
  grok: { name: 'Grok Build', short: 'Grok', color: '#2dd4bf' },
  claude: { name: 'Claude Code', short: 'Claude', color: '#fb923c' },
  codex: { name: 'Codex CLI', short: 'Codex', color: '#60a5fa' }
}
