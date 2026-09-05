/**
 * A long-lived `codex app-server` child, spoken to over stdio JSON-RPC.
 *
 * This is Codex's own local protocol — the one its desktop client uses — so it
 * needs no scraped bearer token, refreshes auth itself, and returns strictly
 * more than the private `wham/usage` HTTP endpoint did: both windows with their
 * real durations, the plan, reset credits with titles and expiry, and the
 * account id.
 *
 * The process is kept alive rather than spawned per poll: startup costs about a
 * second, and the quota loop runs every 15-60s. It is respawned on exit and
 * killed when the app quits.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

/** A probe must never wedge the collector loop. */
const REQUEST_TIMEOUT_MS = 20_000

/** After this many consecutive spawn failures, stop trying until a reset. */
const MAX_CONSECUTIVE_FAILURES = 3

export interface AppServerError {
  kind: 'spawn_failed' | 'exited' | 'timeout' | 'rpc_error' | 'disabled'
  message: string
}

export class AppServerFailure extends Error {
  constructor(readonly detail: AppServerError) {
    super(detail.message)
    this.name = 'AppServerFailure'
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: AppServerFailure) => void
  timer: NodeJS.Timeout
}

let child: ChildProcessWithoutNullStreams | null = null
let starting: Promise<void> | null = null
let buffer = ''
let nextId = 1
let consecutiveFailures = 0
const pending = new Map<number, Pending>()

/** Overridable so tests can point at a stub instead of the real binary. */
let command = process.env.CODEX_BIN || 'codex'

export function setCodexCommandForTests(next: string): void {
  command = next
}

export function resetAppServerForTests(): void {
  stopAppServer()
  consecutiveFailures = 0
  command = process.env.CODEX_BIN || 'codex'
}

export function stopAppServer(): void {
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(new AppServerFailure({ kind: 'exited', message: 'app-server stopped' }))
  }
  pending.clear()
  if (child) {
    child.removeAllListeners()
    child.kill()
    child = null
  }
  starting = null
  buffer = ''
}

function handleLine(line: string): void {
  if (!line.trim()) return
  let message: { id?: number; result?: unknown; error?: { message?: string } }
  try {
    message = JSON.parse(line)
  } catch {
    // The server also writes human-readable diagnostics; ignore non-JSON.
    return
  }
  if (typeof message.id !== 'number') return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  clearTimeout(entry.timer)
  if (message.error) {
    entry.reject(
      new AppServerFailure({
        kind: 'rpc_error',
        message: message.error.message ?? 'app-server returned an error'
      })
    )
    return
  }
  entry.resolve(message.result)
}

function onExit(): void {
  const failure = new AppServerFailure({
    kind: 'exited',
    message: 'codex app-server exited'
  })
  for (const [, entry] of pending) {
    clearTimeout(entry.timer)
    entry.reject(failure)
  }
  pending.clear()
  child = null
  starting = null
  buffer = ''
}

async function ensureStarted(): Promise<void> {
  if (child) return
  if (starting) return starting
  if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    throw new AppServerFailure({
      kind: 'disabled',
      message: 'codex app-server unavailable; using the HTTP fallback'
    })
  }

  starting = new Promise<void>((resolve, reject) => {
    let spawned: ChildProcessWithoutNullStreams
    try {
      spawned = spawn(command, ['app-server'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (error) {
      consecutiveFailures++
      reject(
        new AppServerFailure({
          kind: 'spawn_failed',
          message: error instanceof Error ? error.message : 'spawn failed'
        })
      )
      return
    }

    spawned.on('error', (error) => {
      consecutiveFailures++
      child = null
      starting = null
      reject(
        new AppServerFailure({ kind: 'spawn_failed', message: error.message })
      )
    })
    spawned.on('exit', onExit)
    spawned.stdout.setEncoding('utf-8')
    spawned.stdout.on('data', (chunk: string) => {
      buffer += chunk
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        handleLine(line)
      }
    })
    // Drained so the pipe cannot fill and block the child.
    spawned.stderr.resume()

    child = spawned
    resolve()
  })

  try {
    await starting
  } finally {
    starting = null
  }

  // The protocol requires an initialize round trip before any other method.
  await request('initialize', {
    clientInfo: {
      name: 'ai-usage-dashboard',
      title: 'AI Usage Dashboard',
      version: '0.1.0'
    }
  })
  notify('initialized')
  consecutiveFailures = 0
}

function notify(method: string): void {
  child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`)
}

function request(method: string, params: unknown): Promise<unknown> {
  const active = child
  if (!active) {
    return Promise.reject(
      new AppServerFailure({ kind: 'exited', message: 'app-server not running' })
    )
  }
  const id = nextId++
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(
        new AppServerFailure({
          kind: 'timeout',
          message: `codex app-server did not answer ${method} in time`
        })
      )
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    active.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    )
  })
}

/**
 * Reads the account's rate limits.
 *
 * Throws `AppServerFailure` rather than returning a partial answer, so the
 * caller can decide between falling back and reporting the probe as failed.
 */
export async function readRateLimits(): Promise<unknown> {
  await ensureStarted()
  return request('account/rateLimits/read', {})
}
