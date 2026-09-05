import { useMemo, useState } from 'react'
import type { DailyUsagePoint } from '@shared/types'
import { providerMeta, providerIds, type ProviderId } from '@shared/providers'
import {
  areaPath,
  compact,
  niceMax,
  pathLength,
  shortDay,
  smoothPath,
  tickValues,
  weekdayLabel,
  type Pt
} from '../lib/chart'
import { useChartHover, useElementWidth, usePrefersReducedMotion } from '../lib/hooks'
import { formatCurrency } from '../lib/format'

export type DailyMetric =
  | 'tokens'
  | 'input'
  | 'cache-read'
  | 'cache-write'
  | 'output'
  | 'reasoning'
  | 'calls'
  | 'sessions'
  | 'cost'
  | 'provider-cost'
  | 'savings'

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

/** Multi-series daily usage. Hover reads every provider; click filters that day. */
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
    const read = (d: DailyUsagePoint) => {
      switch (metric) {
        case 'input': return d.uncached_input
        case 'cache-read': return d.cached_input
        case 'cache-write': return d.cache_creation
        case 'output': return d.output
        case 'reasoning': return d.reasoning
        case 'calls': return d.model_calls
        case 'sessions': return d.session_count
        case 'cost': return d.api_equiv_usd
        case 'provider-cost': return d.provider_cost_usd
        case 'savings': return d.cache_savings_usd
        default: return d.tokens_total
      }
    }
    const dayList = Array.from(new Set(data.map((d) => d.day))).sort()
    const present = providerIds().filter((p) => data.some((d) => d.provider === p))
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

  const moneyMetric = metric === 'cost' || metric === 'provider-cost' || metric === 'savings'
  const fmt = (n: number) => moneyMetric ? formatCurrency(n, currency, locale) : compact(n)

  if (days.length === 0) {
    return (
      <div className="empty">
        <strong>No usage in this window</strong>
        <p>Run a coding-agent session, or widen the date range.</p>
      </div>
    )
  }

  const labelStep = Math.max(1, Math.ceil(days.length / Math.max(4, Math.floor(plotW / 74))))
  // The final tick is only worth drawing if it clears the previous one.
  const lastStepped = Math.floor((days.length - 1) / labelStep) * labelStep
  const showFinal = (days.length - 1 - lastStepped) * (plotW / days.length) >= 42
  const yFor = (v: number) => PAD.t + plotH * (1 - v / max)
  const xFor = (i: number) => PAD.l + (i / Math.max(days.length - 1, 1)) * plotW
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
              <i style={{ background: providerMeta(p).color }} />
              {providerMeta(p).short}
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
          onClick={() => hover && onSelectDay?.(hover)}
          style={{ cursor: hover ? 'pointer' : undefined }}
        >
          {tickValues(max, 4).map((t) => (
            <g key={t}>
              <line className="chart-grid-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(t)} y2={yFor(t)} />
              <text x={PAD.l - 10} y={yFor(t) + 3.5} textAnchor="end">
                {moneyMetric && t > 0 ? formatCurrency(t, currency, locale) : compact(t)}
              </text>
            </g>
          ))}

          {hover ? (
            <rect
              x={Math.max(PAD.l, xFor(probe.index ?? 0) - Math.max(6, plotW / Math.max(days.length, 1) / 2))}
              y={PAD.t}
              width={Math.max(12, plotW / Math.max(days.length - 1, 1))}
              height={plotH}
              fill="var(--tint)"
              pointerEvents="none"
            />
          ) : null}

          {selectedDay && days.includes(selectedDay) ? (
            <line
              className="chart-crosshair selected"
              x1={xFor(days.indexOf(selectedDay))}
              x2={xFor(days.indexOf(selectedDay))}
              y1={PAD.t}
              y2={PAD.t + plotH}
              pointerEvents="none"
            />
          ) : null}

          {visible.map((p, pi) => {
            const pts: Pt[] = days.map((day, i) => ({
              x: xFor(i),
              y: yFor(cell.get(`${day}:${p}`) ?? 0)
            }))
            const len = pathLength(pts)
            return (
              <g key={p} opacity={selectedDay ? 0.82 : 1}>
                {pts.length > 1 ? (
                  <path
                    className="chart-area"
                    d={areaPath(pts, yFor(0))}
                    fill={providerMeta(p).color}
                    opacity={0.035}
                  />
                ) : null}
                {pts.length > 1 ? (
                  <path
                    className="chart-line"
                    d={smoothPath(pts)}
                    stroke={providerMeta(p).color}
                    strokeWidth={2}
                    style={reduced ? { animation: 'none' } : {
                      ['--len' as string]: len,
                      strokeDasharray: len,
                      animationDelay: `${pi * 70}ms`
                    }}
                  />
                ) : null}
                {pts.map((point, index) => {
                  const value = cell.get(`${days[index]}:${p}`) ?? 0
                  if (value <= 0) return null
                  return (
                    <circle
                      key={`${p}:${days[index]}`}
                      cx={point.x}
                      cy={point.y}
                      r={2.25}
                      fill={providerMeta(p).color}
                      opacity={0.72}
                      pointerEvents="none"
                    />
                  )
                })}
                {hover ? (
                  <circle
                    cx={xFor(probe.index ?? 0)}
                    cy={yFor(cell.get(`${hover}:${p}`) ?? 0)}
                    r={3.25}
                    fill="var(--surface)"
                    stroke={providerMeta(p).color}
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                ) : null}
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
                  <i style={{ background: providerMeta(p).color }} />
                  {providerMeta(p).short}
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
