/**
 * The provider registry.
 *
 * Providers used to be a closed `as const` union threaded through zod schemas,
 * SQL and the UI, so adding one meant touching every layer. They are now
 * runtime-registered manifests: a new agent is a manifest plus a collector, and
 * nothing else has to change.
 *
 * Ids stay opaque lowercase strings because they are also stored in SQLite and
 * appear in exported files — a database written by a build that knew about a
 * provider must stay readable by one that does not.
 */

export type ProviderId = string

export interface ProviderManifest {
  id: ProviderId
  /** Full display name, e.g. "Claude Code". */
  name: string
  /** Compact label for chips and legends, e.g. "Claude". */
  short: string
  /** Accent colour used consistently across charts and cards. */
  color: string
  /** Where the CLI keeps its state, shown in the health view. */
  homeLabel: string
  /**
   * Whether this provider can report subscription quota at all. False means
   * the quota card should say so rather than showing a perpetual "unknown".
   */
  reportsQuota: boolean
}

const REGISTRY = new Map<ProviderId, ProviderManifest>()

export function registerProvider(manifest: ProviderManifest): void {
  REGISTRY.set(manifest.id, manifest)
}

/** Registration order, which is the order the UI lists providers in. */
export function providerIds(): ProviderId[] {
  return [...REGISTRY.keys()]
}

/**
 * Provider selection is stored sparsely: an omitted id is enabled. This keeps
 * existing installations and newly registered providers working without a
 * settings migration, while an explicit `false` remains durable.
 */
export function isProviderEnabled(
  settings: { enabled_providers?: Record<string, boolean> },
  id: ProviderId
): boolean {
  return settings.enabled_providers?.[id] !== false
}

export function enabledProviderIds(settings: {
  enabled_providers?: Record<string, boolean>
}): ProviderId[] {
  return providerIds().filter((id) => isProviderEnabled(settings, id))
}

export function providerManifests(): ProviderManifest[] {
  return [...REGISTRY.values()]
}

export function isKnownProvider(id: string): boolean {
  return REGISTRY.has(id)
}

/**
 * Metadata for `id`, synthesising a neutral entry for one this build does not
 * know about. Rows written by a newer version must still render rather than
 * crashing on a missing lookup.
 */
export function providerMeta(id: ProviderId): ProviderManifest {
  const known = REGISTRY.get(id)
  if (known) return known
  return {
    id,
    name: id,
    short: id,
    color: 'var(--text-3)',
    homeLabel: '',
    reportsQuota: false
  }
}

registerProvider({
  id: 'grok',
  name: 'Grok Build',
  short: 'Grok',
  color: '#2dd4bf',
  homeLabel: '~/.grok',
  reportsQuota: true
})

registerProvider({
  id: 'claude',
  name: 'Claude Code',
  short: 'Claude',
  color: '#fb923c',
  homeLabel: '~/.claude',
  reportsQuota: true
})

registerProvider({
  id: 'codex',
  name: 'Codex CLI',
  short: 'Codex',
  color: '#60a5fa',
  homeLabel: '~/.codex',
  reportsQuota: true
})

registerProvider({
  id: 'cursor',
  name: 'Cursor CLI',
  short: 'Cursor',
  color: '#facc15',
  homeLabel: '~/.cursor',
  // Cursor's local agent transcripts expose token usage, but its CLI does not
  // publish a subscription-quota API that can be queried safely here.
  reportsQuota: false
})

registerProvider({
  id: 'opencode',
  name: 'OpenCode',
  short: 'OpenCode',
  color: '#c084fc',
  homeLabel: '~/.local/share/opencode',
  // OpenCode bills per model through the user's own provider keys, so there is
  // no subscription window to report — its cost comes from the events instead.
  reportsQuota: false
})
