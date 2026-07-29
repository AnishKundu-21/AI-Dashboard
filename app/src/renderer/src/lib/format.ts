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

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export function confidenceBadge(
  confidence: string,
  authConnected: boolean,
  stale = false
): { label: string; className: string } {
  if (!authConnected) return { label: 'Not connected', className: 'info' }
  if (stale) return { label: 'AUTH LIVE · STALE', className: 'warn' }
  if (confidence === 'live') return { label: 'AUTH LIVE', className: 'good' }
  if (confidence === 'estimate') return { label: 'LOCAL ESTIMATE', className: 'warn' }
  return { label: 'Unknown', className: 'info' }
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
