import { useState } from 'react'
import type { ModelMixItem, ProviderCost } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { areaPath, compact, niceMax, smoothPath, tickValues, type Pt } from '../lib/chart'
import { formatCurrency, formatTokens } from '../lib/format'
import { useElementWidth, usePrefersReducedMotion } from '../lib/hooks'

export type AnalyticsMetric =
  | 'tokens_total'
  | 'uncached_input'
  | 'cached_input'
  | 'cache_creation'
  | 'output'
  | 'reasoning'
  | 'model_calls'
  | 'session_count'
  | 'api_equiv_usd'
  | 'provider_cost_usd'
  | 'cache_savings_usd'

export const ANALYTICS_METRICS: Array<{ value: AnalyticsMetric; label: string }> = [
  { value: 'tokens_total', label: 'Total tokens' },
  { value: 'uncached_input', label: 'Uncached input' },
  { value: 'cached_input', label: 'Cache reads' },
  { value: 'cache_creation', label: 'Cache writes' },
  { value: 'output', label: 'Output' },
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'model_calls', label: 'Model calls' },
  { value: 'session_count', label: 'Sessions' },
  { value: 'api_equiv_usd', label: 'API-equivalent' },
  { value: 'provider_cost_usd', label: 'Provider-reported cost' },
  { value: 'cache_savings_usd', label: 'Cache savings' }
]

type AnalyticsRow = ProviderCost | ModelMixItem

function valueOf(row: AnalyticsRow, metric: AnalyticsMetric): number {
  return row[metric] ?? 0
}

function isMoney(metric: AnalyticsMetric): boolean {
  return metric === 'api_equiv_usd' || metric === 'provider_cost_usd' || metric === 'cache_savings_usd'
}

function formatValue(value: number, metric: AnalyticsMetric, currency: string, locale: string): string {
  if (isMoney(metric)) return formatCurrency(value, currency, locale)
  if (metric === 'model_calls' || metric === 'session_count') return Math.round(value).toLocaleString(locale)
  return formatTokens(value)
}

export function AnalyticsRankChart({
  rows,
  kind,
  metric,
  currency,
  locale,
  onSelectModel
}: {
  rows: AnalyticsRow[]
  kind: 'provider' | 'model'
  metric: AnalyticsMetric
  currency: string
  locale: string
  onSelectModel?: (model: string) => void
}) {
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(620)
  const [hovered, setHovered] = useState<number | null>(null)
  const ranked = [...rows]
    .filter((row) => valueOf(row, metric) > 0)
    .sort((a, b) => valueOf(b, metric) - valueOf(a, metric))
  const max = Math.max(...ranked.map((row) => valueOf(row, metric)), 1e-9)

  if (ranked.length === 0) {
    return (
      <div className="empty compact-empty">
        <strong>No data for this metric</strong>
        <p>Try another metric, provider, or date range.</p>
      </div>
    )
  }

  const W = Math.max(260, Math.round(wrapWidth))
  const H = 238
  const pad = { l: W < 440 ? 38 : 54, r: 16, t: 18, b: 42 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const xFor = (index: number) =>
    ranked.length === 1 ? pad.l + plotW / 2 : pad.l + (index / (ranked.length - 1)) * plotW
  const chartMax = niceMax(max)
  const yFor = (value: number) => pad.t + plotH * (1 - value / chartMax)
  const points: Pt[] = ranked.map((row, index) => ({
    x: xFor(index),
    y: yFor(valueOf(row, metric))
  }))
  const labelStep = Math.max(1, Math.ceil(ranked.length / Math.max(3, Math.floor(plotW / 92))))
  const active = hovered == null ? null : ranked[hovered]

  return (
    <div className="rank-chart" ref={wrapRef} onPointerLeave={() => setHovered(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${kind} comparison line chart`}>
        <defs>
          <linearGradient id={`rank-fill-${kind}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {tickValues(chartMax, 4).map((tick) => (
          <g key={tick}>
            <line className="chart-grid-line" x1={pad.l} x2={W - pad.r} y1={yFor(tick)} y2={yFor(tick)} />
            <text x={pad.l - 9} y={yFor(tick) + 3.5} textAnchor="end">
              {isMoney(metric) ? formatCurrency(tick, currency, locale) : compact(tick)}
            </text>
          </g>
        ))}
        {points.length > 1 ? (
          <path d={areaPath(points, yFor(0))} fill={`url(#rank-fill-${kind})`} />
        ) : null}
        {points.length > 1 ? (
          <path
            className="chart-line rank-line"
            d={smoothPath(points)}
            stroke="var(--accent)"
            strokeWidth={1.75}
            style={reduced ? { animation: 'none' } : undefined}
          />
        ) : null}
        {ranked.map((row, index) => {
          const model = 'model' in row ? row.model : null
          const label = model ?? providerMeta(row.provider).short
          const point = points[index]
          const showLabel = ranked.length <= 6 || index % labelStep === 0 || index === ranked.length - 1
          return (
            <g
              key={`${row.provider}:${label}`}
              className={model ? 'rank-point selectable' : 'rank-point'}
              onPointerEnter={() => setHovered(index)}
              onClick={() => model && onSelectModel?.(model)}
            >
              <title>{`${model ?? providerMeta(row.provider).name}: ${formatValue(valueOf(row, metric), metric, currency, locale)}`}</title>
              <circle cx={point.x} cy={point.y} r={hovered === index ? 5 : 3.75} fill={providerMeta(row.provider).color} stroke="var(--surface)" strokeWidth={2} />
              <circle cx={point.x} cy={point.y} r={11} fill="transparent" />
              {showLabel ? (
                <text x={point.x} y={H - 13} textAnchor="middle">
                  {label.length > 15 ? `${label.slice(0, 13)}…` : label}
                </text>
              ) : null}
            </g>
          )
        })}
        <line className="chart-axis-line" x1={pad.l} x2={W - pad.r} y1={yFor(0)} y2={yFor(0)} />
      </svg>
      {active ? (
        <div
          className="chart-tooltip rank-tooltip"
          style={{ left: points[hovered ?? 0].x, top: Math.max(8, points[hovered ?? 0].y - 10) }}
        >
          <div className="tt-title">{'model' in active ? String(active.model) : providerMeta(active.provider).name}</div>
          <div className="tt-row">
            <i style={{ background: providerMeta(active.provider).color }} />
            {providerMeta(active.provider).short}
            <b>{formatValue(valueOf(active, metric), metric, currency, locale)}</b>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function AnalyticsTable({
  rows,
  kind,
  currency,
  locale,
  onSelectModel
}: {
  rows: AnalyticsRow[]
  kind: 'provider' | 'model'
  currency: string
  locale: string
  onSelectModel?: (model: string) => void
}) {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.tokens_total - a.tokens_total)

  return (
    <div className="analytics-table-wrap">
      <table className={`analytics-table ${kind}`}>
        <thead>
          <tr>
            <th>{kind === 'model' ? 'Model' : 'Provider'}</th>
            {kind === 'model' ? <th>Provider</th> : null}
            <th>Total tokens</th>
            <th>Uncached input</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th>Cache hit</th>
            <th>Output</th>
            <th title="Reasoning is already included in output and is not added to total tokens">Reasoning</th>
            <th>Calls</th>
            <th>Sessions</th>
            <th>Avg / call</th>
            <th>API-equiv.</th>
            <th>Provider billed</th>
            <th>Cache saved</th>
            <th>Unpriced calls</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const model = 'model' in row ? row.model : null
            return (
              <tr key={`${row.provider}:${model ?? 'provider'}`}>
                <td>
                  {model ? (
                    <button type="button" className="table-link" onClick={() => onSelectModel?.(model)}>
                      {model}
                    </button>
                  ) : (
                    <span className="provider-cell">
                      <i className="swatch" style={{ background: providerMeta(row.provider).color }} />
                      {providerMeta(row.provider).name}
                    </span>
                  )}
                </td>
                {kind === 'model' ? <td>{providerMeta(row.provider).name}</td> : null}
                <td>{formatTokens(row.tokens_total)}</td>
                <td>{formatTokens(row.uncached_input)}</td>
                <td>{formatTokens(row.cached_input)}</td>
                <td>{formatTokens(row.cache_creation)}</td>
                <td>
                  {row.uncached_input + row.cached_input > 0
                    ? `${((row.cached_input / (row.uncached_input + row.cached_input)) * 100).toFixed(1)}%`
                    : '—'}
                </td>
                <td>{formatTokens(row.output)}</td>
                <td>{formatTokens(row.reasoning)}</td>
                <td>{row.model_calls.toLocaleString(locale)}</td>
                <td>{row.session_count.toLocaleString(locale)}</td>
                <td>{row.model_calls > 0 ? compact(row.tokens_total / row.model_calls) : '—'}</td>
                <td>{formatCurrency(row.api_equiv_usd, currency, locale)}</td>
                <td>{row.provider_cost_usd > 0 ? formatCurrency(row.provider_cost_usd, currency, locale) : '—'}</td>
                <td>{row.cache_savings_usd > 0 ? formatCurrency(row.cache_savings_usd, currency, locale) : '—'}</td>
                <td>{row.unpriced_calls > 0 ? row.unpriced_calls.toLocaleString(locale) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
