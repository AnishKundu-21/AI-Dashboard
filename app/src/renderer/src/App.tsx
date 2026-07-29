import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  AlertRow,
  AppSettings,
  BurnPoint,
  DailyUsagePoint,
  ModelMixItem,
  OverviewMetrics,
  ProjectionCard,
  ProviderId,
  QuotaSnapshot,
  RangeDays,
  SessionRow
} from '@shared/types'
import { PROVIDER_META } from '@shared/providers'
import { QuotaCard } from './components/QuotaCard'
import { DailyChart } from './components/DailyChart'
import { BurnChart } from './components/BurnChart'
import { ModelDonut } from './components/ModelDonut'
import { SettingsPanel } from './components/SettingsPanel'
import {
  confidenceBadge,
  formatCurrency,
  formatDuration,
  formatTokens
} from './lib/format'

type ProviderTab = ProviderId | 'all'

export default function App() {
  const [provider, setProvider] = useState<ProviderTab>('all')
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [burnProvider, setBurnProvider] = useState<ProviderId>('grok')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot[]>([])
  const [daily, setDaily] = useState<DailyUsagePoint[]>([])
  const [burn, setBurn] = useState<BurnPoint[]>([])
  const [models, setModels] = useState<ModelMixItem[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [projections, setProjections] = useState<ProjectionCard[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)

  const filter = useMemo(
    () => ({
      provider,
      range_days: rangeDays,
      search: searchDebounced || undefined
    }),
    [provider, rangeDays, searchDebounced]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 250)
    return () => window.clearTimeout(t)
  }, [search])

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2400)
  }

  const load = useCallback(async () => {
    if (!window.api) {
      setError('window.api missing — run inside Electron (npm run dev)')
      setLoading(false)
      return
    }
    try {
      setError(null)
      const base = { provider, range_days: rangeDays }
      const [ov, q, d, b, m, s, p, a, st] = await Promise.all([
        window.api.getOverview(base),
        window.api.getQuotas(),
        window.api.getDailyUsage(base),
        window.api.getBurn({ provider: burnProvider, range_days: rangeDays }),
        window.api.getModelMix(base),
        window.api.getSessions({
          ...base,
          search: searchDebounced || undefined
        }),
        window.api.getProjections(),
        window.api.listAlerts(),
        window.api.getSettings()
      ])
      setOverview(ov)
      setQuotas(q)
      setDaily(d)
      setBurn(b)
      setModels(m)
      setSessions(s)
      setProjections(p)
      setAlerts(a)
      setSettings(st)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [provider, rangeDays, searchDebounced, burnProvider])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!window.api) return
    return window.api.onChanged(() => {
      void load()
    })
  }, [load])

  const visibleQuotas = useMemo(() => {
    if (provider === 'all') return quotas
    return quotas.filter((q) => q.provider === provider)
  }, [quotas, provider])

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await window.api.refreshQuotas()
      await load()
      showToast('Quotas & sessions refreshed')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  const onExport = async (format: 'csv' | 'json') => {
    try {
      const result = await window.api.exportData({ format, filter })
      if (result.cancelled) {
        showToast('Export cancelled')
        return
      }
      if (result.path) {
        showToast(`Saved ${format.toUpperCase()}`)
        return
      }
      // Fallback download if dialog unavailable
      const blob = new Blob([result.content], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-usage-${provider}-${rangeFileLabel(rangeDays)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      showToast(`Exported ${format.toUpperCase()}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Export failed')
    }
  }

  const dismiss = async (id: string) => {
    await window.api.dismissAlert({ id })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  const saveSettings = async (partial: Partial<AppSettings>) => {
    const next = await window.api.setSettings(partial)
    setSettings(next)
    showToast('Settings saved')
    await load()
  }

  const currency = settings?.display_currency ?? 'USD'
  const locale = settings?.locale ?? 'en-US'

  if (loading) {
    return <div className="loading">Loading dashboard…</div>
  }

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
        <button className="btn primary" type="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">AI</div>
          <div>
            <h1>Local Usage Dashboard</h1>
            <p>Grok Build · Claude Code · Codex CLI</p>
          </div>
        </div>
        <div className="top-actions">
          <div className="live-status">
            <span className="pulse" />
            <span>
              {quotas.some((q) => q.confidence === 'live' && !q.stale)
                ? `Real-time · ${quotas.filter((q) => q.confidence === 'live' && !q.stale).length} AUTH LIVE`
                : 'Real-time local monitoring · quota connecting'}
            </span>
          </div>
          <button className="btn" type="button" onClick={() => void onExport('json')}>
            Export JSON
          </button>
          <button className="btn" type="button" onClick={() => void onExport('csv')}>
            Export CSV
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={refreshing}
            onClick={() => void onRefresh()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh quotas'}
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow">Private by default · Local-first</div>
          <h2>See where your coding-agent allowance actually goes.</h2>
          <p>
            Remaining quota, sessions by project, API-equivalent cost (rate card{' '}
            {overview?.rate_card_version ?? '—'}), burn projections, and exports —
            all from local CLI metadata.
          </p>
        </section>

        <section className="toolbar panel" aria-label="Dashboard controls">
          <div className="segmented">
            {(['all', 'grok', 'claude', 'codex'] as const).map((p) => (
              <button
                key={p}
                type="button"
                className={provider === p ? 'active' : ''}
                onClick={() => setProvider(p)}
              >
                {p === 'all' ? 'All providers' : PROVIDER_META[p].short}
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
              {provider === 'all' ? 'All providers' : PROVIDER_META[provider].name} ·{' '}
              {rangeLabel(rangeDays)} · {currency}
            </span>
            <select
              value={rangeDays}
              aria-label="Date range"
              onChange={(e) => setRangeDays(Number(e.target.value) as RangeDays)}
            >
              <option value={1}>Today</option>
              <option value={3}>Last 3 days</option>
              <option value={5}>Last 5 days</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={180}>Last 180 days</option>
              <option value={365}>Last 365 days</option>
              <option value={0}>Lifetime</option>
            </select>
          </div>
        </section>

        <div className="alert-stack">
          {alerts.map((a) => (
            <div key={a.id} className={`alert ${a.level}`}>
              <div className="alert-icon">{a.level === 'warn' ? '⚠' : 'ℹ'}</div>
              <div>
                <strong>{a.title}</strong>
                <p>{a.body}</p>
              </div>
              <button
                className="alert-close"
                type="button"
                aria-label="Dismiss"
                onClick={() => void dismiss(a.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {overview ? (
          <section className="overview-grid" aria-label="Usage overview">
            <article className="metric panel">
              <div className="metric-label">Tokens</div>
              <div className="metric-value">
                {formatTokens(overview.tokens_total)}
              </div>
              <div className="metric-sub">
                ~{formatTokens(overview.avg_daily_tokens)}/day ·{' '}
                {rangeLabel(overview.range_days)}
              </div>
            </article>
            <article className="metric panel">
              <div className="metric-label">API-equivalent</div>
              <div className="metric-value">
                {formatCurrency(overview.api_equiv_usd, currency, locale)}
              </div>
              <div className="metric-sub">Comparison metric, not bill</div>
            </article>
            <article className="metric panel">
              <div className="metric-label">Sessions</div>
              <div className="metric-value">{overview.session_count}</div>
              <div className="metric-sub">Metadata only · no prompts</div>
            </article>
            <article className="metric panel">
              <div className="metric-label">Avg quota used</div>
              <div className="metric-value">
                {overview.avg_used_pct != null
                  ? `${Math.round(overview.avg_used_pct)}%`
                  : '—'}
              </div>
              <div className="metric-sub">Across connected providers</div>
            </article>
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <div>
              <h3>Live remaining quotas</h3>
              <p>
                AUTH LIVE only when a real usage API returns figures — never invent
                percentages.
              </p>
            </div>
            <span className="badge info">Auth tokens never leave main process</span>
          </div>
          <div className="quota-grid">
            {visibleQuotas.map((q) => (
              <QuotaCard key={q.provider} quota={q} />
            ))}
          </div>
          {overview ? (
            <div className="cost-callout panel">
              <div>
                <h4>API-equivalent cost (current view)</h4>
                <p>
                  Rate card {overview.rate_card_version} · shown as {currency} via
                  approximate FX · not your subscription invoice.
                </p>
                {overview.by_provider.length > 0 ? (
                  <div className="cost-by-provider">
                    {overview.by_provider.map((bp) => (
                      <div key={bp.provider} className="cost-chip">
                        <span style={{ color: PROVIDER_META[bp.provider].color }}>
                          {PROVIDER_META[bp.provider].short}
                        </span>
                        <strong>
                          {formatCurrency(bp.api_equiv_usd, currency, locale)}
                        </strong>
                        <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                          {formatTokens(bp.tokens_total)} · {bp.session_count} sessions
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="cost-stat">
                <span>Total</span>
                <strong>
                  {formatCurrency(overview.api_equiv_usd, currency, locale)}
                </strong>
              </div>
              <div className="cost-stat">
                <span>Tokens</span>
                <strong>{formatTokens(overview.tokens_total)}</strong>
              </div>
              <div className="cost-stat">
                <span>Sessions</span>
                <strong>{overview.session_count}</strong>
              </div>
            </div>
          ) : null}
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h3>Usage analytics</h3>
              <p>Solid = observed · dashed = projection</p>
            </div>
          </div>
          <div className="chart-grid">
            <article className="chart-card panel">
              <div className="chart-head">
                <div>
                  <h4>Daily token usage</h4>
                  <p>From local usage_daily rollups</p>
                </div>
              </div>
              <DailyChart data={daily} />
            </article>
            <article className="chart-card panel">
              <div className="chart-head">
                <div>
                  <h4>Quota burn & projection</h4>
                  <p>Snapshot history when available · 3-day dashed forecast</p>
                </div>
                <select
                  value={burnProvider}
                  aria-label="Burn chart provider"
                  onChange={(e) => setBurnProvider(e.target.value as ProviderId)}
                >
                  <option value="grok">Grok Build</option>
                  <option value="claude">Claude Code</option>
                  <option value="codex">Codex CLI</option>
                </select>
              </div>
              <BurnChart data={burn} />
            </article>
          </div>
        </section>

        <section className="section">
          <div className="bottom-grid">
            <article className="model-card panel">
              <div className="chart-head">
                <div>
                  <h4>Model mix</h4>
                  <p>Share of observed token volume</p>
                </div>
              </div>
              <ModelDonut models={models} />
            </article>
            <article className="sessions-card panel">
              <div className="chart-head">
                <div>
                  <h4>Recent sessions</h4>
                  <p>Project basenames only · no content · {sessions.length} shown</p>
                </div>
                <div className="table-tools">
                  <input
                    type="text"
                    placeholder="Search project or model"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Project</th>
                      <th>Model</th>
                      <th className="num">Tokens</th>
                      <th className="num">API-equiv</th>
                      <th className="num">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ color: 'var(--muted)' }}>
                          No sessions in this view
                        </td>
                      </tr>
                    ) : (
                      sessions.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <span className="provider-pill">
                              <i
                                style={{
                                  background: PROVIDER_META[s.provider].color
                                }}
                              />
                              {PROVIDER_META[s.provider].short}
                            </span>
                          </td>
                          <td>{s.project}</td>
                          <td>{s.model}</td>
                          <td className="num">
                            {s.tokens_total != null
                              ? formatTokens(s.tokens_total)
                              : '—'}
                          </td>
                          <td className="num">
                            {s.api_equiv_usd != null
                              ? formatCurrency(s.api_equiv_usd, currency, locale)
                              : '—'}
                          </td>
                          <td className="num">{formatDuration(s.duration_ms)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <div>
              <h3>Forecasts & recommendations</h3>
              <p>Burn pace from window usage · not provider promises</p>
            </div>
          </div>
          <div className="projection-grid">
            {projections
              .filter((p) => provider === 'all' || p.provider === provider)
              .map((p) => {
                const q = quotas.find((x) => x.provider === p.provider)
                const badge = q
                  ? confidenceBadge(q.confidence, q.auth_connected, q.stale)
                  : { label: '—', className: 'info' }
                return (
                  <article key={p.provider} className="projection panel">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <h4>{PROVIDER_META[p.provider].name}</h4>
                      <span className={`badge ${badge.className}`}>{badge.label}</span>
                    </div>
                    <strong>{p.headline}</strong>
                    <p>{p.detail}</p>
                    {p.days_to_empty != null || p.daily_burn_pct != null ? (
                      <p style={{ marginTop: 8 }}>
                        {p.daily_burn_pct != null
                          ? `~${p.daily_burn_pct.toFixed(1)}%/day burn`
                          : null}
                        {p.days_to_empty != null
                          ? ` · ~${p.days_to_empty}d runway`
                          : null}
                      </p>
                    ) : null}
                    {p.recommendation ? (
                      <div className="rec">{p.recommendation}</div>
                    ) : null}
                  </article>
                )
              })}
          </div>
        </section>

        {settings ? (
          <SettingsPanel settings={settings} onChange={saveSettings} />
        ) : null}

        <footer className="footer">
          <span>
            Live quota via CLI auth · plans per-user · rate card for API-equiv only.
          </span>
          <span>Electron · SQLite · metadata only · Phase 3</span>
        </footer>
      </main>

      <div className={`toast${toast ? ' show' : ''}`} role="status">
        {toast}
      </div>
    </div>
  )
}

function rangeLabel(days: RangeDays): string {
  if (days === 0) return 'Lifetime'
  if (days === 1) return 'Today'
  return `Last ${days} days`
}

function rangeFileLabel(days: RangeDays): string {
  return days === 0 ? 'lifetime' : `${days}d`
}
