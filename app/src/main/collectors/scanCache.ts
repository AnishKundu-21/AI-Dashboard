/**
 * Per-file transcript scan cache.
 *
 * Transcripts are append-only, so a file whose size and mtime are unchanged
 * can never yield different usage and is served straight from the cache. A
 * file that merely *grew* resumes from the byte offset the last parse stopped
 * at, so only the appended bytes are read.
 *
 * This is what makes it safe to scan a whole history rather than the newest N
 * files: the previous collectors read every candidate file in full on every
 * scan, and the file-watchers fire constantly during active coding, so the
 * caps existed to bound work that should not have been repeated at all.
 *
 * Caching per *file* rather than per day is deliberate: it is timezone
 * independent, so changing the reporting zone invalidates nothing.
 */
import { closeSync, openSync, readSync, statSync } from 'fs'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getAppDataDir } from '../util/paths'
import type { ProviderId } from '../../shared/providers'
import type { UsageEvent } from '../../shared/types'

/**
 * Bumped when a parser change alters what a file parses to — stale entries
 * would otherwise keep serving the old, wrong records forever.
 *
 * v1: initial event-grain cache (canonical token classes, fork suppression,
 *     message/request de-duplication).
 */
export const SCAN_CACHE_VERSION = 1

/** Bytes before the resume offset that are re-read to prove the file only grew. */
const GUARD_LENGTH = 256

export interface ParsePosition {
  /** Byte offset just past the last newline consumed. */
  resume_offset: number
  guard_length: number
  guard_hash: number
}

export interface CachedFile<S> {
  size: number
  mtime_ms: number
  provider: ProviderId
  /** Events from complete, newline-terminated lines up to `position.resume_offset`. */
  events: UsageEvent[]
  /**
   * Events from a trailing segment the writer had not newline-terminated when
   * it was parsed. Held apart because an incremental parse re-reads that
   * segment; merging them would double count.
   */
  tail_events: UsageEvent[]
  /** Per-file facts the caller folds in (session metadata, durations). */
  facts: unknown
  /** Reducer state at `resume_offset`, for parsers that carry one. */
  state: S | null
  position: ParsePosition
}

export type ScanCache = Map<string, CachedFile<unknown>>

/** FNV-1a. Only needs to detect rewrites, not resist an adversary. */
export function hashBytes(buffer: Buffer): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < buffer.length; index++) {
    hash ^= buffer[index]
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export interface ParseChunk<S> {
  /** Text to parse: the whole file, or only the appended bytes on a resume. */
  text: string
  /** Byte offset `text` begins at. */
  start_offset: number
  /** Reducer state to continue from, or null for a cold parse. */
  state: S | null
}

export interface ParseOutput<S> {
  events: UsageEvent[]
  tail_events: UsageEvent[]
  facts: unknown
  state: S | null
  /** Bytes consumed within `text`, up to and including the last newline. */
  consumed: number
}

export interface ReadResult {
  events: UsageEvent[]
  facts: unknown
  /** True when the file was parsed rather than served from cache. */
  parsed: boolean
}

/**
 * Reads one transcript, reusing whatever the cache can prove is still valid.
 *
 * `parse` receives either the whole file or only the appended tail, and must
 * report how many bytes it consumed so the next resume starts on a line
 * boundary.
 */
export function readCached<S>(
  cache: ScanCache,
  path: string,
  provider: ProviderId,
  parse: (chunk: ParseChunk<S>) => ParseOutput<S>
): ReadResult | null {
  let stat: ReturnType<typeof statSync>
  try {
    stat = statSync(path)
  } catch {
    return null
  }

  const previous = cache.get(path) as CachedFile<S> | undefined
  if (
    previous &&
    previous.size === stat.size &&
    previous.mtime_ms === stat.mtimeMs &&
    previous.provider === provider
  ) {
    return {
      events: [...previous.events, ...previous.tail_events],
      facts: previous.facts,
      parsed: false
    }
  }

  const resumable =
    previous !== undefined &&
    previous.provider === provider &&
    stat.size > previous.size &&
    previous.position.resume_offset > 0 &&
    guardMatches(path, previous.position)

  try {
    if (resumable && previous) {
      const appended = readRange(path, previous.position.resume_offset, stat.size)
      const output = parse({
        text: appended,
        start_offset: previous.position.resume_offset,
        state: previous.state
      })
      const events = [...previous.events, ...output.events]
      const entry: CachedFile<S> = {
        size: stat.size,
        mtime_ms: stat.mtimeMs,
        provider,
        events,
        tail_events: output.tail_events,
        facts: output.facts ?? previous.facts,
        state: output.state,
        position: makePosition(
          path,
          previous.position.resume_offset + output.consumed
        )
      }
      cache.set(path, entry as CachedFile<unknown>)
      return {
        events: [...events, ...output.tail_events],
        facts: entry.facts,
        parsed: true
      }
    }

    // Cold, rewritten, or truncated: parse the whole thing.
    const text = readFileSync(path, 'utf-8')
    const output = parse({ text, start_offset: 0, state: null })
    const entry: CachedFile<S> = {
      size: stat.size,
      mtime_ms: stat.mtimeMs,
      provider,
      events: output.events,
      tail_events: output.tail_events,
      facts: output.facts,
      state: output.state,
      position: makePosition(path, output.consumed)
    }
    cache.set(path, entry as CachedFile<unknown>)
    return {
      events: [...output.events, ...output.tail_events],
      facts: output.facts,
      parsed: true
    }
  } catch {
    cache.delete(path)
    return null
  }
}

function makePosition(path: string, resumeOffset: number): ParsePosition {
  if (resumeOffset <= 0) {
    return { resume_offset: 0, guard_length: 0, guard_hash: 0 }
  }
  const guardLength = Math.min(GUARD_LENGTH, resumeOffset)
  const guard = readBuffer(path, resumeOffset - guardLength, guardLength)
  return {
    resume_offset: resumeOffset,
    guard_length: guardLength,
    guard_hash: guard ? hashBytes(guard) : 0
  }
}

/** Proves the bytes before the resume point are unchanged, i.e. only appended to. */
function guardMatches(path: string, position: ParsePosition): boolean {
  if (position.guard_length === 0) return false
  const guard = readBuffer(
    path,
    position.resume_offset - position.guard_length,
    position.guard_length
  )
  return guard !== null && hashBytes(guard) === position.guard_hash
}

function readBuffer(path: string, start: number, length: number): Buffer | null {
  if (length <= 0 || start < 0) return null
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.allocUnsafe(length)
    const read = readSync(fd, buffer, 0, length, start)
    return read === length ? buffer : null
  } catch {
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

function readRange(path: string, start: number, end: number): string {
  const buffer = readBuffer(path, start, Math.max(0, end - start))
  return buffer ? buffer.toString('utf-8') : ''
}

/**
 * Splits `text` into complete lines plus whatever trailed the last newline,
 * and reports the byte count the complete lines occupied.
 */
export function splitLines(text: string): {
  lines: string[]
  tail: string
  consumed: number
} {
  const lastNewline = text.lastIndexOf('\n')
  if (lastNewline < 0) {
    return { lines: [], tail: text, consumed: 0 }
  }
  const complete = text.slice(0, lastNewline + 1)
  return {
    lines: complete.split('\n').filter((line) => line.length > 0),
    tail: text.slice(lastNewline + 1),
    consumed: Buffer.byteLength(complete, 'utf-8')
  }
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

interface CacheFile {
  version: number
  entries: Record<string, CachedFile<unknown>>
}

function cachePath(): string {
  return join(getAppDataDir(), 'scan-cache.json')
}

/**
 * Loads the cache written by a previous run. Without this every app start
 * re-parses the whole history, which is the expensive case the cache exists
 * to avoid.
 */
export function loadScanCache(path = cachePath()): ScanCache {
  if (!existsSync(path)) return new Map()
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CacheFile
    if (parsed?.version !== SCAN_CACHE_VERSION) return new Map()
    return new Map(Object.entries(parsed.entries ?? {}))
  } catch {
    return new Map()
  }
}

export function saveScanCache(cache: ScanCache, path = cachePath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const file: CacheFile = {
      version: SCAN_CACHE_VERSION,
      entries: Object.fromEntries(cache)
    }
    writeFileSync(path, JSON.stringify(file), 'utf-8')
  } catch {
    // Losing the snapshot costs a cold scan next launch, nothing more.
  }
}

/** Forgets entries for files that no longer exist, so the cache cannot grow forever. */
export function pruneScanCache(cache: ScanCache): number {
  let removed = 0
  for (const path of [...cache.keys()]) {
    if (!existsSync(path)) {
      cache.delete(path)
      removed++
    }
  }
  return removed
}
