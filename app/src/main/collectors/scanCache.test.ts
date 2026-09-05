import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadScanCache,
  pruneScanCache,
  readCached,
  saveScanCache,
  splitLines,
  type ParseChunk,
  type ParseOutput,
  type ScanCache
} from './scanCache'
import type { UsageEvent } from '../../shared/types'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scan-cache-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function event(id: string): UsageEvent {
  return {
    dedupe_key: id,
    provider: 'claude',
    session_id: 's1',
    project: 'demo',
    model: 'claude-sonnet-4-5-20250929',
    ts_ms: 1_782_000_000_000,
    tokens: {
      uncached_input: 1,
      cached_input: 0,
      cache_creation: 0,
      output: 1,
      reasoning: 0
    },
    reported_cost_usd: null,
    source: 'test'
  }
}

/** Counts parse calls so the tests can assert the cache actually saved work. */
function makeParser(): {
  parse: (chunk: ParseChunk<null>) => ParseOutput<null>
  calls: () => number
  bytesSeen: () => number
} {
  let calls = 0
  let bytesSeen = 0
  return {
    calls: () => calls,
    bytesSeen: () => bytesSeen,
    parse: (chunk) => {
      calls++
      bytesSeen += Buffer.byteLength(chunk.text, 'utf-8')
      const split = splitLines(chunk.text)
      return {
        events: split.lines.map((line) => event(line.trim())),
        tail_events: split.tail.trim() ? [event(`tail:${split.tail.trim()}`)] : [],
        facts: { lines: split.lines.length },
        state: null,
        consumed: split.consumed
      }
    }
  }
}

describe('splitLines', () => {
  it('separates complete lines from an unterminated tail', () => {
    const split = splitLines('a\nb\nc')
    expect(split.lines).toEqual(['a', 'b'])
    expect(split.tail).toBe('c')
    expect(split.consumed).toBe(4)
  })

  it('consumes nothing when no newline has been written yet', () => {
    expect(splitLines('partial')).toEqual({
      lines: [],
      tail: 'partial',
      consumed: 0
    })
  })

  it('counts bytes, not characters, so offsets survive non-ASCII content', () => {
    expect(splitLines('é\n').consumed).toBe(3)
  })
})

describe('readCached', () => {
  it('serves an unchanged file without re-parsing it', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\ntwo\n')
    const cache: ScanCache = new Map()
    const parser = makeParser()

    const first = readCached(cache, path, 'claude', parser.parse)
    const second = readCached(cache, path, 'claude', parser.parse)

    expect(parser.calls()).toBe(1)
    expect(first?.parsed).toBe(true)
    expect(second?.parsed).toBe(false)
    expect(second?.events.map((e) => e.dedupe_key)).toEqual(['one', 'two'])
  })

  it('reads only the appended bytes when a file grows', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\ntwo\n')
    const cache: ScanCache = new Map()
    const parser = makeParser()

    readCached(cache, path, 'claude', parser.parse)
    const bytesAfterCold = parser.bytesSeen()
    appendFileSync(path, 'three\n')
    const result = readCached(cache, path, 'claude', parser.parse)

    expect(result?.events.map((e) => e.dedupe_key)).toEqual(['one', 'two', 'three'])
    // The resume read six bytes, not the whole fourteen-byte file again.
    expect(parser.bytesSeen() - bytesAfterCold).toBe(6)
  })

  it('re-parses in full when earlier bytes changed', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\ntwo\n')
    const cache: ScanCache = new Map()
    const parser = makeParser()

    readCached(cache, path, 'claude', parser.parse)
    // A rewrite that happens to be longer must not be mistaken for an append.
    writeFileSync(path, 'ONE\nTWO\nthree\n')
    const result = readCached(cache, path, 'claude', parser.parse)

    expect(result?.events.map((e) => e.dedupe_key)).toEqual(['ONE', 'TWO', 'three'])
  })

  it('re-parses when a file shrinks', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\ntwo\nthree\n')
    const cache: ScanCache = new Map()
    const parser = makeParser()

    readCached(cache, path, 'claude', parser.parse)
    writeFileSync(path, 'one\n')
    const result = readCached(cache, path, 'claude', parser.parse)

    expect(result?.events.map((e) => e.dedupe_key)).toEqual(['one'])
  })

  it('does not double count a tail that later gets its newline', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\npartial')
    const cache: ScanCache = new Map()
    const parser = makeParser()

    const first = readCached(cache, path, 'claude', parser.parse)
    expect(first?.events.map((e) => e.dedupe_key)).toEqual(['one', 'tail:partial'])

    appendFileSync(path, '\n')
    const second = readCached(cache, path, 'claude', parser.parse)
    expect(second?.events.map((e) => e.dedupe_key)).toEqual(['one', 'partial'])
  })

  it('returns null for a file it cannot stat', () => {
    expect(
      readCached(new Map(), join(tempDir(), 'missing.jsonl'), 'claude', makeParser().parse)
    ).toBeNull()
  })
})

describe('persistence', () => {
  it('round-trips through disk so a restart does not rescan', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    const cachePath = join(dir, 'scan-cache.json')
    writeFileSync(path, 'one\ntwo\n')

    const cache: ScanCache = new Map()
    const parser = makeParser()
    readCached(cache, path, 'claude', parser.parse)
    saveScanCache(cache, cachePath)

    const reloaded = loadScanCache(cachePath)
    const result = readCached(reloaded, path, 'claude', parser.parse)
    expect(result?.parsed).toBe(false)
    expect(parser.calls()).toBe(1)
  })

  it('discards a cache written by a different parser version', () => {
    const dir = tempDir()
    const cachePath = join(dir, 'scan-cache.json')
    writeFileSync(cachePath, JSON.stringify({ version: 0, entries: { a: {} } }))
    expect(loadScanCache(cachePath).size).toBe(0)
  })

  it('returns an empty cache for a corrupt file', () => {
    const dir = tempDir()
    const cachePath = join(dir, 'scan-cache.json')
    writeFileSync(cachePath, '{not json')
    expect(loadScanCache(cachePath).size).toBe(0)
  })

  it('prunes entries whose transcript is gone', () => {
    const dir = tempDir()
    const path = join(dir, 'a.jsonl')
    writeFileSync(path, 'one\n')
    const cache: ScanCache = new Map()
    readCached(cache, path, 'claude', makeParser().parse)
    rmSync(path)

    expect(pruneScanCache(cache)).toBe(1)
    expect(cache.size).toBe(0)
  })
})
