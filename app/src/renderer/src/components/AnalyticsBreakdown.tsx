import { useMemo, useState } from 'react'
import type { ModelMixItem, ModelUsagePoint, ProviderCost, UsageResolution } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { areaPath, compact, linePath, niceMax, smoothPath, tickValues, type Pt } from '../lib/chart'
import { formatCurrency, formatTokens } from '../lib/format'
import { useChartHover, useElementWidth, usePrefersReducedMotion } from '../lib/hooks'
import { Segmented, type SegmentedOption } from './Segmented'

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

const MODEL_LINE_COLORS = [
  '#60a5fa', '#fb923c', '#c084fc', '#2dd4bf', '#f472b6', '#facc15',
  '#a3e635', '#38bdf8', '#fb7185', '#818cf8', '#34d399', '#fbbf24'
]

function modelSeriesKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** Model-level trend chart with the same direct filter affordance as providers. */
export function ModelUsageChart({
  rows,
  metric,
  resolution,
  currency,
  locale,
  availableModels,
  modelFilter,
  onModelFilter
}: {
  rows: ModelUsagePoint[]
  metric: AnalyticsMetric
  resolution: UsageResolution
  currency: string
  locale: string
  availableModels: ModelMixItem[]
  modelFilter: string
  onModelFilter: (key: string) => void
}) {
  const reduced = usePrefersReducedMotion()
  const [wrapRef, wrapWidth] = useElementWidth<HTMLDivElement>(760)
  const W = Math.max(280, Math.round(wrapWidth))
  const H = 220
  const pad = { l: W < 440 ? 42 : 56, r: 18, t: 18, b: 34 }
  const plotW = W - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const compactHourly = resolution === 'hour'
  const modelOptions: SegmentedOption<string>[] = [
    { value: 'all', label: 'All' },
    ...availableModels.map((row) => ({
      value: modelSeriesKey(row.provider, row.model),
      label: row.model,
      color: providerMeta(row.provider).color
    }))
  ]

  const { buckets, series, values, max } = useMemo(() => {
    const selectedRows = modelFilter === 'all'
      ? rows
      : rows.filter((row) => modelSeriesKey(row.provider, row.model) === modelFilter)
    const starts = new Map<string, number>()
    for (const row of selectedRows) {
      if (!starts.has(row.day)) starts.set(row.day, row.bucket_start_ms)
    }
    const bucketList = Array.from(starts.keys()).sort(
      (a, b) => (starts.get(a) ?? 0) - (starts.get(b) ?? 0) || a.localeCompare(b)
    )
    const keyFor = (row: ModelUsagePoint) => modelSeriesKey(row.provider, row.model)
    const seriesMap = new Map<string, { key: string; model: string; provider: string; total: number }>()
    const valueMap = new Map<string, number>()
    for (const row of selectedRows) {
      const key = keyFor(row)
      const total = valueOf(row, metric)
      const current = seriesMap.get(key)
      seriesMap.set(key, {
        key,
        model: row.model,
        provider: row.provider,
        total: (current?.total ?? 0) + total
      })
      valueMap.set(`${row.day}:${key}`, (valueMap.get(`${row.day}:${key}`) ?? 0) + total)
    }
    const ranked = Array.from(seriesMap.values()).sort((a, b) => b.total - a.total)
    let peak = 0
    for (const bucket of bucketList) {
      for (const item of ranked) {
        peak = Math.max(peak, valueMap.get(`${bucket}:${item.key}`) ?? 0)
      }
    }
    const chartMax = niceMax(peak)
    return { buckets: bucketList, series: ranked, values: valueMap, max: chartMax }
  }, [metric, modelFilter, rows])

  const { probe, onMove, onLeave } = useChartHover(buckets.length, W, pad.l, pad.r)
  const xFor = (index: number) =>
    pad.l + (index / Math.max(buckets.length - 1, 1)) * plotW
  const yFor = (value: number) => pad.t + plotH * (1 - value / max)
  const money = isMoney(metric)
  const fmt = (value: number) => money ? formatCurrency(value, currency, locale) : formatValue(value, metric, currency, locale)
  const label = (bucket: string) => {
    if (resolution === 'month') return bucket.slice(0, 7)
    if (resolution === 'week') return `W/O ${bucket.slice(5)}`
    if (resolution === 'hour') {
      const [day, hour] = bucket.split(' ')
      return `${day.slice(5)} ${hour ?? ''}`
    }
    return bucket.slice(5)
  }

  const labelStep = Math.max(
    1,
    Math.ceil(buckets.length / Math.max(compactHourly ? 5 : 4, Math.floor(plotW / (compactHourly ? 132 : 78))))
  )
  const hoverBucket = probe.index == null ? undefined : buckets[probe.index]

  return (
    <div className="model-usage-chart" ref={wrapRef}>
      <div className="model-filter-bar">
        <Segmented
          options={modelOptions}
          value={modelFilter}
          onChange={onModelFilter}
          ariaLabel="Filter model trend chart"
        />
      </div>
      {series.length === 0 || buckets.length === 0 ? (
        <div className="empty compact-empty">
          <strong>No model usage in this window</strong>
          <p>Try another metric, provider, or date range.</p>
        </div>
      ) : (
      <div className="chart-shell model-usage-shell">
        <svg
          className="chart-svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Usage over time by model at ${resolution} resolution`}
          onPointerMove={onMove}
          onPointerLeave={onLeave}
        >
          {tickValues(max, 4).map((tick) => (
            <g key={tick}>
              <line className="chart-grid-line" x1={pad.l} x2={W - pad.r} y1={yFor(tick)} y2={yFor(tick)} />
              <text x={pad.l - 9} y={yFor(tick) + 3.5} textAnchor="end">
                {money ? formatCurrency(tick, currency, locale) : compact(tick)}
              </text>
            </g>
          ))}
          {hoverBucket ? (
            <line
              className="chart-crosshair"
              x1={xFor(probe.index ?? 0)}
              x2={xFor(probe.index ?? 0)}
              y1={pad.t}
              y2={H - pad.b}
              pointerEvents="none"
            />
          ) : null}
          {series.map((item, index) => {
            const points: Pt[] = buckets.map((bucket, bucketIndex) => ({
              x: xFor(bucketIndex),
              y: yFor(values.get(`${bucket}:${item.key}`) ?? 0)
            }))
            return (
              <g key={item.key}>
                {points.length > 1 ? (
                  <path
                    className="chart-line"
                    d={compactHourly ? linePath(points) : smoothPath(points)}
                    stroke={MODEL_LINE_COLORS[series.indexOf(item) % MODEL_LINE_COLORS.length]}
                    strokeWidth={index === 0 ? 2.25 : 1.6}
                    opacity={index === 0 ? 0.95 : 0.7}
                    style={reduced || compactHourly ? { animation: 'none' } : undefined}
                  />
                ) : (
                  <circle
                    cx={points[0]?.x}
                    cy={points[0]?.y}
                    r={3.5}
                    fill={MODEL_LINE_COLORS[series.indexOf(item) % MODEL_LINE_COLORS.length]}
                  />
                )}
              </g>
            )
          })}
          <line className="chart-axis-line" x1={pad.l} x2={W - pad.r} y1={yFor(0)} y2={yFor(0)} />
          {buckets.map((bucket, index) => {
            if (index % labelStep !== 0 && index !== buckets.length - 1) return null
            return <text key={bucket} x={xFor(index)} y={H - 10} textAnchor="middle">{label(bucket)}</text>
          })}
        </svg>
        {hoverBucket ? (
          <div className="chart-tooltip model-usage-tooltip" style={{ left: probe.x, top: 8 }}>
            <div className="tt-title">{label(hoverBucket)}</div>
            {series
              .map((item) => ({ item, value: values.get(`${hoverBucket}:${item.key}`) ?? 0 }))
              .filter(({ value }) => value > 0)
              .sort((a, b) => b.value - a.value)
              .slice(0, 12)
              .map(({ item, value }) => (
                <div className="tt-row" key={item.key}>
                  <i style={{ background: MODEL_LINE_COLORS[series.indexOf(item) % MODEL_LINE_COLORS.length] }} />
                  <span>{item.model}</span>
                  <b>{fmt(value)}</b>
                </div>
              ))}
          </div>
        ) : null}
      </div>
      )}
    </div>
  )
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
  const H = 212
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
