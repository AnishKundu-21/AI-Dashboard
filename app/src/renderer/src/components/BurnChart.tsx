import { useMemo } from 'react'
import type { BurnPoint } from '@shared/types'
import { providerMeta, type ProviderId } from '@shared/providers'
import { areaPath, pathLength, smoothPath, weekdayLabel, shortDay, type Pt } from '../lib/chart'
import { useChartHover, useElementWidth, usePrefersReducedMotion } from '../lib/hooks'

interface Props {
  data: BurnPoint[]
  provider: ProviderId
}

const H = 260

/** Axis gutters shrink on narrow cards so the plot keeps usable width. */
function padsFor(width: number) {
  const tight = width < 440
  return { l: tight ? 30 : 42, r: tight ? 10 : 16, t: 12, b: 26 }
}

/** Observed quota burn with a dashed forecast tail. */
export function BurnChart({ data, provider }: Props) {
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(620)
  const tone = providerMeta(provider).color

  const W = Math.max(240, Math.round(wrapWidth))
  const PAD = padsFor(W)
  const plotW = W - PAD.l - PAD.r
  const plotH = H - PAD.t - PAD.b

  const { obsPts, projPts, obsLen, projCount } = useMemo(() => {
    const x = (i: number) => PAD.l + (i / Math.max(data.length - 1, 1)) * plotW
    const y = (v: number) => PAD.t + plotH * (1 - Math.min(Math.max(v, 0), 100) / 100)
    const observed: Pt[] = []
    const projected: Pt[] = []
    data.forEach((p, i) => {
      ;(p.projected ? projected : observed).push({ x: x(i), y: y(p.used_pct) })
    })
    // Bridge back to the last measured point so the forecast reads as continuous.
    const bridged =
      observed.length > 0 && projected.length > 0
        ? [observed[observed.length - 1], ...projected]
        : projected
    return {
      obsPts: observed,
      projPts: bridged,
      obsLen: pathLength(observed),
      projCount: projected.length
    }
  }, [data, plotW, plotH, PAD.l, PAD.t])

  const { probe, onMove, onLeave } = useChartHover(data.length, W, PAD.l, PAD.r)

  if (data.length === 0) {
    return (
      <div className="empty">
        <strong>No burn history yet</strong>
        <p>Snapshots accumulate as the collector observes live quota figures.</p>
      </div>
    )
  }

  const xFor = (i: number) => PAD.l + (i / Math.max(data.length - 1, 1)) * plotW
  const yFor = (v: number) => PAD.t + plotH * (1 - Math.min(Math.max(v, 0), 100) / 100)
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(3, Math.floor(plotW / 78))))
  // The final tick is only worth drawing if it clears the previous one.
  const gapPx = plotW / Math.max(data.length - 1, 1)
  const lastStepped = Math.floor((data.length - 1) / labelStep) * labelStep
  const showFinal = (data.length - 1 - lastStepped) * gapPx >= 42
  const active = probe.index != null ? data[probe.index] : undefined

  return (
    <>
      <div className="chart-legend" style={{ padding: '10px 12px 0' }}>
        <span className="legend-item">
          <i style={{ background: tone }} />
          Observed
        </span>
        {projCount > 0 ? (
          <span className="legend-item">
            <i className="dash" style={{ color: tone }} />
            Forecast · {projCount}d
          </span>
        ) : null}
      </div>

      <div className="chart-shell" ref={wrapRef}>
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Quota burn and projection"
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          {[0, 25, 50, 75, 100].map((t) => (
            <g key={t}>
              <line className="chart-grid-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(t)} y2={yFor(t)} />
              <text x={PAD.l - 10} y={yFor(t) + 3.5} textAnchor="end">
                {t}
              </text>
            </g>
          ))}

          {obsPts.length > 1 ? (
            <path
              className="chart-area"
              d={areaPath(obsPts, PAD.t + plotH)}
              fill={tone}
              opacity={0.08}
            />
          ) : null}

          {projPts.length > 1 ? (
            <path
              className="chart-area"
              d={smoothPath(projPts)}
              fill="none"
              stroke={tone}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              opacity={0.7}
            />
          ) : null}

          {obsPts.length > 1 ? (
            <path
              className="chart-line"
              d={smoothPath(obsPts)}
              stroke={tone}
              strokeWidth={1.75}
              style={
                reduced
                  ? { animation: 'none' }
                  : {
                      ['--len' as string]: obsLen,
                      strokeDasharray: obsLen
                    }
              }
            />
          ) : null}

          {active ? (
            <g pointerEvents="none">
              <line
                className="chart-crosshair"
                x1={xFor(probe.index ?? 0)}
                x2={xFor(probe.index ?? 0)}
                y1={PAD.t}
                y2={PAD.t + plotH}
              />
              <circle
                cx={xFor(probe.index ?? 0)}
                cy={yFor(active.used_pct)}
                r={3}
                fill="var(--surface)"
                stroke={tone}
                strokeWidth={1.75}
              />
            </g>
          ) : null}

          <line className="chart-axis-line" x1={PAD.l} x2={W - PAD.r} y1={yFor(0)} y2={yFor(0)} />

          {data.map((p, i) => {
            const stepped = i % labelStep === 0
            const final = i === data.length - 1 && showFinal
            if (!stepped && !final) return null
            return (
              <text key={`${p.day}-${i}`} x={xFor(i)} y={H - 8} textAnchor="middle">
                {shortDay(p.day)}
              </text>
            )
          })}
        </svg>

        {active ? (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(Math.max(probe.x, Math.min(86, W / 2)), W - Math.min(86, W / 2)),
              top: PAD.t + 4,
              maxWidth: Math.max(140, W - 16)
            }}
          >
            <div className="tt-title">{weekdayLabel(active.day)}</div>
            <div className="tt-row">
              <i style={{ background: tone }} />
              {active.projected ? 'Forecast used' : 'Used'}
              <b>{active.used_pct.toFixed(1)}%</b>
            </div>
            <div className="tt-row">
              <i style={{ background: 'var(--border-2)' }} />
              Remaining
              <b>{Math.max(0, 100 - active.used_pct).toFixed(1)}%</b>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
