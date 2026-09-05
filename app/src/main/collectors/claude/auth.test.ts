import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  describeClaudeAuthProblem,
  isClaudeTokenExpired,
  readClaudeAuthResult
} from './auth'

const dirs: string[] = []

function homeWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'claude-auth-'))
  dirs.push(dir)
  if (contents !== null) {
    writeFileSync(join(dir, '.credentials.json'), contents)
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const TOKEN = 'a'.repeat(40)

describe('readClaudeAuthResult', () => {
  it('reads the documented claudeAiOauth shape', () => {
    const result = readClaudeAuthResult(
      homeWith(
        JSON.stringify({
          claudeAiOauth: {
            accessToken: TOKEN,
            expiresAt: 1789000000000,
            subscriptionType: 'max'
          }
        })
      )
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.auth.subscription_type).toBe('max')
    expect(result.auth.expires_at).toBe(1789000000000)
    expect(result.auth.shape).toBe('claudeAiOauth')
  })

  it('reads snake_case and bare-root variants', () => {
    // The single hardcoded path stopped matching on a real machine after a CLI
    // update, and the dashboard reported "not connected" for weeks.
    for (const [shape, body] of [
      ['claude_ai_oauth', { claude_ai_oauth: { access_token: TOKEN } }],
      ['oauth', { oauth: { accessToken: TOKEN } }],
      ['root', { accessToken: TOKEN }]
    ] as const) {
      const result = readClaudeAuthResult(homeWith(JSON.stringify(body)))
      expect(result.ok, shape).toBe(true)
      if (result.ok) expect(result.auth.shape).toBe(shape)
    }
  })

  it('accepts an ISO expiry as well as epoch milliseconds', () => {
    const result = readClaudeAuthResult(
      homeWith(
        JSON.stringify({
          claudeAiOauth: { accessToken: TOKEN, expiresAt: '2026-09-05T10:00:00Z' }
        })
      )
    )
    expect(result.ok && result.auth.expires_at).toBe(
      Date.parse('2026-09-05T10:00:00Z')
    )
  })

  it('distinguishes a missing file from an unrecognised one', () => {
    const missing = readClaudeAuthResult(homeWith(null))
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.problem.reason).toBe('missing')

    const unrecognised = readClaudeAuthResult(
      homeWith(JSON.stringify({ somethingNew: { token: 'short' } }))
    )
    expect(unrecognised.ok).toBe(false)
    if (!unrecognised.ok) {
      expect(unrecognised.problem.reason).toBe('unrecognised')
      // Key names only — a value here would be the token itself.
      expect(unrecognised.problem).toMatchObject({ keys: ['somethingNew'] })
    }
  })

  it('reports invalid JSON as unparseable, not missing', () => {
    const result = readClaudeAuthResult(homeWith('{not json'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.reason).toBe('unparseable')
  })

  it('rejects a token too short to be real', () => {
    const result = readClaudeAuthResult(
      homeWith(JSON.stringify({ claudeAiOauth: { accessToken: 'abc' } }))
    )
    expect(result.ok).toBe(false)
  })
})

describe('describeClaudeAuthProblem', () => {
  it('names the real problem rather than telling the user to log in', () => {
    expect(describeClaudeAuthProblem({ reason: 'missing' })).toContain('log in')
    const unrecognised = describeClaudeAuthProblem({
      reason: 'unrecognised',
      keys: ['somethingNew']
    })
    expect(unrecognised).toContain('no recognised OAuth token')
    expect(unrecognised).toContain('somethingNew')
    expect(unrecognised).not.toContain('log in')
  })
})

describe('isClaudeTokenExpired', () => {
  it('treats a missing expiry as not expired', () => {
    expect(
      isClaudeTokenExpired({
        token: TOKEN,
        expires_at: null,
        subscription_type: null,
        shape: 'root'
      })
    ).toBe(false)
  })

  it('expires early by the skew so a refresh happens in time', () => {
    expect(
      isClaudeTokenExpired({
        token: TOKEN,
        expires_at: Date.now() + 30_000,
        subscription_type: null,
        shape: 'root'
      })
    ).toBe(true)
  })
})
