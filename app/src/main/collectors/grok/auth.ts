import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getGrokHome } from '../../util/paths'

export interface GrokAuth {
  token: string
  expires_at: string | null
  user_id: string | null
  team_id: string | null
  auth_mode: string | null
}

export function readGrokAuth(home = getGrokHome()): GrokAuth | null {
  const authPath = join(home, 'auth.json')
  if (!existsSync(authPath)) return null

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(authPath, 'utf-8'))
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object') return null

  // Shape: { "https://auth.x.ai::clientId": { key, refresh_token, ... } }
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const entry = value as Record<string, unknown>
    const key = entry.key
    if (typeof key !== 'string' || key.length < 20) continue
    return {
      token: key,
      expires_at: typeof entry.expires_at === 'string' ? entry.expires_at : null,
      user_id: typeof entry.user_id === 'string' ? entry.user_id : null,
      team_id: typeof entry.team_id === 'string' ? entry.team_id : null,
      auth_mode: typeof entry.auth_mode === 'string' ? entry.auth_mode : null
    }
  }
  return null
}

export function isGrokTokenExpired(auth: GrokAuth, skewMs = 60_000): boolean {
  if (!auth.expires_at) return false
  const exp = Date.parse(auth.expires_at)
  if (Number.isNaN(exp)) return false
  return Date.now() >= exp - skewMs
}
