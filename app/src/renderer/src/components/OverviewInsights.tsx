import { useMemo, useState } from 'react'
import type { DailyUsagePoint, ModelMixItem, OverviewMetrics, QuotaSnapshot, SessionRow } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { formatCurrency, formatResetAt, formatTokens } from '../lib/format'
import { weekdayLabel } from '../lib/chart'
import { DailyChart, type DailyMetric } from './DailyChart'
import { Modal } from './Modal'
import { QuotaCard } from './QuotaCard'
import { SessionsTable, type SessionSort } from './SessionsTable'

export function AllowanceStrip({ quotas, locale, timezone }: { quotas: QuotaSnapshot[]; locale: string; timezone: string }) {
  const [selected, setSelected] = useState<string | null>(null)
  const quota = quotas.find((q) => q.provider === selected)
  if (!quotas.length) return <div className="allowance-empty">No subscription allowance available for this provider. Local usage is shown below.</div>
  return <>
    <div className="allowance-strip" aria-label="Current provider allowances">
      {quotas.map((q) => {
        const meta = providerMeta(q.provider)
        const live = q.confidence === 'live' && !q.stale
        const value = q.auth_connected ? q.remaining_pct : null
        return <button key={q.provider} className="allowance-item" style={{ ['--tone' as string]: meta.color }} onClick={() => setSelected(q.provider)}>
          <span className="allowance-title"><i className="provider-glyph">{meta.short.slice(0, 1)}</i><strong>{meta.short}</strong><small>{q.stale ? 'Stale' : live ? 'Live' : 'Unavailable'}</small></span>
          <span className="allowance-value"><b>{value == null ? '—' : `${Math.round(value)}%`}</b><span>remaining</span><span className="allowance-arrow">↗</span></span>
          <span className="allowance-track"><i style={{ transform: `scaleX(${Math.max(0, Math.min(100, value ?? 0)) / 100})` }} /></span>
          <span className="allowance-reset">{q.window_label ?? 'No quota window'} · {q.reset_at ? `Resets ${formatResetAt(q.reset_at, locale, timezone)}` : 'Reset unavailable'}</span>
        </button>
      })}
    </div>
    {quota && <Modal title={`${providerMeta(quota.provider).short} allowance`} onClose={() => setSelected(null)}>
      <QuotaCard quota={quota} locale={locale} timezone={timezone} />
      <p className="dialog-note">Allowance windows are set by the provider and are independent of the analytics date filter.</p>
    </Modal>}
  </>
}

export function OverviewInsights({ daily, models, overview, sessions, currency, locale, timezone, onDay, onModel, onProject, sessionSort, onSort, onSessions }: {
  daily: DailyUsagePoint[]; models: ModelMixItem[]; overview: OverviewMetrics | null; sessions: SessionRow[]
  currency: string; locale: string; timezone: string; onDay: (day: string) => void; onModel: (model: string) => void; onProject: (project: string) => void
  sessionSort: SessionSort; onSort: (sort: SessionSort) => void; onSessions: () => void
}) {
  const [metric, setMetric] = useState<DailyMetric>('tokens')
  const projects = useMemo(() => {
    const totals = new Map<string, number>()
    for (const session of sessions) if (session.tokens_total != null) totals.set(session.project, (totals.get(session.project) ?? 0) + session.tokens_total)
    return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 5)
  }, [sessions])
  const topModels = useMemo(() => [...models].sort((a, b) => b.tokens_total - a.tokens_total).slice(0, 5), [models])
  const modelTotal = models.reduce((total, model) => total + model.tokens_total, 0)
  const split = overview ? [
    { label: 'Uncached input', value: overview.token_breakdown.uncached_input, color: 'var(--grok)' },
    { label: 'Cache reads', value: overview.token_breakdown.cached_input, color: 'var(--codex)' },
    { label: 'Cache writes', value: overview.token_breakdown.cache_creation, color: 'var(--opencode)' },
    { label: 'Output', value: overview.token_breakdown.output, color: 'var(--claude)' }
  ] : []
  return <>
    <div className="overview-primary">
      <article className="panel hero-chart">
        <div className="card-head"><div><span className="eyebrow">THE BIG PICTURE</span><h3>Usage over time</h3><p>Select a point to explore its sessions.</p></div>
          <select className="select" aria-label="Overview chart metric" value={metric} onChange={(e) => setMetric(e.target.value as DailyMetric)}>
            <option value="tokens">Tokens</option><option value="cost">API-equivalent cost</option><option value="calls">Model calls</option><option value="savings">Cache savings</option>
          </select>
        </div>
        <DailyChart data={daily} metric={metric} resolution="day" currency={currency} locale={locale} onSelectDay={onDay} />
      </article>
      <article className="panel composition-panel">
        <div className="card-head"><div><span className="eyebrow">UNDER THE SURFACE</span><h3>Token composition</h3><p>Where the work happens</p></div></div>
        <div className="composition-body">
          <div className="composition-total">{formatTokens(overview?.tokens_total ?? 0)}<span>total tokens</span></div>
          <div className="composition-bar" aria-label="Token composition">{split.map((part) => <i key={part.label} title={`${part.label}: ${formatTokens(part.value)}`} style={{ background: part.color, flex: part.value || '0 0 0px' }} />)}</div>
          {split.map((part) => <div className="composition-row" key={part.label}><i className="swatch" style={{ background: part.color }} /><span>{part.label}</span><strong>{formatTokens(part.value)}</strong></div>)}
          <p className="composition-note">Reasoning is included in output.</p>
          <div className="savings-callout"><span>Saved through caching</span><strong>{formatCurrency(overview?.cache_savings_usd ?? 0, currency, locale)}</strong><small>API-equivalent estimate</small></div>
        </div>
      </article>
    </div>
    <div className="grid grid-2">
      <article className="panel"><div className="card-head"><div><h3>Models in focus</h3><p>Share of tokens in the selected period</p></div><span className="status plain">{models.length} models</span></div>
        <div className="insight-ranks">{topModels.map((model, index) => <button key={`${model.provider}:${model.model}`} onClick={() => onModel(model.model)}>
          <span className="rank-index">{String(index + 1).padStart(2, '0')}</span><span className="insight-rank-main"><span><strong title={model.model}>{model.model}</strong><small>{formatTokens(model.tokens_total)}</small></span><i className="rank-track"><i style={{ width: `${modelTotal ? model.tokens_total / modelTotal * 100 : 0}%`, background: providerMeta(model.provider).color }} /></i></span><span className="rank-share">{modelTotal ? Math.round(model.tokens_total / modelTotal * 100) : 0}%</span>
        </button>)}{!models.length && <p className="empty">Models appear after your first session.</p>}</div>
      </article>
      <article className="panel"><div className="card-head"><div><h3>Active projects</h3><p>From the {sessions.length} loaded sessions · select to explore</p></div></div>
        <div className="insight-ranks">{projects.map(([project, tokens], index) => <button key={project} onClick={() => onProject(project)}><span className="rank-index">{String(index + 1).padStart(2, '0')}</span><span className="insight-rank-main"><span><strong title={project}>{project}</strong><small>{formatTokens(tokens)}</small></span><i className="rank-track"><i style={{ width: `${projects[0][1] ? tokens / projects[0][1] * 100 : 0}%`, background: 'var(--accent)' }} /></i></span><span className="rank-share">↗</span></button>)}{!projects.length && <p className="empty">Projects appear when sessions have token data.</p>}</div>
      </article>
    </div>
    <ActivityCalendar daily={daily} onDay={onDay} />
    <article className="panel"><div className="card-head"><div><h3>Session activity</h3><p>Five sessions from your current view · select a project for details</p></div><button className="btn ghost" onClick={onSessions}>View all sessions ↗</button></div>
      <SessionsTable sessions={sessions.slice(0, 5)} currency={currency} locale={locale} timezone={timezone} sort={sessionSort} onSort={onSort} />
    </article>
  </>
}

function ActivityCalendar({ daily, onDay }: { daily: DailyUsagePoint[]; onDay: (day: string) => void }) {
  const days = useMemo(() => {
    const totals = new Map<string, number>()
    for (const row of daily) totals.set(row.day, (totals.get(row.day) ?? 0) + row.tokens_total)
    const sorted = [...totals.keys()].sort()
    if (!sorted.length) return []
    const end = Date.parse(`${sorted[sorted.length - 1]}T00:00:00Z`)
    const start = Math.max(Date.parse(`${sorted[0]}T00:00:00Z`), end - 365 * 86400000)
    return Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, index) => {
      const day = new Date(start + index * 86400000).toISOString().slice(0, 10)
      return [day, totals.get(day) ?? null] as const
    })
  }, [daily])
  const max = Math.max(1, ...days.map(([, value]) => value ?? 0))
  if (!days.length) return null
  return <article className="panel activity-panel"><div className="card-head"><div><h3>Activity rhythm</h3><p>Daily token intensity · up to 366 recent days · dashed cells have no collected data</p></div><span className="activity-key">Less <i /><i /><i /><i /> More</span></div>
    <div className="activity-cells">{days.map(([day, tokens]) => <button key={day} disabled={tokens == null} className={tokens == null ? 'missing-day' : ''} aria-label={`${weekdayLabel(day)}: ${tokens == null ? 'No collected data' : `${formatTokens(tokens)} tokens; view sessions`}`} title={`${weekdayLabel(day)} · ${tokens == null ? 'No collected data' : `${formatTokens(tokens)} tokens`}`} onClick={() => onDay(day)} style={{ ['--intensity' as string]: tokens ? Math.max(0.16, tokens / max) : 0 }}><span>{day.slice(-2)}</span></button>)}</div>
    <div className="activity-dates"><span>{weekdayLabel(days[0][0])}</span><span>{weekdayLabel(days[days.length - 1][0])}</span></div>
  </article>
}
