import type { DailyUsagePoint } from '@shared/types'
import { PROVIDER_META, type ProviderId } from '@shared/providers'

const COLORS: Record<ProviderId, string> = {
  grok: PROVIDER_META.grok.color,
  claude: PROVIDER_META.claude.color,
  codex: PROVIDER_META.codex.color
}

export function DailyChart({
  data,
  selectedDay,
  onSelectDay
}: {
  data: DailyUsagePoint[]
  selectedDay?: string
  onSelectDay?: (day: string) => void
}) {
  const days = Array.from(new Set(data.map((d) => d.day))).sort()
  const providers = Array.from(new Set(data.map((d) => d.provider))) as ProviderId[]

  if (days.length === 0) {
    return (
      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 24 }}>
        No daily usage yet.
      </div>
    )
  }

  const byDayProvider = new Map<string, number>()
  for (const d of data) {
    byDayProvider.set(`${d.day}:${d.provider}`, d.tokens_total)
  }

  const dayTotals = days.map((day) =>
    providers.reduce((s, p) => s + (byDayProvider.get(`${day}:${p}`) ?? 0), 0)
  )
  const max = Math.max(...dayTotals, 1)

  const W = 620
  const H = 240
  const padL = 44
  const padR = 12
  const padT = 16
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const barGroupW = plotW / days.length
  const barW = Math.max(0.6, (barGroupW * 0.7) / Math.max(providers.length, 1))
  const labelStep = Math.max(1, Math.ceil(days.length / 7))

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        {providers.map((p) => (
          <span key={p}>
            <i style={{ background: COLORS[p] }} />
            {PROVIDER_META[p].short}
          </span>
        ))}
      </div>
      <svg className="svg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily token usage">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * (1 - t)
          return (
            <g key={t}>
              <line className="grid" x1={padL} x2={W - padR} y1={y} y2={y} />
              <text x={padL - 6} y={y + 3} textAnchor="end">
                {t === 0 ? '0' : formatAxis(max * t)}
              </text>
            </g>
          )
        })}
        {days.map((day, di) =>
          providers.map((p, pi) => {
            const v = byDayProvider.get(`${day}:${p}`) ?? 0
            const h = (v / max) * plotH
            const x =
              padL +
              di * barGroupW +
              (barGroupW - providers.length * barW) / 2 +
              pi * barW
            const y = padT + plotH - h
            return (
              <rect
                key={`${day}-${p}`}
                x={x}
                y={y}
                width={Math.max(0.5, barW - 0.25)}
                height={Math.max(h, 0)}
                fill={COLORS[p]}
                opacity={selectedDay && selectedDay !== day ? 0.3 : 0.85}
                rx={days.length <= 60 ? 2 : 0}
                style={{ cursor: onSelectDay ? 'pointer' : 'default' }}
                onClick={() => onSelectDay?.(day)}
              />
            )
          })
        )}
        {days.map((day, di) => {
          if (di % labelStep !== 0 && di !== days.length - 1) return null
          const x = padL + di * barGroupW + barGroupW / 2
          return (
            <text key={day} x={x} y={H - 8} textAnchor="middle">
              {day.slice(5)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function formatAxis(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.round(n))
}
