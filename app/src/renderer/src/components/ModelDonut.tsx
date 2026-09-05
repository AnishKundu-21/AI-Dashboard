import { useMemo, useState } from 'react'
import type { ModelMixItem } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { arcPath, compact } from '../lib/chart'

interface Props {
  models: ModelMixItem[]
  selectedModel?: string
  onSelectModel?: (model: string) => void
}

const SIZE = 168
const C = SIZE / 2
const R_OUT = 78
const R_IN = 56
const GAP = 1.2
const MAX_SLICES = 8

/** Model mix. Hovering a slice or a row highlights both. */
export function ModelDonut({ models, selectedModel, onSelectModel }: Props) {
  const [hover, setHover] = useState<string | null>(null)

  const { slices, total } = useMemo(() => {
    const sorted = [...models].sort((a, b) => b.tokens_total - a.tokens_total)
    const sum = sorted.reduce((s, m) => s + m.tokens_total, 0)
    const head = sorted.slice(0, MAX_SLICES)
    const tail = sorted.slice(MAX_SLICES)
    const items = head.map((m) => ({
      key: m.model,
      label: m.model,
      sub: providerMeta(m.provider)?.short ?? m.provider,
      color: providerMeta(m.provider)?.color ?? 'var(--text-3)',
      value: m.tokens_total,
      selectable: true
    }))
    if (tail.length > 0) {
      items.push({
        key: '__other__',
        label: `${tail.length} more`,
        sub: 'aggregated',
        color: 'var(--border-2)',
        value: tail.reduce((s, m) => s + m.tokens_total, 0),
        selectable: false
      })
    }
    let cursor = 0
    return {
      total: sum,
      slices: items.map((it) => {
        const share = sum > 0 ? it.value / sum : 0
        const start = cursor * 360
        cursor += share
        return { ...it, share, start, end: cursor * 360 }
      })
    }
  }, [models])

  if (slices.length === 0 || total === 0) {
    return (
      <div className="empty">
        <strong>No model data yet</strong>
        <p>Attribution appears once sessions report per-model token counts.</p>
      </div>
    )
  }

  const focus = hover ?? selectedModel ?? null
  const focused = slices.find((s) => s.key === focus)

  return (
    <div className="donut-wrap">
      <div className="donut" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Model mix">
          {slices.map((s) => {
            const sweep = s.end - s.start
            if (sweep <= 0.15) return null
            const gap = sweep > GAP * 2 ? GAP / 2 : 0
            const dim = focus != null && focus !== s.key
            return (
              <path
                key={s.key}
                className={`donut-slice${dim ? ' dim' : ''}`}
                d={arcPath(C, C, R_OUT, R_IN, s.start + gap, s.end - gap)}
                fill={s.color}
                onMouseEnter={() => setHover(s.key)}
                onMouseLeave={() => setHover(null)}
                onClick={() => s.selectable && onSelectModel?.(s.label)}
              >
                <title>{`${s.label} — ${(s.share * 100).toFixed(1)}%`}</title>
              </path>
            )
          })}
        </svg>
        <div className="donut-center">
          <strong>{focused ? `${(focused.share * 100).toFixed(1)}%` : compact(total)}</strong>
          <span>{focused ? focused.sub : 'tokens'}</span>
        </div>
      </div>

      <div className="model-list">
        {slices.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`model-row${selectedModel === s.label ? ' selected' : ''}`}
            onMouseEnter={() => setHover(s.key)}
            onMouseLeave={() => setHover(null)}
            onClick={() => s.selectable && onSelectModel?.(s.label)}
            disabled={!s.selectable}
          >
            <i className="swatch" style={{ background: s.color }} />
            <span className="m-name" title={s.label}>
              {s.label}
            </span>
            <span className="m-num m-pct">{(s.share * 100).toFixed(1)}%</span>
            <span className="m-num m-sub m-tokens">{compact(s.value)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
