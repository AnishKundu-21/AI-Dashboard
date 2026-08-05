import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AlertRow,
  AppSettings,
  BurnPoint,
  CollectorHealth,
  DailyUsagePoint,
  ModelMixItem,
  OverviewMetrics,
  ProjectionCard as ProjectionCardData,
  ProviderId,
  QuotaSnapshot,
  RangeDays,
  SessionRow
} from '@shared/types'
import { PROVIDER_META, PROVIDER_IDS } from '@shared/providers'
import { QuotaCard } from './components/QuotaCard'
import { DailyChart, type DailyMetric } from './components/DailyChart'
import { BurnChart } from './components/BurnChart'
import { ModelDonut } from './components/ModelDonut'
import { SettingsPanel } from './components/SettingsPanel'
import { SideNav, VIEWS, type ViewId } from './components/SideNav'
import { TopBar, type ProviderTab } from './components/TopBar'
import { StatCard } from './components/StatCard'
import { Sparkline } from './components/Sparkline'
import { SessionsTable, type SessionSort } from './components/SessionsTable'
import { AlertStack } from './components/AlertStack'
import { ProjectionCard } from './components/ProjectionCard'
import { HealthCard } from './components/HealthCard'
import { Toasts, type ToastItem } from './components/Toasts'
import { Segmented } from './components/Segmented'
import { IconClose, IconSearch, IconWarning } from './components/Icons'
import { formatCurrency, formatTokens, pctDelta, relativeTime } from './lib/format'
import { compact } from './lib/chart'
import { useCollapsedNav, useNow, useTheme } from './lib/hooks'

const EMPTY_BURN: Record<ProviderId, BurnPoint[]> = { grok: [], claude: [], codex: [] }

export default function App() {
  // Shell -----------------------------------------------------------------
  const [view, setView] = useState<ViewId>('overview')
  const [theme, setTheme] = useTheme()
  const [collapsed, setCollapsed] = useCollapsedNav()
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastId = useRef(0)

  // Filters ---------------------------------------------------------------
  const [provider, setProvider] = useState<ProviderTab>('all')
  const [rangeDays, setRangeDays] = useState<RangeDays>(7)
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedDay, setSelectedDay] = useState<string | undefined>()
  const [selectedModel, setSelectedModel] = useState<string | undefined>()
  const [sessionSort, setSessionSort] = useState<SessionSort>('started_at')
  const [sessionLimit, setSessionLimit] = useState(100)
  const [burnProvider, setBurnProvider] = useState<ProviderId>('grok')
  const [dailyMetric, setDailyMetric] = useState<DailyMetric>('tokens')

  // Requests --------------------------------------------------------------
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rescanning, setRescanning] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)

  // Data ------------------------------------------------------------------
  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot[]>([])
  const [daily, setDaily] = useState<DailyUsagePoint[]>([])
  const [burn, setBurn] = useState<Record<ProviderId, BurnPoint[]>>(EMPTY_BURN)
  const [models, setModels] = useState<ModelMixItem[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [projections, setProjections] = useState<ProjectionCardData[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [collectorHealth, setCollectorHealth] = useState<CollectorHealth[]>([])

  const searchRef = useRef<HTMLInputElement>(null)
  const now = useNow(20_000)

  const filter = useMemo(
    () => ({
      provider,
      range_days: rangeDays,
      search: searchDebounced || undefined,
      sort_by: 'started_at' as const,
      sort_dir: 'desc' as const,
      limit: 500,
      offset: 0
    }),
    [provider, rangeDays, searchDebounced]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 250)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    setSessionLimit(100)
  }, [provider, rangeDays, searchDebounced, selectedDay, selectedModel, sessionSort])

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'ok') => {
    const id = ++toastId.current
    setToasts((prev) => [...prev.slice(-2), { id, message, tone }])
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800)
  }, [])

  const load = useCallback(async () => {
    if (!window.api) {
      setError('window.api missing — run inside Electron (npm run dev)')
      setLoading(false)
      return
    }
    try {
      setError(null)
      const base = { provider, range_days: rangeDays }
      const [ov, q, d, burnList, m, s, p, a, st, health] = await Promise.all([
        window.api.getOverview(base),
        window.api.getQuotas(),
        window.api.getDailyUsage(base),
        Promise.all(
          PROVIDER_IDS.map((id) => window.api.getBurn({ provider: id, range_days: rangeDays }))
        ),
        window.api.getModelMix(base),
        window.api.getSessions({
          ...base,
          search: searchDebounced || undefined,
          day: selectedDay,
          model: selectedModel,
          sort_by: sessionSort,
          sort_dir: 'desc',
          limit: sessionLimit,
          offset: 0
        }),
        window.api.getProjections(),
        window.api.listAlerts(),
        window.api.getSettings(),
        window.api.getCollectorHealth()
      ])
      setOverview(ov)
      setQuotas(q)
      setDaily(d)
      setBurn({ grok: burnList[0] ?? [], claude: burnList[1] ?? [], codex: burnList[2] ?? [] })
      setModels(m)
      setSessions(s)
      setProjections(p)
      setAlerts(a)
      setSettings(st)
      setCollectorHealth(health)
      setLastSync(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [provider, rangeDays, searchDebounced, selectedDay, selectedModel, sessionSort, sessionLimit])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!window.api) return
    return window.api.onChanged(() => {
      void load()
    })
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setView('sessions')
        window.setTimeout(() => searchRef.current?.focus(), 60)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Derived ---------------------------------------------------------------

  const currency = settings?.display_currency ?? 'USD'
  const locale = settings?.locale ?? 'en-US'

  const visibleQuotas = useMemo(
    () => (provider === 'all' ? quotas : quotas.filter((q) => q.provider === provider)),
    [quotas, provider]
  )

  const liveCount = quotas.filter((q) => q.confidence === 'live' && !q.stale).length

  /** Per-day totals for the trend lines, ordered oldest → newest. */
  const series = useMemo(() => {
    const days = Array.from(new Set(daily.map((d) => d.day))).sort()
    const pick = (fn: (d: DailyUsagePoint) => number) =>
      days.map((day) => daily.filter((d) => d.day === day).reduce((s, d) => s + fn(d), 0))
    return {
      tokens: pick((d) => d.tokens_total),
      cost: pick((d) => d.api_equiv_usd),
      sessions: pick((d) => d.session_count)
    }
  }, [daily])

  /** Later half vs earlier half of the visible window — a trend, not a forecast. */
  const halfDelta = useCallback((values: number[]) => {
    if (values.length < 4) return null
    const mid = Math.floor(values.length / 2)
    const a = values.slice(0, mid).reduce((x, y) => x + y, 0)
    const b = values.slice(mid).reduce((x, y) => x + y, 0)
    return pctDelta(b, a)
  }, [])

  const deltaLabel = 'Later half vs earlier half of the selected range'

  const activeProjections = useMemo(
    () => projections.filter((p) => provider === 'all' || p.provider === provider),
    [projections, provider]
  )

  const meta = VIEWS.find((v) => v.id === view)!
  const filtersActive = Boolean(selectedDay || selectedModel || searchDebounced)

  // Actions ---------------------------------------------------------------

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await window.api.refreshQuotas()
      await load()
      pushToast('Quotas and sessions refreshed')
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Refresh failed', 'err')
    } finally {
      setRefreshing(false)
    }
  }

  const onExport = async (format: 'csv' | 'json') => {
    try {
      const result = await window.api.exportData({ format, filter })
      if (result.cancelled) {
        pushToast('Export cancelled')
        return
      }
      if (result.path) {
        pushToast(`Saved ${format.toUpperCase()}`)
        return
      }
      const blob = new Blob([result.content], {
        type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json'
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ai-usage-${provider}-${rangeFileLabel(rangeDays)}.${format}`
      a.click()
      URL.revokeObjectURL(url)
      pushToast(`Exported ${format.toUpperCase()}`)
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Export failed', 'err')
    }
  }

  const dismiss = async (id: string) => {
    await window.api.dismissAlert({ id })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  const saveSettings = async (partial: Partial<AppSettings>) => {
    const next = await window.api.setSettings(partial)
    setSettings(next)
    pushToast('Settings saved')
    await load()
  }

  const rescanProvider = async (id: ProviderId) => {
    setRescanning(id)
    try {
      const result = await window.api.rescanProvider({ provider: id })
      pushToast(`${PROVIDER_META[id].short}: ${result.upserted} sessions scanned`)
      await load()
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Rescan failed', 'err')
    } finally {
      setRescanning(null)
    }
  }

  const clearFilters = () => {
    setSelectedDay(undefined)
    setSelectedModel(undefined)
    setSearch('')
  }

  // Boot / fatal ----------------------------------------------------------

  if (loading) {
    return (
      <div className="boot">
        <span>Reading local session metadata</span>
        <div className="boot-bar">
          <i />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fatal">
        <IconWarning size={22} />
        <h2>Dashboard could not load</h2>
        <p>{error}</p>
        <button className="btn primary" type="button" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }

  // Views -----------------------------------------------------------------

  const filterBar = filtersActive ? (
    <div className="filter-bar">
      {selectedDay ? (
        <button type="button" className="chip" onClick={() => setSelectedDay(undefined)}>
          Day <b>{selectedDay}</b>
          <IconClose size={12} />
        </button>
      ) : null}
      {selectedModel ? (
        <button type="button" className="chip" onClick={() => setSelectedModel(undefined)}>
          Model <b>{selectedModel}</b>
          <IconClose size={12} />
        </button>
      ) : null}
      {searchDebounced ? (
        <button type="button" className="chip" onClick={() => setSearch('')}>
          Search <b>{searchDebounced}</b>
          <IconClose size={12} />
        </button>
      ) : null}
      <button type="button" className="btn ghost" onClick={clearFilters}>
        Clear
      </button>
    </div>
  ) : null

  const overviewView = (
    <div className="view">
      <div className="context">
        <div className="context-item">
          <span>Window</span>
          <strong>{rangeLabel(rangeDays)}</strong>
        </div>
        <div className="context-item">
          <span>Last sync</span>
          <strong>{relativeTime(lastSync, now)}</strong>
        </div>
        <div className="context-item">
          <span>Rate card</span>
          <strong>{overview?.rate_card_version ?? '—'}</strong>
        </div>
        <div className="context-item" style={{ marginLeft: 'auto' }}>
          <span>Live quota</span>
          <div className="context-providers">
            {PROVIDER_IDS.map((id) => {
              const q = quotas.find((x) => x.provider === id)
              const live = q?.confidence === 'live' && !q.stale
              return (
                <span key={id} className={`context-provider${live ? '' : ' off'}`}>
                  <i className="swatch" style={{ background: PROVIDER_META[id].color }} />
                  {PROVIDER_META[id].short}
                  <b>
                    {q?.remaining_pct != null ? `${Math.round(q.remaining_pct)}%` : '—'}
                  </b>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <AlertStack alerts={alerts} onDismiss={(id) => void dismiss(id)} />

      {overview ? (
        <div className="metrics">
          <StatCard
            label="Tokens"
            value={overview.tokens_total}
            format={(n) => formatTokens(n)}
            delta={halfDelta(series.tokens)}
            deltaLabel={deltaLabel}
            sub={`${formatTokens(overview.avg_daily_tokens)} per day · ${overview.token_breakdown.model_calls.toLocaleString()} model calls`}
          >
            <TokenSplit breakdown={overview.token_breakdown} />
          </StatCard>

          <StatCard
            label="API-equivalent"
            value={overview.api_equiv_usd}
            format={(n) => formatCurrency(n, currency, locale)}
            delta={halfDelta(series.cost)}
            deltaLabel={deltaLabel}
            sub="Comparison metric — not your subscription invoice"
          >
            <Sparkline values={series.cost} />
          </StatCard>

          <StatCard
            label="Sessions"
            value={overview.session_count}
            format={(n) => Math.round(n).toLocaleString()}
            delta={halfDelta(series.sessions)}
            deltaLabel={deltaLabel}
            sub="Project basenames only — never prompt content"
          >
            <Sparkline values={series.sessions} />
          </StatCard>

          <StatCard
            label="Avg quota used"
            value={overview.avg_used_pct ?? 0}
            format={(n) => (overview.avg_used_pct != null ? `${Math.round(n)}%` : '—')}
            sub={
              overview.avg_used_pct != null
                ? 'Mean across providers reporting live figures'
                : 'No live quota figures yet'
            }
          >
            <QuotaMeters quotas={quotas} />
          </StatCard>
        </div>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Remaining quota</h2>
            <p>
              A provider is marked live only when its usage API returns real figures.
              Percentages are never inferred.
            </p>
          </div>
        </div>
        <div className="grid grid-3">
          {visibleQuotas.map((q) => (
            <QuotaCard key={q.provider} quota={q} />
          ))}
        </div>
      </section>

      {overview && overview.by_provider.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Cost equivalent by provider</h2>
              <p>
                Rate card {overview.rate_card_version}, shown in {currency} via approximate FX.
              </p>
            </div>
            <span className="status plain">
              Total {formatCurrency(overview.api_equiv_usd, currency, locale)}
            </span>
          </div>
          <article className="panel">
            <div className="card-body">
              <Comparison overview={overview} currency={currency} locale={locale} />
            </div>
          </article>
        </section>
      ) : null}

      <Footer />
    </div>
  )

  const analyticsView = (
    <div className="view">
      {filterBar}
      <div className="grid grid-charts">
        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Daily usage</h3>
              <p>Timezone-aware totals · click a bar to filter sessions to that day</p>
            </div>
            <Segmented
              ariaLabel="Daily chart metric"
              value={dailyMetric}
              onChange={setDailyMetric}
              options={[
                { value: 'tokens', label: 'Tokens' },
                { value: 'cost', label: 'Cost' },
                { value: 'sessions', label: 'Sessions' }
              ]}
            />
          </div>
          <DailyChart
            data={daily}
            metric={dailyMetric}
            currency={currency}
            locale={locale}
            selectedDay={selectedDay}
            onSelectDay={(day) => setSelectedDay(day === selectedDay ? undefined : day)}
          />
        </article>

        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Quota burn</h3>
              <p>Observed snapshots with a dashed forecast</p>
            </div>
            <select
              className="select"
              value={burnProvider}
              aria-label="Burn chart provider"
              onChange={(e) => setBurnProvider(e.target.value as ProviderId)}
            >
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDER_META[id].name}
                </option>
              ))}
            </select>
          </div>
          <BurnChart data={burn[burnProvider]} provider={burnProvider} />
        </article>
      </div>

      <div className="grid grid-mix">
        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Model mix</h3>
              <p>Share of observed token volume</p>
            </div>
          </div>
          <div className="card-body">
            <ModelDonut
              models={models}
              selectedModel={selectedModel}
              onSelectModel={(model) =>
                setSelectedModel(model === selectedModel ? undefined : model)
              }
            />
          </div>
        </article>

        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Provider comparison</h3>
              <p>Relative volume over {rangeLabel(rangeDays).toLowerCase()}</p>
            </div>
          </div>
          <div className="card-body">
            <Comparison overview={overview} currency={currency} locale={locale} />
          </div>
        </article>
      </div>

      <Footer />
    </div>
  )

  const sessionsView = (
    <div className="view">
      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Sessions</h3>
            <p>
              {sessions.length.toLocaleString()} shown · metadata only, no prompt content
            </p>
          </div>
          <div className="head-tools">
            <label className="search">
              <IconSearch size={14} />
              <input
                ref={searchRef}
                className="input"
                type="text"
                placeholder="Search project or model"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search sessions"
              />
            </label>
            <select
              className="select"
              aria-label="Sort sessions"
              value={sessionSort}
              onChange={(e) => setSessionSort(e.target.value as SessionSort)}
            >
              <option value="started_at">Newest first</option>
              <option value="tokens_total">Most tokens</option>
              <option value="api_equiv_usd">Highest API-equiv</option>
              <option value="duration_ms">Longest duration</option>
            </select>
          </div>
        </div>

        {filterBar ? (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            {filterBar}
          </div>
        ) : null}

        <SessionsTable
          sessions={sessions}
          currency={currency}
          locale={locale}
          sort={sessionSort}
          onSort={setSessionSort}
        />

        <div className="table-foot">
          <span>
            {sessionLimit >= 500
              ? 'Showing the 500-row maximum — narrow the range or search for more detail.'
              : `Page size ${sessionLimit}`}
          </span>
          {sessions.length >= sessionLimit && sessionLimit < 500 ? (
            <button
              className="btn"
              type="button"
              onClick={() => setSessionLimit((n) => Math.min(n + 100, 500))}
            >
              Load more
            </button>
          ) : null}
        </div>
      </article>

      <Footer />
    </div>
  )

  const forecastView = (
    <div className="view">
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Burn pace and runway</h2>
            <p>
              Projected from usage observed in this window. These are estimates, not provider
              commitments.
            </p>
          </div>
        </div>
        {activeProjections.length === 0 ? (
          <div className="panel empty">
            <strong>No projections for this filter</strong>
            <p>Switch to all providers, or connect a CLI to start collecting burn history.</p>
          </div>
        ) : (
          <div className="grid grid-3">
            {activeProjections.map((p) => (
              <ProjectionCard
                key={p.provider}
                projection={p}
                quota={quotas.find((q) => q.provider === p.provider)}
              />
            ))}
          </div>
        )}
      </section>

      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Burn detail</h3>
            <p>Observed snapshots with a dashed forecast beyond the last measurement</p>
          </div>
          <select
            className="select"
            value={burnProvider}
            aria-label="Burn chart provider"
            onChange={(e) => setBurnProvider(e.target.value as ProviderId)}
          >
            {PROVIDER_IDS.map((id) => (
              <option key={id} value={id}>
                {PROVIDER_META[id].name}
              </option>
            ))}
          </select>
        </div>
        <BurnChart data={burn[burnProvider]} provider={burnProvider} />
      </article>

      <Footer />
    </div>
  )

  const healthView = (
    <div className="view">
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Collector health</h2>
            <p>Local source watchers, last successful parse, and per-provider rescan</p>
          </div>
          <span className="status plain">
            {collectorHealth.filter((h) => h.watcher_status === 'watching').length} of{' '}
            {collectorHealth.length} watching
          </span>
        </div>
        <div className="grid grid-3">
          {collectorHealth.map((health) => (
            <HealthCard
              key={health.provider}
              health={health}
              busy={rescanning === health.provider}
              onRescan={(id) => void rescanProvider(id)}
            />
          ))}
        </div>
      </section>
      <Footer />
    </div>
  )

  const settingsView = (
    <div className="view">
      {settings ? (
        <SettingsPanel settings={settings} onChange={saveSettings} />
      ) : (
        <div className="panel empty">
          <strong>Settings unavailable</strong>
          <p>The settings store could not be read from %APPDATA%.</p>
        </div>
      )}
      <Footer />
    </div>
  )

  const body =
    view === 'overview'
      ? overviewView
      : view === 'analytics'
        ? analyticsView
        : view === 'sessions'
          ? sessionsView
          : view === 'forecast'
            ? forecastView
            : view === 'health'
              ? healthView
              : settingsView

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}`}>
      <SideNav
        view={view}
        onView={setView}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        counts={{
          overview: { value: alerts.length, hot: true },
          sessions: { value: sessions.length },
          health: {
            value: collectorHealth.filter((h) => h.watcher_status === 'error').length,
            hot: true
          }
        }}
        liveCount={liveCount}
        lastSync={relativeTime(lastSync, now)}
      />

      <div className="main">
        <TopBar
          title={meta.title}
          provider={provider}
          onProvider={setProvider}
          rangeDays={rangeDays}
          onRange={setRangeDays}
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          onExport={(f) => void onExport(f)}
          theme={theme}
          onTheme={setTheme}
        />
        <main className="content" key={view}>
          {body}
        </main>
      </div>

      <Toasts items={toasts} />
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function TokenSplit({ breakdown }: { breakdown: OverviewMetrics['token_breakdown'] }) {
  const parts = [
    { key: 'input', label: 'in', value: breakdown.input, color: 'var(--grok)' },
    { key: 'output', label: 'out', value: breakdown.output, color: 'var(--codex)' },
    { key: 'cached', label: 'cached', value: breakdown.cached, color: 'var(--claude)' },
    { key: 'reasoning', label: 'reasoning', value: breakdown.reasoning, color: 'var(--border-2)' }
  ].filter((p) => p.value > 0)

  const total = parts.reduce((s, p) => s + p.value, 0)
  if (total === 0) return null

  return (
    <>
      <div className="split-bar">
        {parts.map((p, i) => (
          <i
            key={p.key}
            style={{
              width: `${(p.value / total) * 100}%`,
              background: p.color,
              animationDelay: `${i * 60}ms`
            }}
          />
        ))}
      </div>
      <div className="split-legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i style={{ background: p.color }} />
            {p.label} <b>{formatTokens(p.value)}</b>
          </span>
        ))}
      </div>
    </>
  )
}

/** Per-provider used-% meters, so the average has context. */
function QuotaMeters({ quotas }: { quotas: QuotaSnapshot[] }) {
  const measured = quotas.filter((q) => q.used_pct != null)
  if (measured.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {measured.map((q) => (
        <div
          key={q.provider}
          className="compare-row"
          style={{ ['--tone' as string]: PROVIDER_META[q.provider].color, height: 14, gridTemplateColumns: '52px 1fr 34px' }}
        >
          <span className="label" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {PROVIDER_META[q.provider].short}
          </span>
          <div className="meter">
            <i style={{ width: `${Math.min(100, q.used_pct ?? 0)}%` }} />
          </div>
          <span className="value" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {Math.round(q.used_pct ?? 0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

/** Grouped comparison bars: one group per measure, one row per provider. */
function Comparison({
  overview,
  currency,
  locale
}: {
  overview: OverviewMetrics | null
  currency: string
  locale: string
}) {
  const rows = overview?.by_provider ?? []
  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>Nothing to compare yet</strong>
        <p>Provider totals appear once at least one session has been collected.</p>
      </div>
    )
  }

  const groups = [
    {
      title: 'Tokens',
      max: Math.max(...rows.map((r) => r.tokens_total), 1),
      get: (r: (typeof rows)[number]) => r.tokens_total,
      fmt: (v: number) => compact(v)
    },
    {
      title: 'API-equivalent',
      max: Math.max(...rows.map((r) => r.api_equiv_usd), 1e-6),
      get: (r: (typeof rows)[number]) => r.api_equiv_usd,
      fmt: (v: number) => formatCurrency(v, currency, locale)
    },
    {
      title: 'Sessions',
      max: Math.max(...rows.map((r) => r.session_count), 1),
      get: (r: (typeof rows)[number]) => r.session_count,
      fmt: (v: number) => v.toLocaleString()
    }
  ]

  return (
    <>
      {groups.map((g) => (
        <div className="compare-group" key={g.title}>
          <div className="compare-title">{g.title}</div>
          {rows.map((r) => {
            const v = g.get(r)
            return (
              <div
                className="compare-row"
                key={r.provider}
                style={{ ['--tone' as string]: PROVIDER_META[r.provider].color }}
              >
                <span className="label">
                  <i className="swatch" style={{ background: PROVIDER_META[r.provider].color }} />
                  {PROVIDER_META[r.provider].name}
                </span>
                <div className="meter">
                  <i
                    style={{
                      width: `${Math.max((v / g.max) * 100, 1)}%`,
                      animation: 'grow-x 420ms var(--ease) backwards'
                    }}
                  />
                </div>
                <span className="value">{g.fmt(v)}</span>
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <span>Quota read via CLI auth in the main process · metadata only, no prompt content</span>
      <span>Electron · SQLite · local-first</span>
    </footer>
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
