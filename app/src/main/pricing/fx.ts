/**
 * Foreign exchange rates for the display currency.
 *
 * Rates were previously hardcoded constants, which drift silently and then
 * misreport money. They now come from Frankfurter (European Central Bank
 * reference rates, no API key), cached to disk on the same TTL-plus-snapshot
 * pattern as the model rate table.
 *
 * When no rate is available the conversion **refuses** rather than passing the
 * USD figure through: showing a dollar amount behind a rupee sign is worse
 * than showing dollars.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fetchJson } from '../collectors/http'
import { getAppDataDir } from '../util/paths'

export const FX_URL = 'https://api.frankfurter.app/latest?from=USD'

/** ECB publishes once per working day; a day-old table is still correct enough. */
const TTL_MS = 24 * 60 * 60 * 1000
const REFRESH_FLOOR_MS = 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

export type FxStatus = 'fresh' | 'cached' | 'unavailable'

export interface FxInfo {
  status: FxStatus
  source: string
  fetched_at: string | null
  /** The ECB reference date the rates belong to, which lags the fetch. */
  rates_date: string | null
  currencies: string[]
  /**
   * Shipped to the renderer so it converts against the same numbers main did,
   * instead of the second hardcoded table it used to keep.
   */
  rates: Record<string, number>
}

interface FxCacheFile {
  fetched_at_ms: number
  rates_date: string | null
  rates: Record<string, number>
}

/** Always available, always exactly 1. */
const BASE = 'USD'

let rates: Record<string, number> = {}
let ratesDate: string | null = null
let fetchedAtMs: number | null = null
let status: FxStatus = 'unavailable'
let inFlight: Promise<void> | null = null

function cachePath(): string {
  return join(getAppDataDir(), 'fx-rates.json')
}

export function fxInfo(): FxInfo {
  return {
    status,
    source: FX_URL,
    fetched_at: fetchedAtMs === null ? null : new Date(fetchedAtMs).toISOString(),
    rates_date: ratesDate,
    currencies: supportedCurrencies(),
    rates: { [BASE]: 1, ...rates }
  }
}

export function supportedCurrencies(): string[] {
  return [BASE, ...Object.keys(rates).filter((code) => code !== BASE).sort()]
}

export interface Converted {
  value: number
  /** The currency actually used — `USD` when the requested one has no rate. */
  currency: string
  /** True when the requested currency was unavailable and USD was substituted. */
  fell_back: boolean
}

export function convertFromUsd(amountUsd: number, currency: string): Converted {
  const code = currency.toUpperCase()
  if (code === BASE) return { value: amountUsd, currency: BASE, fell_back: false }
  const rate = rates[code]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return { value: amountUsd, currency: BASE, fell_back: true }
  }
  return { value: amountUsd * rate, currency: code, fell_back: false }
}

export function formatMoneyFromUsd(
  amountUsd: number,
  currency = BASE,
  locale = 'en-US'
): string {
  const converted = convertFromUsd(amountUsd, currency)
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: converted.currency,
      maximumFractionDigits: converted.currency === 'JPY' ? 0 : 2
    }).format(converted.value)
  } catch {
    return `$${amountUsd.toFixed(2)}`
  }
}

/** Test seam: install rates without touching the network or disk. */
export function primeFxRates(
  next: Record<string, number>,
  date: string | null = null,
  fetchedAt = Date.now()
): void {
  rates = next
  ratesDate = date
  fetchedAtMs = fetchedAt
  status = 'fresh'
}

export function resetFxForTests(): void {
  rates = {}
  ratesDate = null
  fetchedAtMs = null
  status = 'unavailable'
  inFlight = null
}

export async function ensureFxRates(
  options: { force?: boolean; allowNetwork?: boolean } = {}
): Promise<void> {
  if (inFlight) return inFlight
  inFlight = loadFx(options).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function loadFx(options: {
  force?: boolean
  allowNetwork?: boolean
}): Promise<void> {
  const { force = false, allowNetwork = true } = options
  const now = Date.now()
  const maxAgeMs = force ? REFRESH_FLOOR_MS : TTL_MS
  if (fetchedAtMs !== null && now - fetchedAtMs < maxAgeMs) return

  if (fetchedAtMs === null) {
    const fromDisk = readCache()
    if (fromDisk && Object.keys(fromDisk.rates).length > 0) {
      rates = fromDisk.rates
      ratesDate = fromDisk.rates_date
      fetchedAtMs = fromDisk.fetched_at_ms
      status = 'cached'
      if (now - fromDisk.fetched_at_ms < maxAgeMs) return
    }
  }

  if (!allowNetwork) return

  let body: unknown
  try {
    body = await fetchJson(FX_URL, { timeoutMs: FETCH_TIMEOUT_MS })
  } catch {
    if (Object.keys(rates).length > 0) status = 'cached'
    return
  }

  const parsed = parseFxResponse(body)
  if (!parsed) return

  rates = parsed.rates
  ratesDate = parsed.rates_date
  fetchedAtMs = now
  status = 'fresh'
  writeCache({ fetched_at_ms: now, rates_date: parsed.rates_date, rates: parsed.rates })
}

export function parseFxResponse(
  body: unknown
): { rates: Record<string, number>; rates_date: string | null } | null {
  if (typeof body !== 'object' || body === null) return null
  const root = body as Record<string, unknown>
  if (typeof root.base === 'string' && root.base.toUpperCase() !== BASE) return null
  const raw = root.rates
  if (typeof raw !== 'object' || raw === null) return null

  const out: Record<string, number> = {}
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[code.toUpperCase()] = value
    }
  }
  if (Object.keys(out).length === 0) return null
  return {
    rates: out,
    rates_date: typeof root.date === 'string' ? root.date : null
  }
}

function readCache(): FxCacheFile | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as FxCacheFile
    return typeof parsed?.fetched_at_ms === 'number' && parsed.rates
      ? parsed
      : null
  } catch {
    return null
  }
}

function writeCache(file: FxCacheFile): void {
  try {
    const path = cachePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(file), 'utf-8')
  } catch {
    // Snapshot is a convenience; losing it does not break conversion.
  }
}
