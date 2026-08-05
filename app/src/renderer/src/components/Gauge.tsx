import { useEffect, useState } from 'react'
import { usePrefersReducedMotion } from '../lib/hooks'

interface Props {
  /** 0–100, or null when there is no measured figure. */
  value: number | null
  size?: number
  thickness?: number
  label?: string
  display?: string
}

/**
 * 270° radial gauge. `pathLength=100` makes the dash maths percentage-based
 * regardless of radius.
 */
export function Gauge({ value, size = 96, thickness = 5, label = 'remaining', display }: Props) {
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = useState(reduced ? (value ?? 0) : 0)

  useEffect(() => {
    if (reduced) {
      setShown(value ?? 0)
      return
    }
    const id = window.setTimeout(() => setShown(value ?? 0), 40)
    return () => window.clearTimeout(id)
  }, [value, reduced])

  const r = (size - thickness) / 2
  const c = size / 2
  const pct = Math.min(100, Math.max(0, shown))

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <g transform={`rotate(135 ${c} ${c})`}>
          <circle
            className="gauge-track"
            cx={c}
            cy={c}
            r={r}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray="75 100"
          />
          {value != null ? (
            <circle
              className="gauge-arc"
              cx={c}
              cy={c}
              r={r}
              fill="none"
              strokeWidth={thickness}
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray="75 100"
              strokeDashoffset={75 - (pct / 100) * 75}
            />
          ) : null}
        </g>
      </svg>
      <div className="gauge-center">
        <div className="gauge-value">
          {display ?? (value != null ? `${Math.round(value)}%` : '—')}
        </div>
        <div className="gauge-unit">{label}</div>
      </div>
    </div>
  )
}
