const DEFAULT_TIMEOUT_MS = 15_000
const USER_AGENT = 'ai-usage-dashboard/0.1.0'

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodyPreview: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export async function fetchJson(
  url: string,
  options: {
    headers?: Record<string, string>
    timeoutMs?: number
  } = {}
): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  )

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...options.headers
      },
      signal: controller.signal
    })

    const text = await res.text()
    if (!res.ok) {
      throw new HttpError(
        `HTTP ${res.status} for ${url}`,
        res.status,
        text.slice(0, 200)
      )
    }

    if (!text) return null
    return JSON.parse(text) as unknown
  } finally {
    clearTimeout(timeout)
  }
}
