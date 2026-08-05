import { useMemo, useState } from 'react'
import type { DailyUsagePoint } from '@shared/types'
import { PROVIDER_META, PROVIDER_IDS, type ProviderId } from '@shared/providers'
import { barPath, compact, niceMax, tickValues, shortDay, weekdayLabel } from '../lib/chart'
import { useChartHover, useElementWidth, usePrefersReducedMotion } from '../lib/hooks'
import { formatCurrency } from '../lib/format'

export type DailyMetric = 'tokens' | 'cost' | 'sessions'

interface Props {
  data: DailyUsagePoint[]
  metric: DailyMetric
  selectedDay?: string
  onSelectDay?: (day: string) => void
  currency: string
  locale: string
}

const H = 260

/** Axis gutters shrink on narrow cards so the plot keeps usable width. */
function padsFor(width: number) {
  const tight = width < 440
  return { l: tight ? 36 : 54, r: tight ? 10 : 16, t: 12, b: 26 }
}

/** Stacked daily usage. Hover reads out the column; click filters to that day. */
export function DailyChart({
  data,
  metric,
  selectedDay,
  onSelectDay,
  currency,
  locale
}: Props) {
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(760)
  const [hidden, setHidden] = useState<Set<ProviderId>>(new Set())

  const W = Math.max(240, Math.round(wrapWidth))
  const PAD = padsFor(W)
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const { days, providers, cell, max, totals } = useMemo(() => {
    const read = (d: DailyUsagePoint) =>
      metric === 'cost' ? d.api_equiv_usd : metric === 'sessions' ? d.session_count : d.tokens_total
    const dayList = Array.from(new Set(data.map((d) => d.day))).sort()
    const present = PROVIDER_IDS.filter((p) => data.some((d) => d.provider === p))
    const map = new Map<string, number>()
    for (const d of data) {
      map.set(`${d.day}:${d.provider}`, (map.get(`${d.day}:${d.provider}`) ?? 0) + read(d))
    }
    const shown = present.filter((p) => !hidden.has(p))
    const sums = dayList.map((day) => shown.reduce((s, p) => s + (map.get(`${day}:${p}`) ?? 0), 0))
    return {
      days: dayList,
      providers: present,
      cell: map,
      max: niceMax(Math.max(...sums, 0)),
      totals: sums
    }
  }, [data, metric, hidden])

  const visible = providers.filter((p) => !hidden.has(p))
  const { probe, onMove, onLeave } = useChartHover(days.length, W, PAD.l, PAD.r)

  const fmt = (n: number) => (metric === 'cost' ? formatCurrency(n, currency, locale) : compact(n))

  if (days.length === 0) {
    return (
      <div className="empty">
        <strong>No usage in this window</strong>
        <p>Run a coding-agent session, or widen the date range.</p>
      </div>
    )
  }

  const colW = plotW / days.length
  const barW = Math.max(1.5, Math.min(26, colW * (days.length > 60 ? 0.92 : 0.58)))
  const radius = barW > 8 ? 2 : 0
  const labelStep = Math.max(1, Math.ceil(days.length / Math.max(4, Math.floor(plotW / 74))))
  // The final tick is only worth drawing if it clears the previous one.
  const lastStepped = Math.floor((days.length - 1) / labelStep) * labelStep
  const showFinal = (days.length - 1 - lastStepped) * (plotW / days.length) >= 42
  const yFor = (v: number) => PAD.t + plotH * (1 - v / max)
  const xFor = (i: number) => PAD.l + i * colW + colW / 2
  const hover = probe.index != null ? days[probe.index] : undefined

  return (
    <>
      <div className="chart-legend" style={{ padding: '10px 12px 0' }}>
        {providers.map((p) => {
          const off = hidden.has(p)
          return (
            <button
              key={p}
              type="button"
              className={`legend-item${off ? ' off' : ''}`}
              onClick={() =>
                setHidden((prev) => {
                  const next = new Set(prev)
                  if (next.has(p)) next.delete(p)
                  else if (next.size < providers.length - 1) next.add(p)
                  return next
                })
              }
            >
              <i style={{ background: PROVIDER_META[p].color }} />
              {PROVIDER_META[p].short}
            </button>
          )
        })}
      </div>

      <div className="chart-shell" ref={wrapRef}>
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Daily usage by provider"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          {tickValues(max, 4).map((t) => (
            <g key={t}>
              <line className="chart-grid-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(t)} y2={yFor(t)} />
              <text x={PAD.l - 10} y={yFor(t) + 3.5} textAnchor="end">
                {metric === 'cost' && t > 0 ? `$${compact(t)}` : compact(t)}
              </text>
            </g>
          ))}

          {hover ? (
            <rect
              x={PAD.l + (probe.index ?? 0) * colW}
              y={PAD.t}
              width={colW}
              height={plotH}
              fill="var(--tint)"
              pointerEvents="none"
            />
          ) : null}

          {days.map((day, di) => {
            let acc = 0
            const dim = selectedDay != null && selectedDay !== day
            return (
              <g key={day}>
                {visible.map((p, pi) => {
                  const v = cell.get(`${day}:${p}`) ?? 0
                  if (v <= 0) return null
                  const h = (v / max) * plotH
                  const yTop = yFor(acc + v)
                  acc += v
                  const isTop = visible
                    .slice(pi + 1)
                    .every((q) => (cell.get(`${day}:${q}`) ?? 0) <= 0)
                  return (
                    <path
                      key={p}
                      className={`chart-bar${dim ? ' dim' : ''}`}
                      d={barPath(xFor(di) - barW / 2, yTop, barW, Math.max(h, 1), isTop ? radius : 0)}
                      fill={PROVIDER_META[p].color}
                      style={
                        reduced ? { animation: 'none' } : { animationDelay: `${Math.min(di * 10, 260)}ms` }
                      }
                      onClick={() => onSelectDay?.(day)}
                    />
                  )
                })}
              </g>
            )
          })}

          <line className="chart-axis-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(0)} y2={yFor(0)} />

          {days.map((day, di) => {
            const stepped = di % labelStep === 0
            const final = di === days.length - 1 && showFinal
            if (!stepped && !final) return null
            return (
              <text key={day} x={xFor(di)} y={H - 8} textAnchor="middle">
                {shortDay(day)}
              </text>
            )
          })}
        </svg>

        {hover ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(probe.x, Math.min(92, W / 2)), W - Math.min(92, W / 2)),
              top: PAD.t + 4,
              maxWidth: Math.max(140, W - 16)
            }}
          >
            <div className="tt-title">{weekdayLabel(hover)}</div>
            {visible.map((p) => {
              const v = cell.get(`${hover}:${p}`) ?? 0
              if (v <= 0) return null
              return (
                <div className="tt-row" key={p}>
                  <i style={{ background: PROVIDER_META[p].color }} />
                  {PROVIDER_META[p].short}
                  <b>{fmt(v)}</b>
                </div>
              )
            })}
            <div className="tt-row tt-total">
              Total
              <b>{fmt(totals[probe.index ?? 0] ?? 0)}</b>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
