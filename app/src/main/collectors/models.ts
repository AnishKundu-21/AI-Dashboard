import type { ProviderId } from '../../shared/providers'

const NON_MODELS = new Set([
  '',
  'auto',
  'automatic',
  'default',
  'none',
  'null',
  'unknown',
  'undefined'
])

/**
 * Normalize provider model identifiers and reject UI/config values that are not
 * actual model IDs. Unknown future model IDs are retained only when they match
 * the provider's model namespace.
 */
export function normalizeModelName(
  provider: ProviderId,
  raw: unknown
): string | null {
  if (typeof raw !== 'string') return null
  let value = raw.trim()
  if (!value || NON_MODELS.has(value.toLowerCase())) return null

  // APIs sometimes prefix the ID with a provider namespace.
  if (value.includes('/')) value = value.split('/').pop() ?? value
  value = value.replace(/\s+/g, ' ')

  if (provider === 'codex') {
    if (!/^(?:gpt-[a-z0-9][a-z0-9._-]*|o[1-9](?:-[a-z0-9._-]+)?|codex|codex-mini-latest)$/i.test(value)) {
      return null
    }
    value = value.toLowerCase()
  } else if (provider === 'grok') {
    if (!/^grok(?:[- ][a-z0-9._-]+)?$/i.test(value)) return null
  } else if (provider === 'claude') {
    if (!/^(?:claude[- ]?)?(?:opus|sonnet|haiku)(?:[- ][a-z0-9._-]+)?$/i.test(value)) {
      return null
    }
  } else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(value)) {
    // Providers added after these three route models from many upstreams —
    // OpenCode alone yields xai/grok-4.3 and github-copilot/claude-sonnet-4.5 —
    // so there is no family pattern to match. Accept anything that looks like
    // a model id and let the rate table decide whether it is priceable, rather
    // than silently relabelling real usage as Unknown.
    return null
  }

  return value
}

/** Pick the most frequently observed valid model; ties keep first-seen order. */
export function dominantModel(
  provider: ProviderId,
  rawModels: unknown[]
): string | null {
  const counts = new Map<string, number>()
  for (const raw of rawModels) {
    const model = normalizeModelName(provider, raw)
    if (!model) continue
    counts.set(model, (counts.get(model) ?? 0) + 1)
  }

  let best: string | null = null
  let bestCount = 0
  for (const [model, count] of counts) {
    if (count > bestCount) {
      best = model
      bestCount = count
    }
  }
  return best
}
