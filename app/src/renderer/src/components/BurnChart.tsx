import type { BurnPoint } from '@shared/types'

export function BurnChart({ data }: { data: BurnPoint[] }) {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--muted)', fontSize: 12, padding: 24 }}>
        No burn data yet.
      </div>
    )
  }

  const W = 620
  const H = 240
  const padL = 36
  const padR = 12
  const padT = 16
  const padB = 28
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const observed = data.filter((d) => !d.projected)
  const projected = data.filter((d) => d.projected)
  // Connect projection from last observed
  const projLine =
    observed.length > 0 ? [observed[observed.length - 1], ...projected] : projected

  const toXY = (i: number, used: number, n: number) => {
    const x = padL + (i / Math.max(n - 1, 1)) * plotW
    const y = padT + plotH * (1 - used / 100)
    return { x, y }
  }

  const pathFor = (pts: BurnPoint[], offset: number) => {
    if (pts.length === 0) return ''
    return pts
      .map((p, i) => {
        const { x, y } = toXY(offset + i, p.used_pct, data.length)
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  }

  const obsPath = pathFor(observed, 0)
  const projStart = Math.max(observed.length - 1, 0)
  const projPath = pathFor(projLine, projStart)

  return (
    <div>
      <div className="legend" style={{ marginBottom: 8 }}>
        <span>
          <i style={{ background: '#60a5fa' }} />
          Observed
        </span>
        <span>
          <i
            style={{
              background: 'transparent',
              border: '1px dashed #60a5fa',
              height: 0,
              width: 14
            }}
          />
          Projection
        </span>
      </div>
      <svg className="svg-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quota burn">
        {[0, 25, 50, 75, 100].map((t) => {
          const y = padT + plotH * (1 - t / 100)
          return (
            <g key={t}>
              <line className="grid" x1={padL} x2={W - padR} y1={y} y2={y} />
              <text x={padL - 6} y={y + 3} textAnchor="end">
                {t}%
              </text>
            </g>
          )
        })}
        {obsPath ? (
          <path d={obsPath} fill="none" stroke="#60a5fa" strokeWidth={2.5} />
        ) : null}
        {projPath ? (
          <path
            d={projPath}
            fill="none"
            stroke="#60a5fa"
            strokeWidth={2}
            strokeDasharray="6 5"
            opacity={0.75}
          />
        ) : null}
        {data.map((p, i) => {
          if (i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null
          const { x } = toXY(i, p.used_pct, data.length)
          return (
            <text key={p.day + i} x={x} y={H - 8} textAnchor="middle">
              {p.day.slice(5)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
