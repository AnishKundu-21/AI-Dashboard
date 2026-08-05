import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getClaudeHome } from '../../util/paths'

export interface ClaudeAuth {
  token: string
  expires_at: number | null
  subscription_type: string | null
}

export function readClaudeAuth(home = getClaudeHome()): ClaudeAuth | null {
  const authPath = join(home, '.credentials.json')
  if (!existsSync(authPath)) return null

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(authPath, 'utf-8'))
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object') return null
  const oauth = (raw as Record<string, unknown>).claudeAiOauth
  if (!oauth || typeof oauth !== 'object') return null
  const o = oauth as Record<string, unknown>

  const token = o.accessToken
  if (typeof token !== 'string' || token.length < 20) return null

  return {
    token,
    expires_at: typeof o.expiresAt === 'number' ? o.expiresAt : null,
    subscription_type:
      typeof o.subscriptionType === 'string' ? o.subscriptionType : null
  }
}

export function isClaudeTokenExpired(auth: ClaudeAuth, skewMs = 60_000): boolean {
  if (!auth.expires_at) return false
  return Date.now() >= auth.expires_at - skewMs
}
