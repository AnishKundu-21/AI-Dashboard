import type { ReactNode } from 'react'
import { useCountUp } from '../lib/hooks'

interface Props {
  label: string
  /** Raw number so the readout can settle; rendered through `format`. */
  value: number
  format: (n: number) => string
  unit?: string
  sub?: ReactNode
  /** Percentage change against the earlier half of the same window. */
  delta?: number | null
  deltaLabel?: string
  children?: ReactNode
}

export function StatCard({ label, value, format, unit, sub, delta, deltaLabel, children }: Props) {
  const animated = useCountUp(value, 600)
  const dir = delta == null ? 'flat' : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat'

  return (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {delta != null ? (
          <span className={`delta ${dir}`} title={deltaLabel}>
            {dir === 'up' ? '↑' : dir === 'down' ? '↓' : ''}
            {`${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`}
          </span>
        ) : null}
      </div>

      <div className="stat-value">
        {format(animated)}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>

      {sub ? <div className="stat-sub">{sub}</div> : null}
      {children ? <div className="stat-foot">{children}</div> : null}
    </div>
  )
}
