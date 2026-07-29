/** Strip JWT / API-key shaped strings and emails from logs and summaries. */

const JWT_RE =
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi
const API_KEY_RE = /\b(sk-|xai-|api[_-]?key[=:\s]+)[A-Za-z0-9_-]{16,}/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export function redactText(input: string): string {
  return input
    .replace(JWT_RE, '[REDACTED_JWT]')
    .replace(BEARER_RE, 'Bearer [REDACTED]')
    .replace(API_KEY_RE, '$1[REDACTED]')
    .replace(EMAIL_RE, (m) => maskEmail(m))
}

function maskEmail(email: string): string {
  const [user, domain] = email.split('@')
  if (!user || !domain) return '[REDACTED_EMAIL]'
  const head = user.slice(0, 2)
  return `${head}***@${domain}`
}

export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redactText(value) as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as T
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase()
      if (
        lower.includes('token') ||
        lower.includes('password') ||
        lower === 'key' ||
        lower.includes('secret') ||
        lower.includes('authorization')
      ) {
        out[k] = '[REDACTED]'
      } else {
        out[k] = redactDeep(v)
      }
    }
    return out as T
  }
  return value
}
