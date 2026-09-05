/**
 * The process-wide transcript scan cache.
 *
 * One cache is shared by every provider — entries are keyed by absolute path,
 * so there is nothing to keep apart — and it is loaded once at startup and
 * flushed after scans rather than on every file, since a busy coding session
 * fires the watchers several times a minute.
 */
import {
  loadScanCache,
  pruneScanCache,
  saveScanCache,
  type ScanCache
} from './scanCache'

let cache: ScanCache | null = null
let dirtySince = 0

/** Flush at most this often; the cache is a rebuild-able optimisation. */
const FLUSH_INTERVAL_MS = 60_000

export function getScanCache(): ScanCache {
  if (!cache) cache = loadScanCache()
  return cache
}

export function markScanCacheDirty(): void {
  if (dirtySince === 0) dirtySince = Date.now()
}

/** Writes the cache if it has been dirty long enough, or when `force` is set. */
export function flushScanCache(force = false): void {
  if (!cache || dirtySince === 0) return
  if (!force && Date.now() - dirtySince < FLUSH_INTERVAL_MS) return
  pruneScanCache(cache)
  saveScanCache(cache)
  dirtySince = 0
}

export function resetScanCacheForTests(): void {
  cache = null
  dirtySince = 0
}
