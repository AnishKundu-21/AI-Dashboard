/**
 * Renderer formatting. Amounts from main are USD and converted here for the
 * display currency.
 *
 * Rates are supplied by main (which fetches and caches them) rather than kept
 * here: this module previously held a second hardcoded FX table that drifted
 * independently of the one in main, so the same amount could be converted two
 * different ways depending on which side formatted it.
 */

let fxRates: Record<string, number> = { USD: 1 }
let fxAvailable = false

/** Called whenever an overview response arrives, with the rates main used. */
export function setFxRates(rates: Record<string, number> | undefined): void {
  fxRates = { USD: 1, ...(rates ?? {}) }
  fxAvailable = Object.keys(fxRates).length > 1
}

export function hasFxRates(): boolean {
  return fxAvailable
}

/** Currencies that can actually be converted right now, USD always included. */
export function availableCurrencies(): string[] {
  return ['USD', ...Object.keys(fxRates).filter((code) => code !== 'USD').sort()]
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

/**
 * Formats a USD amount in the display currency.
 *
 * With no rate for the requested currency the amount is shown in USD rather
 * than converted at 1:1 — a dollar figure behind a rupee sign is a wrong
 * number, not a formatting nicety.
 */
export function formatCurrency(
  amountUsd: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  const requested = currency.toUpperCase()
  const rate = fxRates[requested]
  const usable = typeof rate === 'number' && rate > 0
  const code = usable ? requested : 'USD'
  const value = usable ? amountUsd * rate : amountUsd
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      maximumFractionDigits: code === 'JPY' ? 0 : 2
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

/** Exact local reset time plus a future/past countdown, e.g. "in 2h 14m · Sep 5, 8:45 PM". */
export function formatResetAt(
  iso: string | null | undefined,
  locale = 'en-US',
  timezone = 'system',
  now = Date.now()
): string {
  if (!iso) return '—'
  const reset = new Date(iso)
  const resetMs = reset.getTime()
  if (Number.isNaN(resetMs)) return '—'
  const diffMins = Math.round(Math.abs(resetMs - now) / 60_000)
  const days = Math.floor(diffMins / (24 * 60))
  const hours = Math.floor((diffMins % (24 * 60)) / 60)
  const mins = diffMins % 60
  const chunks = [days ? `${days}d` : '', hours ? `${hours}h` : '', `${mins}m`]
    .filter(Boolean)
    .slice(0, 2)
    .join(' ')
  const relative = resetMs >= now ? `in ${chunks}` : `${chunks} ago`
  try {
    const absolute = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      ...(timezone === 'system' ? {} : { timeZone: timezone })
    }).format(reset)
    return `${relative} · ${absolute}`
  } catch {
    return `${relative} · ${reset.toLocaleString()}`
  }
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

/**
 * Offered before any FX table has loaded. The Settings panel narrows this to
 * `availableCurrencies()` once main reports what it can actually convert.
 */
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
