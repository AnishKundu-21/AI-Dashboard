import { useId, useMemo, useState } from 'react'
import { Modal } from './Modal'
import type { DailyUsagePoint, UsageResolution } from '@shared/types'
import { providerMeta, providerIds, type ProviderId } from '@shared/providers'
import {
  areaPath,
  compact,
  linePath,
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
  resolution: UsageResolution
  selectedDay?: string
  onSelectDay?: (day: string) => void
  currency: string
  locale: string
  expanded?: boolean
}

const H = 280

/** Axis gutters shrink on narrow cards so the plot keeps usable width. */
function padsFor(width: number) {
  const tight = width < 440
  return { l: tight ? 36 : 54, r: tight ? 10 : 16, t: 12, b: 26 }
}

/** Multi-series daily usage. Hover reads every provider; click filters that day. */
export function DailyChart({
  data,
  metric,
  resolution,
  selectedDay,
  onSelectDay,
  currency,
  locale,
  expanded = false
}: Props) {
  const id = useId().replace(/:/g, '')
  const [mode, setMode] = useState<'line' | 'bar' | 'table'>('line')
  const [percent, setPercent] = useState(false)
  const [open, setOpen] = useState(false)
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(760)
  const [hidden, setHidden] = useState<Set<ProviderId>>(new Set())

  const W = Math.max(240, Math.round(wrapWidth))
  const PAD = padsFor(W)
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const { days, providers, cell, max, lineMax, totals } = useMemo(() => {
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
    const starts = new Map<string, number>()
    for (const point of data) {
      if (!starts.has(point.day)) starts.set(point.day, point.bucket_start_ms)
    }
    const dayList = Array.from(starts.keys()).sort(
      (a, b) => (starts.get(a) ?? 0) - (starts.get(b) ?? 0) || a.localeCompare(b)
    )
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
      lineMax: niceMax(Math.max(0, ...dayList.flatMap((day) => shown.map((p) => map.get(`${day}:${p}`) ?? 0)))),
      totals: sums
    }
  }, [data, metric, hidden])

  const visible = providers.filter((p) => !hidden.has(p))
  const { probe, onMove, onLeave, onKeyDown } = useChartHover(days.length, W, PAD.l, PAD.r, mode === 'bar')

  const moneyMetric = metric === 'cost' || metric === 'provider-cost' || metric === 'savings'
  const compactHourly = resolution === 'hour'
  const fmt = (n: number) => moneyMetric ? formatCurrency(n, currency, locale) : compact(n)
  const bucketLabel = (bucket: string, verbose = false) => {
    if (resolution === 'hour') {
      const [day, hour, offset] = bucket.split(' ')
      return verbose
        ? `${weekdayLabel(day)} · ${hour ?? ''}${offset ? ` ${offset}` : ''}`
        : `${shortDay(day)} ${hour ?? ''}`
    }
    if (resolution === 'week') return verbose ? `Week of ${weekdayLabel(bucket)}` : shortDay(bucket)
    if (resolution === 'month') return bucket.slice(0, 7)
    return verbose ? weekdayLabel(bucket) : shortDay(bucket)
  }

  if (days.length === 0) {
    return (
      <div className="empty">
        <strong>No usage in this window</strong>
        <p>Run a coding-agent session, or widen the date range.</p>
      </div>
    )
  }

  const labelStep = Math.max(
    1,
    Math.ceil(days.length / Math.max(compactHourly ? 5 : 4, Math.floor(plotW / (compactHourly ? 132 : 74))))
  )
  // The final tick is only worth drawing if it clears the previous one.
  const lastStepped = Math.floor((days.length - 1) / labelStep) * labelStep
  const showFinal = (days.length - 1 - lastStepped) * (plotW / days.length) >= 42
  const chartMax = percent ? 100 : mode === 'bar' ? max : lineMax
  const yFor = (v: number) => PAD.t + plotH * (1 - v / chartMax)
  const xFor = (i: number) => mode === 'bar' ? PAD.l + (i + 0.5) / days.length * plotW : PAD.l + (i / Math.max(days.length - 1, 1)) * plotW
  const displayValue = (day: string, p: string, i: number) => {
    const value = cell.get(`${day}:${p}`) ?? 0
    return percent ? (totals[i] ? value / totals[i] * 100 : 0) : value
  }
  const hover = probe.index != null ? days[probe.index] : undefined

  return (
    <>
      <div className="chart-toolbar"><div className="chart-view-options" aria-label="Chart display">
        {(['line', 'bar', 'table'] as const).map((value) => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'line' ? 'Trend' : value === 'bar' ? 'Stacked bars' : 'Data table'}</button>)}
      </div><div className="chart-view-options"><button aria-pressed={percent} onClick={() => setPercent(!percent)}>Share %</button>{!expanded && <button onClick={() => setOpen(true)} aria-label="Expand usage chart">Expand ↗</button>}</div></div>
      <div className="chart-legend" style={{ padding: '10px 12px 0' }}>
        {providers.map((p) => {
          const off = hidden.has(p)
          return (
            <button
              key={p}
              type="button"
              className={`legend-item${off ? ' off' : ''}`}
              aria-pressed={!off}
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

      <div className="chart-shell" ref={wrapRef} hidden={mode === 'table'}>
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          aria-label={`${resolution} usage by provider. Arrow keys explore; Enter selects a day.`}
          onKeyDown={(e) => { onKeyDown(e); if (e.key === 'Enter' && hover) onSelectDay?.(hover) }}
          onBlur={onLeave}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
          onClick={() => hover && onSelectDay?.(hover)}
          style={{ cursor: hover && onSelectDay ? 'pointer' : undefined }}
        >
          <defs>{providers.map((p) => <linearGradient key={p} id={`${id}-${p}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={providerMeta(p).color} stopOpacity="0.22" /><stop offset="100%" stopColor={providerMeta(p).color} stopOpacity="0.015" /></linearGradient>)}</defs>
          {tickValues(chartMax, 4).map((t) => (
            <g key={t}>
              <line className="chart-grid-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(t)} y2={yFor(t)} />
              <text x={PAD.l - 10} y={yFor(t) + 3.5} textAnchor="end">
                {percent ? `${t}%` : moneyMetric && t > 0 ? formatCurrency(t, currency, locale) : compact(t)}
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

          {mode === 'bar' && days.map((day, i) => {
            let base = 0
            const width = Math.max(1, Math.min(38, plotW / days.length * 0.62))
            return <g key={day}>{visible.map((p) => {
              const value = displayValue(day, p, i)
              const bottom = base; base += value
              return <rect className="chart-bar" key={p} x={xFor(i) - width / 2} y={yFor(base)} width={width} height={Math.max(0, yFor(bottom) - yFor(base))} fill={providerMeta(p).color} rx={Math.min(3, width / 4)} opacity={0.85} />
            })}</g>
          })}
          {mode === 'line' && visible.map((p, pi) => {
            const pts: Pt[] = days.map((day, i) => ({
              x: xFor(i),
              y: yFor(displayValue(day, p, i))
            }))
            const len = compactHourly ? 0 : pathLength(pts)
            return (
              <g key={p} opacity={selectedDay ? 0.82 : 1}>
                {!compactHourly && pts.length > 1 ? (
                  <path
                    className="chart-area"
                    d={areaPath(pts, yFor(0))}
                    fill={`url(#${id}-${p})`}
                  />
                ) : null}
                {pts.length > 1 ? (
                  <path
                    className="chart-line"
                    d={compactHourly ? linePath(pts) : smoothPath(pts)}
                    stroke={providerMeta(p).color}
                    strokeWidth={2}
                    style={reduced || compactHourly ? { animation: 'none' } : {
                      ['--len' as string]: len,
                      strokeDasharray: len,
                      animationDelay: `${pi * 70}ms`
                    }}
                  />
                ) : null}
                {!compactHourly && pts.length <= 60 && pts.map((point, index) => {
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
                    cy={yFor(displayValue(hover, p, probe.index ?? 0))}
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
                {bucketLabel(day)}
              </text>
            )
          })}
        </svg>

        {hover && mode !== 'table' ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(probe.x, Math.min(120, W / 2)), W - Math.min(120, W / 2)),
              top: PAD.t + 4,
              width: Math.min(224, W - 16), maxWidth: W - 16
            }}
          >
            <div className="tt-title">{bucketLabel(hover, true)}</div>
            {visible.map((p) => {
              const v = cell.get(`${hover}:${p}`) ?? 0
              if (v <= 0) return null
              return (
                <div className="tt-row" key={p}>
                  <i style={{ background: providerMeta(p).color }} />
                  {providerMeta(p).short}
                  <b>{percent ? `${displayValue(hover, p, probe.index ?? 0).toFixed(1)}%` : fmt(v)}</b>
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
      {mode === 'table' && <div className="table-wrap chart-data-table"><table><caption>Usage by {resolution} · {percent ? 'share of visible providers' : metric}</caption><thead><tr><th>Period</th>{visible.map((p) => <th key={p}>{providerMeta(p).short}</th>)}<th>Total</th></tr></thead><tbody>{days.map((day, i) => <tr key={day}><td>{onSelectDay ? <button className="table-link" onClick={() => onSelectDay(day)}>{bucketLabel(day, true)}</button> : bucketLabel(day, true)}</td>{visible.map((p) => <td key={p}>{percent ? `${displayValue(day, p, i).toFixed(1)}%` : fmt(cell.get(`${day}:${p}`) ?? 0)}</td>)}<td>{fmt(totals[i])}</td></tr>)}</tbody></table></div>}
      <div className="chart-footnote">{percent ? 'Percent of visible series. Tooltip totals remain absolute.' : 'Hover or use arrow keys to explore.'} {onSelectDay ? 'Enter or click to inspect sessions.' : ''}</div>
      {open && <Modal title="Usage explorer" onClose={() => setOpen(false)}><DailyChart data={data} metric={metric} resolution={resolution} currency={currency} locale={locale} selectedDay={selectedDay} onSelectDay={onSelectDay ? (day) => { setOpen(false); onSelectDay(day) } : undefined} expanded /></Modal>}
    </>
  )
}
