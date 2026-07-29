import type { ModelMixItem } from '@shared/types'
import { PROVIDER_META } from '@shared/providers'
import { formatTokens } from '../lib/format'

const FALLBACK_COLORS = ['#a78bfa', '#fbbf24', '#525866', '#34d399', '#fb7185']

export function ModelDonut({
  models,
  selectedModel,
  onSelectModel
}: {
  models: ModelMixItem[]
  selectedModel?: string
  onSelectModel?: (model: string) => void
}) {
  const total = models.reduce((s, m) => s + m.tokens_total, 0)
  const slices = models.slice(0, 8)

  let cursor = 0
  const stops: string[] = []
  slices.forEach((m, i) => {
    const share = total > 0 ? m.tokens_total / total : 0
    const start = cursor * 100
    cursor += share
    const end = cursor * 100
    const color = PROVIDER_META[m.provider]?.color ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
    stops.push(`${color} ${start}% ${end}%`)
  })
  if (stops.length === 0) {
    stops.push('#303541 0% 100%')
  }

  return (
    <div className="donut-wrap">
      <div
        className="donut"
        style={{
          background: `conic-gradient(${stops.join(', ')})`
        }}
      >
        <div className="donut-center">
          <strong>{formatTokens(total)}</strong>
          <span>tokens</span>
        </div>
      </div>
      <div className="model-list">
        {slices.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>No model data yet</div>
        ) : (
          slices.map((m) => (
            <button
              type="button"
              key={`${m.provider}-${m.model}`}
              className={`model-row${selectedModel === m.model ? ' selected' : ''}`}
              onClick={() => onSelectModel?.(m.model)}
            >
              <i style={{ background: PROVIDER_META[m.provider].color }} />
              <span>
                <strong>{m.model}</strong> · {PROVIDER_META[m.provider].short}
              </span>
              <span>
                {(m.share * 100).toFixed(0)}% · {formatTokens(m.tokens_total)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
