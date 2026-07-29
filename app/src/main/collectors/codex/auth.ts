import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getCodexHome } from '../../util/paths'

export interface CodexAuth {
  access_token: string
  account_id: string | null
  auth_mode: string | null
  last_refresh: string | null
}

export function readCodexAuth(home = getCodexHome()): CodexAuth | null {
  const authPath = join(home, 'auth.json')
  if (!existsSync(authPath)) return null

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(authPath, 'utf-8'))
  } catch {
    return null
  }

  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const tokens = root.tokens
  if (!tokens || typeof tokens !== 'object') return null
  const t = tokens as Record<string, unknown>
  const access = t.access_token
  if (typeof access !== 'string' || access.length < 20) return null

  return {
    access_token: access,
    account_id: typeof t.account_id === 'string' ? t.account_id : null,
    auth_mode: typeof root.auth_mode === 'string' ? root.auth_mode : null,
    last_refresh:
      typeof root.last_refresh === 'string' ? root.last_refresh : null
  }
}
