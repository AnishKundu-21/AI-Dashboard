/** Renderer formatting. Amounts from main are USD; convert for display currency. */

const FX_USD_TO: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155,
  AUD: 1.53,
  CAD: 1.37
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

export function formatCurrency(
  amountUsd: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  const cur = currency.toUpperCase()
  const rate = FX_USD_TO[cur] ?? 1
  const value = amountUsd * rate
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: cur === 'JPY' ? 0 : 2
    }).format(value)
  } catch {
    return `$${amountUsd.toFixed(2)}`
  }
}

/** Short relative label such as "just now", "12m ago", "3d ago". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return day < 30 ? `${day}d ago` : new Date(t).toLocaleDateString()
}

/** Percentage change between two windows; null when there is no usable baseline. */
export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

/**
 * "Live" is shown only when a provider usage API returned real figures —
 * anything derived locally is labelled as an estimate.
 */
export function confidenceBadge(
  confidence: string,
  authConnected: boolean,
  stale = false
): { label: string; className: string } {
  if (!authConnected) return { label: 'Not connected', className: 'plain' }
  if (stale) return { label: 'Live · stale', className: 'warn' }
  if (confidence === 'live') return { label: 'Live', className: 'good' }
  if (confidence === 'estimate') return { label: 'Estimate', className: 'warn' }
  return { label: 'Unknown', className: 'plain' }
}

export const CURRENCY_OPTIONS = [
  'USD',
  'INR',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD'
] as const

export const LOCALE_OPTIONS = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'de-DE', label: 'German' },
  { value: 'ja-JP', label: 'Japanese' }
] as const
