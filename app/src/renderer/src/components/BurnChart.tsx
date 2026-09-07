import { useMemo } from 'react'
import type { BurnSeries } from '@shared/types'
import { providerMeta, type ProviderId } from '@shared/providers'
import { areaPath, pathLength, smoothPath, weekdayLabel, shortDay, type Pt } from '../lib/chart'
import { useChartHover, useElementWidth, usePrefersReducedMotion } from '../lib/hooks'

interface Props {
  series: BurnSeries[]
}

const H = 270

function padsFor(width: number) {
  const tight = width < 440
  return { l: tight ? 30 : 42, r: tight ? 10 : 16, t: 12, b: 26 }
}

/** Weekly quota burn for one provider or an overlaid comparison of all providers. */
export function BurnChart({ series }: Props) {
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(620)
  const visibleSeries = series.filter((entry) => entry.points.length > 0)
  const days = useMemo(
    () => Array.from(new Set(visibleSeries.flatMap((entry) => entry.points.map((point) => point.day)))).sort(),
    [visibleSeries]
  )

  const W = Math.max(240, Math.round(wrapWidth))
  const PAD = padsFor(W)
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b
  const xFor = (day: string) => {
    const index = Math.max(0, days.indexOf(day))
    return PAD.l + (index / Math.max(days.length - 1, 1)) * plotW
  }
  const yFor = (value: number) =>
    PAD.t + plotH * (1 - Math.min(Math.max(value, 0), 100) / 100)

  const geometries = visibleSeries.map((entry) => {
    const observed = entry.points.filter((point) => !point.projected)
    const projected = entry.points.filter((point) => point.projected)
    const obsPts: Pt[] = observed.map((point) => ({ x: xFor(point.day), y: yFor(point.used_pct) }))
    const projPts: Pt[] = projected.map((point) => ({ x: xFor(point.day), y: yFor(point.used_pct) }))
    const bridged = obsPts.length > 0 && projPts.length > 0
      ? [obsPts[obsPts.length - 1], ...projPts]
      : projPts
    return { entry, obsPts, projPts: bridged, obsLen: pathLength(obsPts) }
  })

  const { probe, onMove, onLeave, onKeyDown } = useChartHover(days.length, W, PAD.l, PAD.r)
  const activeDay = probe.index == null ? undefined : days[probe.index]

  if (visibleSeries.length === 0 || days.length === 0) {
    return (
      <div className="empty">
        <strong>No weekly burn history yet</strong>
        <p>Weekly snapshots accumulate as collectors observe live quota figures.</p>
      </div>
    )
  }

  const labelStep = Math.max(1, Math.ceil(days.length / Math.max(3, Math.floor(plotW / 78))))
  const gapPx = plotW / Math.max(days.length - 1, 1)
  const lastStepped = Math.floor((days.length - 1) / labelStep) * labelStep
  const showFinal = (days.length - 1 - lastStepped) * gapPx >= 42

  return (
    <>
      <div className="chart-legend burn-legend" style={{ padding: '10px 12px 0' }}>
        {visibleSeries.map((entry, index) => (
          <span className="legend-item" key={entry.id}>
            <i style={{ background: seriesTone(entry.provider, index, visibleSeries) }} />
            {entry.label}
          </span>
        ))}
        <span className="legend-item legend-note">
          <i className="dash" />
          Dashed = 3-day forecast
        </span>
        {visibleSeries.some((entry) => entry.points.some((point) => point.lower_used_pct != null)) ? (
          <span className="legend-item legend-note">Shaded = observed confidence range</span>
        ) : null}
      </div>

      <div className="chart-shell" ref={wrapRef}>
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onBlur={onLeave}
          aria-label="Quota allowance burn and projection by provider. Use arrow keys to explore."
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          <line x1={PAD.l} x2={W - PAD.r} y1={yFor(100)} y2={yFor(100)} stroke="var(--warn)" strokeDasharray="4 5" opacity={0.6} />
          {[0, 25, 50, 75, 100].map((tick) => (
            <g key={tick}>
              <line className="chart-grid-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(tick)} y2={yFor(tick)} />
              <text x={PAD.l - 10} y={yFor(tick) + 3.5} textAnchor="end">{tick}%</text>
            </g>
          ))}

          {activeDay ? (
            <line className="chart-crosshair" x1={xFor(activeDay)} x2={xFor(activeDay)} y1={PAD.t} y2={PAD.t + plotH} />
          ) : null}

          {geometries.map(({ entry, obsPts, projPts, obsLen }, index) => {
            const tone = seriesTone(entry.provider, index, visibleSeries)
            const rangePoints = entry.points
              .filter((point) => point.projected && point.lower_used_pct != null && point.upper_used_pct != null)
              .map((point) => ({
                x: xFor(point.day),
                low: yFor(point.lower_used_pct ?? point.used_pct),
                high: yFor(point.upper_used_pct ?? point.used_pct)
              }))
            const confidenceBand = rangePoints.length > 1
              ? `M${rangePoints.map((point) => `${point.x},${point.high}`).join(' L')} L ${[...rangePoints]
                .reverse()
                .map((point) => `${point.x},${point.low}`)
                .join(' L')} Z`
              : undefined
            return (
              <g key={entry.id}>
                {obsPts.length > 1 ? (
                  <path className="chart-area" d={areaPath(obsPts, yFor(0))} fill={tone} opacity={visibleSeries.length === 1 ? 0.08 : 0.025} />
                ) : null}
                {obsPts.length > 1 ? (
                  <path
                    className="chart-line"
                    d={smoothPath(obsPts)}
                    stroke={tone}
                    strokeWidth={2}
                    style={reduced ? { animation: 'none' } : {
                      ['--len' as string]: obsLen,
                      strokeDasharray: obsLen
                    }}
                  />
                ) : null}
                {projPts.length > 1 ? (
                  <path d={smoothPath(projPts)} fill="none" stroke={tone} strokeWidth={1.65} strokeDasharray="4 4" opacity={0.78} />
                ) : null}
                {confidenceBand ? <path d={confidenceBand} fill={tone} opacity={0.1} pointerEvents="none" /> : null}
                {activeDay ? entry.points.filter((point) => point.day === activeDay).map((point) => (
                  <circle
                    key={`${entry.provider}:${point.day}:${point.projected}`}
                    cx={xFor(point.day)}
                    cy={yFor(point.used_pct)}
                    r={3.25}
                    fill="var(--surface)"
                    stroke={tone}
                    strokeWidth={2}
                    pointerEvents="none"
                  />
                )) : null}
              </g>
            )
          })}

          <line className="chart-axis-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(0)} y2={yFor(0)} />
          {days.map((day, index) => {
            const stepped = index % labelStep === 0
            const final = index === days.length - 1 && showFinal
            if (!stepped && !final) return null
            return <text key={day} x={xFor(day)} y={H - 8} textAnchor="middle">{shortDay(day)}</text>
          })}
        </svg>

        {activeDay ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(probe.x, Math.min(100, W / 2)), W - Math.min(100, W / 2)),
              top: PAD.t + 4,
              maxWidth: Math.max(170, W - 16)
            }}
          >
            <div className="tt-title">{weekdayLabel(activeDay)}</div>
            {visibleSeries.map((entry, index) => {
              const point = entry.points.find((candidate) => candidate.day === activeDay)
              if (!point) return null
              return (
                <div className="tt-row" key={entry.id}>
                  <i style={{ background: seriesTone(entry.provider, index, visibleSeries) }} />
                  {entry.label}{point.projected ? ` forecast (${entry.forecast_confidence})` : ''}
                  <b>{point.used_pct.toFixed(1)}% used</b>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </>
  )
}

function seriesTone(provider: ProviderId, index: number, series: BurnSeries[]): string {
  const base = providerMeta(provider).color
  const sameProviderIndex = series.slice(0, index).filter((entry) => entry.provider === provider).length
  if (sameProviderIndex === 0) return base
  const white = Math.min(48, sameProviderIndex * 17)
  return `color-mix(in srgb, ${base} ${100 - white}%, white ${white}%)`
}
