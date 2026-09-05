/**
 * The model rate table, fetched and cached.
 *
 * Rates live upstream in LiteLLM rather than in this repo so a model released
 * after the last build is still priced. The document is snapshotted to disk,
 * so a machine that is offline — or one whose user turned network refresh off
 * — keeps pricing against the last table it saw instead of reporting every
 * session as unpriced.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fetchJson } from '../collectors/http'
import { getAppDataDir } from '../util/paths'
import {
  EMPTY_RATE_TABLE,
  createOverrideRateTable,
  lookupRate,
  parseRateTable,
  type ModelPriceOverride,
  type ModelRate,
  type RateTable
} from './rateTable'

export const RATES_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

/** Rates move rarely; a day-old table keeps the dashboard working offline. */
const TTL_MS = 24 * 60 * 60 * 1000

/** An explicit refresh ignores the TTL, but not a table fetched this recently. */
const REFRESH_FLOOR_MS = 60 * 1000

const FETCH_TIMEOUT_MS = 10_000

export type PricingStatus = 'fresh' | 'cached' | 'unavailable'

export interface PricingInfo {
  status: PricingStatus
  source: string
  /** When the *document* was fetched, not when it was last read from disk. */
  fetched_at: string | null
  known_models: number
}

interface RatesCacheFile {
  fetched_at_ms: number
  document: unknown
}

let table: RateTable = EMPTY_RATE_TABLE
let overrides: RateTable = EMPTY_RATE_TABLE
let fetchedAtMs: number | null = null
let status: PricingStatus = 'unavailable'
let inFlight: Promise<void> | null = null

function cachePath(): string {
  return join(getAppDataDir(), 'model-rates.json')
}

export function pricingInfo(): PricingInfo {
  return {
    status,
    source: RATES_URL,
    fetched_at: fetchedAtMs === null ? null : new Date(fetchedAtMs).toISOString(),
    known_models: table.size
  }
}

/** Replaces the user's per-model price overrides. Cheap; call on every settings change. */
export function setPriceOverrides(
  next: Record<string, ModelPriceOverride> | undefined
): void {
  overrides = next ? createOverrideRateTable(next) : EMPTY_RATE_TABLE
}

export function rateForModel(model: string | null | undefined): ModelRate | null {
  return lookupRate(model, table, overrides)
}

/** Test seam: load a table without touching the network or disk. */
export function primeRateTable(document: unknown, fetchedAt = Date.now()): void {
  const parsed = parseRateTable(document)
  if (parsed.size === 0) return
  table = parsed
  fetchedAtMs = fetchedAt
  status = 'fresh'
}

export function resetPricingForTests(): void {
  table = EMPTY_RATE_TABLE
  overrides = EMPTY_RATE_TABLE
  fetchedAtMs = null
  status = 'unavailable'
  inFlight = null
}

/**
 * Ensures a usable table, preferring a fresh copy and falling back to the
 * on-disk snapshot.
 *
 * `allowNetwork` is the user's `network_quota_refresh` setting: with it off the
 * disk snapshot is still loaded, because reading a file the app already wrote
 * is not a network call.
 *
 * Concurrent callers share one fetch — a burst of collector scans on startup
 * would otherwise each pull the same multi-megabyte document.
 */
export async function ensureRates(
  options: { force?: boolean; allowNetwork?: boolean } = {}
): Promise<void> {
  if (inFlight) return inFlight
  inFlight = loadRates(options).finally(() => {
    inFlight = null
  })
  return inFlight
}

async function loadRates(options: {
  force?: boolean
  allowNetwork?: boolean
}): Promise<void> {
  const { force = false, allowNetwork = true } = options
  const now = Date.now()
  const maxAgeMs = force ? REFRESH_FLOOR_MS : TTL_MS
  if (fetchedAtMs !== null && now - fetchedAtMs < maxAgeMs) return

  if (fetchedAtMs === null) {
    const fromDisk = readCache()
    if (fromDisk) {
      const parsed = parseRateTable(fromDisk.document)
      if (parsed.size > 0) {
        table = parsed
        fetchedAtMs = fromDisk.fetched_at_ms
        status = 'cached'
        if (now - fromDisk.fetched_at_ms < maxAgeMs) return
      }
    }
  }

  if (!allowNetwork) return

  let document: unknown
  try {
    document = await fetchJson(RATES_URL, { timeoutMs: FETCH_TIMEOUT_MS })
  } catch {
    // Whatever is being served is now past its TTL and must stop claiming
    // to be fresh, but it is still better than pricing nothing.
    if (table.size > 0) status = 'cached'
    return
  }

  const parsed = parseRateTable(document)
  if (parsed.size === 0) return

  table = parsed
  fetchedAtMs = now
  status = 'fresh'
  writeCache({ fetched_at_ms: now, document })
}

function readCache(): RatesCacheFile | null {
  const path = cachePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RatesCacheFile
    return typeof parsed?.fetched_at_ms === 'number' ? parsed : null
  } catch {
    return null
  }
}

function writeCache(file: RatesCacheFile): void {
  try {
    const path = cachePath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(file), 'utf-8')
  } catch {
    // A read-only app dir costs the snapshot, not the running table.
  }
}
