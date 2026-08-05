import { useMemo } from 'react'
import { linePath, type Pt } from '../lib/chart'

interface Props {
  values: number[]
  color?: string
  height?: number
  className?: string
}

/**
 * Bare trend line for stat cards: no fill, no marker, no animation.
 * It exists to show shape, not to decorate.
 */
export function Sparkline({ values, color = 'var(--text-3)', height = 26, className }: Props) {
  const W = 240

  const d = useMemo(() => {
    const clean = values.filter((v) => Number.isFinite(v))
    if (clean.length < 2) return ''
    const max = Math.max(...clean)
    const min = Math.min(...clean)
    const span = max - min || 1
    const pad = 2
    const pts: Pt[] = clean.map((v, i) => ({
      x: (i / (clean.length - 1)) * W,
      y: pad + (1 - (v - min) / span) * (height - pad * 2)
    }))
    return linePath(pts)
  }, [values, height])

  if (!d) return null

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
