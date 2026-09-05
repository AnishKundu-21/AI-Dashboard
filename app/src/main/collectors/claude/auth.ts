import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeHome } from '../../util/paths'

export interface ClaudeAuth {
  token: string
  expires_at: number | null
  subscription_type: string | null
  /** Which shape the token was found in, for the diagnostics view. */
  shape: string
}

/**
 * Why no token could be read. The distinction matters: a missing file means
 * "log in", while a present file we cannot parse means the CLI changed its
 * format and this app needs updating — telling the user to log in then sends
 * them to fix something that is not broken.
 */
export type ClaudeAuthProblem =
  | { reason: 'missing' }
  | { reason: 'unparseable' }
  | { reason: 'unrecognised'; keys: string[] }

export type ClaudeAuthResult =
  | { ok: true; auth: ClaudeAuth }
  | { ok: false; problem: ClaudeAuthProblem }

function credentialsPath(home: string): string {
  return join(home, '.credentials.json')
}

/**
 * Known locations for the OAuth access token, newest first.
 *
 * Reading several shapes rather than one is deliberate. The single hardcoded
 * `claudeAiOauth.accessToken` path silently stopped matching on a real machine
 * after a CLI update, and the dashboard reported "not connected" for weeks
 * while the credentials sat there intact.
 */
const TOKEN_PATHS: ReadonlyArray<{ shape: string; path: readonly string[] }> = [
  { shape: 'claudeAiOauth', path: ['claudeAiOauth'] },
  { shape: 'claude_ai_oauth', path: ['claude_ai_oauth'] },
  { shape: 'oauth', path: ['oauth'] },
  { shape: 'root', path: [] }
]

const TOKEN_KEYS = ['accessToken', 'access_token', 'token'] as const
const EXPIRY_KEYS = ['expiresAt', 'expires_at', 'expiry'] as const
const SUBSCRIPTION_KEYS = [
  'subscriptionType',
  'subscription_type',
  'subscription',
  'plan'
] as const

export function readClaudeAuthResult(home = getClaudeHome()): ClaudeAuthResult {
  const path = credentialsPath(home)
  if (!existsSync(path)) return { ok: false, problem: { reason: 'missing' } }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return { ok: false, problem: { reason: 'unparseable' } }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, problem: { reason: 'unparseable' } }
  }

  const root = raw as Record<string, unknown>

  for (const candidate of TOKEN_PATHS) {
    const container = resolve(root, candidate.path)
    if (!container) continue
    const token = firstString(container, TOKEN_KEYS)
    if (!token || token.length < 20) continue
    return {
      ok: true,
      auth: {
        token,
        expires_at: firstNumber(container, EXPIRY_KEYS),
        subscription_type: firstString(container, SUBSCRIPTION_KEYS),
        shape: candidate.shape
      }
    }
  }

  // Nothing matched. Report the top-level keys — names only, never values — so
  // the diagnostics view can say what was actually there.
  return {
    ok: false,
    problem: { reason: 'unrecognised', keys: Object.keys(root).slice(0, 12) }
  }
}

/** Back-compatible reader for callers that only need the token or null. */
export function readClaudeAuth(home = getClaudeHome()): ClaudeAuth | null {
  const result = readClaudeAuthResult(home)
  return result.ok ? result.auth : null
}

export function isClaudeTokenExpired(auth: ClaudeAuth, skewMs = 60_000): boolean {
  if (!auth.expires_at) return false
  return Date.now() >= auth.expires_at - skewMs
}

/** A short, user-facing sentence naming the actual problem. */
export function describeClaudeAuthProblem(problem: ClaudeAuthProblem): string {
  switch (problem.reason) {
    case 'missing':
      return 'no ~/.claude/.credentials.json — install Claude Code and log in'
    case 'unparseable':
      return '~/.claude/.credentials.json is present but is not valid JSON'
    case 'unrecognised':
      return `~/.claude/.credentials.json is present but holds no recognised OAuth token (keys: ${
        problem.keys.join(', ') || 'none'
      })`
  }
}

function resolve(
  root: Record<string, unknown>,
  path: readonly string[]
): Record<string, unknown> | null {
  let current: unknown = root
  for (const key of path) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return current && typeof current === 'object'
    ? (current as Record<string, unknown>)
    : null
}

function firstString(
  source: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function firstNumber(
  source: Record<string, unknown>,
  keys: readonly string[]
): number | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    // Some builds write the expiry as an ISO string.
    if (typeof value === 'string') {
      const parsed = Date.parse(value)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return null
}
