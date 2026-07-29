import type { ProviderAdapter } from './base'
import type { ProviderId } from '../../shared/providers'
import { grokAdapter } from './grok'
import { codexAdapter } from './codex'
import { claudeAdapter } from './claude'

const adapters = new Map<ProviderId, ProviderAdapter>()

export function registerDefaultAdapters(): void {
  registerAdapter(grokAdapter)
  registerAdapter(codexAdapter)
  registerAdapter(claudeAdapter)
}

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.id, adapter)
}

export function getAdapter(id: ProviderId): ProviderAdapter | undefined {
  return adapters.get(id)
}

export function listAdapters(): ProviderAdapter[] {
  return Array.from(adapters.values())
}
