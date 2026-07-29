/** Versioned public API rate card (USD per 1M tokens, blended). Comparison metric only. */
export const RATE_CARD_VERSION = '2026-07-v1'

const DEFAULT_USD_PER_M = 3.0

/** Longest / most specific model keys first after sort by length. */
const RATES: Record<string, number> = {
  // Grok
  'grok 4': 3.0,
  grok: 3.0,
  // Claude
  'claude-opus': 15.0,
  opus: 15.0,
  'claude-sonnet': 3.0,
  sonnet: 3.0,
  'claude-haiku': 0.8,
  haiku: 0.8,
  // Codex / OpenAI-ish
  'codex mini': 0.8,
  codex: 2.5,
  'gpt-5.6': 5.0,
  'gpt-5': 5.0,
  'gpt-4o': 4.0,
  'gpt-4': 5.0,
  o3: 10.0,
  o4: 5.0,
  'o1': 15.0
}

/** Approximate FX: 1 USD → local units. Documented as approximate. */
export const FX_USD_TO: Record<string, number> = {
  USD: 1,
  INR: 83.5,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155,
  AUD: 1.53,
  CAD: 1.37
}

export const SUPPORTED_CURRENCIES = Object.keys(FX_USD_TO)

const SORTED_RATE_KEYS = Object.keys(RATES).sort((a, b) => b.length - a.length)

export function rateForModel(model: string | null | undefined): number {
  const key = (model ?? '').toLowerCase()
  for (const name of SORTED_RATE_KEYS) {
    if (key.includes(name)) return RATES[name]
  }
  return DEFAULT_USD_PER_M
}

export function apiEquivUsd(
  model: string | null | undefined,
  tokensTotal: number | null | undefined
): number | null {
  if (tokensTotal == null || tokensTotal <= 0) return null
  return +((tokensTotal / 1_000_000) * rateForModel(model)).toFixed(4)
}

export function convertFromUsd(amountUsd: number, currency: string): number {
  const rate = FX_USD_TO[currency.toUpperCase()] ?? 1
  return amountUsd * rate
}

export function formatMoneyFromUsd(
  amountUsd: number,
  currency = 'USD',
  locale = 'en-US'
): string {
  const cur = currency.toUpperCase()
  const value = convertFromUsd(amountUsd, cur)
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
