import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AlertRow,
  AnalyticsSnapshot,
  AppSettings,
  BurnSeries,
  CollectorHealth,
  DailyUsagePoint,
  ModelMixItem,
  ModelUsagePoint,
  OverviewMetrics,
  ProjectionCard as ProjectionCardData,
  ProviderId,
  QuotaSnapshot,
  RangeDays,
  SessionRow,
  UsageResolution
} from '@shared/types'
import {
  enabledProviderIds as getEnabledProviderIds,
  providerMeta,
  providerIds
} from '@shared/providers'
import { QuotaCard } from './components/QuotaCard'
import { DailyChart, type DailyMetric } from './components/DailyChart'
import { BurnChart } from './components/BurnChart'
import {
  ANALYTICS_METRICS,
  AnalyticsRankChart,
  AnalyticsTable,
  ModelUsageChart,
  type AnalyticsMetric
} from './components/AnalyticsBreakdown'
import { SettingsPanel } from './components/SettingsPanel'
import { SideNav, VIEWS, type ViewId } from './components/SideNav'
import { TopBar, type ProviderTab } from './components/TopBar'
import { StatCard } from './components/StatCard'
import { Sparkline } from './components/Sparkline'
import { SessionsTable, type SessionSort } from './components/SessionsTable'
import { AlertStack } from './components/AlertStack'
import { ProjectionCard } from './components/ProjectionCard'
import { HealthCard } from './components/HealthCard'
import { Onboarding } from './components/Onboarding'
import { Toasts, type ToastItem } from './components/Toasts'
import { IconClose, IconSearch, IconWarning } from './components/Icons'
import {
  formatCurrency,
  formatTokens,
  pctDelta,
  relativeTime,
  setFxRates
} from './lib/format'
import { compact } from './lib/chart'
import { useCollapsedNav, useNow, useTheme } from './lib/hooks'

function dayInUsageTimeZone(timezone: string | undefined, timestampMs: number): string {
  const timeZone = !timezone || timezone === 'system' ? undefined : timezone
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date(timestampMs))
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '01'
    return `${value('year')}-${value('month')}-${value('day')}`
  } catch {
    return new Date(timestampMs).toISOString().slice(0, 10)
  }
}

function modelChartKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

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
  const [customAnalyticsRange, setCustomAnalyticsRange] = useState<
    { start_day: string; end_day: string } | undefined
  >()
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')
  const [selectedDay, setSelectedDay] = useState<string | undefined>()
  const [selectedModel, setSelectedModel] = useState<string | undefined>()
  const [sessionSort, setSessionSort] = useState<SessionSort>('started_at')
  const [sessionLimit, setSessionLimit] = useState(100)
  const [burnProvider, setBurnProvider] = useState<ProviderId | 'all'>('all')
  const [dailyMetric, setDailyMetric] = useState<DailyMetric>('tokens')
  const [usageResolution, setUsageResolution] = useState<UsageResolution>('day')
  const [analyticsMetric, setAnalyticsMetric] = useState<AnalyticsMetric>('tokens_total')
  const [modelChartFilter, setModelChartFilter] = useState('all')

  // Requests --------------------------------------------------------------
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [rescanning, setRescanning] = useState<ProviderId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)

  // Data ------------------------------------------------------------------
  const [overview, setOverview] = useState<OverviewMetrics | null>(null)
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState<AnalyticsSnapshot | null>(null)
  const [quotas, setQuotas] = useState<QuotaSnapshot[]>([])
  const [daily, setDaily] = useState<DailyUsagePoint[]>([])
  const [modelUsage, setModelUsage] = useState<ModelUsagePoint[]>([])
  const [burnSeries, setBurnSeries] = useState<BurnSeries[]>([])
  const [models, setModels] = useState<ModelMixItem[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [projections, setProjections] = useState<ProjectionCardData[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [collectorHealth, setCollectorHealth] = useState<CollectorHealth[]>([])

  const searchRef = useRef<HTMLInputElement>(null)
  const now = useNow(20_000)
  const maxCustomEndDay = dayInUsageTimeZone(settings?.timezone, now)

  const activePeriod = useMemo(
    () => (view === 'analytics' && customAnalyticsRange
      ? customAnalyticsRange
      : { range_days: rangeDays }),
    [customAnalyticsRange, rangeDays, view]
  )
  const isLifetimeAnalytics =
    view === 'analytics' && 'range_days' in activePeriod && activePeriod.range_days === 0
  const chartResolution = view === 'analytics' && !isLifetimeAnalytics ? usageResolution : 'day'

  const filter = useMemo(
    () => ({
      provider,
      ...activePeriod,
      search: searchDebounced || undefined,
      sort_by: 'started_at' as const,
      sort_dir: 'desc' as const,
      limit: 500,
      offset: 0
    }),
    [activePeriod, provider, searchDebounced]
  )

  useEffect(() => {
    const t = window.setTimeout(() => setSearchDebounced(search), 250)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    setSessionLimit(100)
  }, [activePeriod, provider, searchDebounced, selectedDay, selectedModel, sessionSort])

  useEffect(() => {
    if (isLifetimeAnalytics && usageResolution !== 'day') {
      setUsageResolution('day')
    }
  }, [isLifetimeAnalytics, usageResolution])

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
      const base = { provider, ...activePeriod }
      const [ov, q, d, burnList, m, s, p, a, st, health] = await Promise.all([
        window.api.getOverview(base),
        window.api.getQuotas(),
        window.api.getDailyUsage({ ...base, resolution: chartResolution }),
        window.api.getBurnSeries({ provider: 'all', range_days: rangeDays }),
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
      // Install the rates main converted with, so both sides agree.
      setFxRates(ov?.fx?.rates)
      setOverview(ov)
      setQuotas(q)
      setDaily(d)
      setBurnSeries(burnList)
      setModels(m)
      setSessions(s)
      setProjections(p)
      setAlerts(a)
      setSettings(st)
      setCollectorHealth(health)
      setLastSync(new Date().toISOString())
      if (view === 'analytics') {
        try {
          setAnalyticsSnapshot(await window.api.getAnalyticsSnapshot(base))
        } catch {
          // The regular dashboard remains useful even if the optional
          // comparison snapshot cannot be generated on an older database.
          setAnalyticsSnapshot(null)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [activePeriod, chartResolution, provider, searchDebounced, selectedDay, selectedModel, sessionSort, sessionLimit, view])

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
    if (!window.api || view !== 'analytics') {
      setModelUsage([])
      return
    }
    let cancelled = false
    void window.api.getModelUsage({
      provider,
      ...activePeriod,
      resolution: chartResolution,
      model_key: modelChartFilter === 'all' ? undefined : modelChartFilter
    }).then((rows) => {
      if (!cancelled) setModelUsage(rows)
    }).catch(() => {
      if (!cancelled) setModelUsage([])
    })
    return () => {
      cancelled = true
    }
  }, [activePeriod, chartResolution, lastSync, modelChartFilter, provider, view])

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
  const enabledProviders = useMemo(
    () => (settings ? getEnabledProviderIds(settings) : providerIds()),
    [settings]
  )
  const quotaProviders = useMemo(
    () => enabledProviders.filter((id) => providerMeta(id).reportsQuota),
    [enabledProviders]
  )

  useEffect(() => {
    if (modelChartFilter === 'all') return
    if (!models.some((row) => modelChartKey(row.provider, row.model) === modelChartFilter)) {
      setModelChartFilter('all')
    }
  }, [modelChartFilter, models])

  useEffect(() => {
    if (provider !== 'all' && !enabledProviders.includes(provider)) {
      setProvider('all')
    }
    if (burnProvider !== 'all' && !quotaProviders.includes(burnProvider) && quotaProviders[0]) {
      setBurnProvider(quotaProviders[0])
    }
  }, [burnProvider, enabledProviders, provider, quotaProviders])

  const visibleQuotas = useMemo(
    () =>
      quotas.filter(
        (q) =>
          providerMeta(q.provider).reportsQuota &&
          (provider === 'all' || q.provider === provider)
      ),
    [quotas, provider]
  )

  const liveCount = quotas.filter((q) => q.confidence === 'live' && !q.stale).length

  const diagnosticsSummary = useMemo(() => {
    const enabled = new Set(collectorHealth.map((item) => item.provider))
    const providerQuotas = quotas.filter((item) => enabled.has(item.provider))
    const quotaIssues = providerQuotas.filter((item) =>
      ['not_connected', 'auth_unreadable', 'probe_failed'].includes(
        item.unavailable?.reason ?? ''
      )
    ).length
    const quotaNotices =
      providerQuotas.filter((item) => item.unavailable != null).length +
      collectorHealth.filter(
        (health) => !providerQuotas.some((quota) => quota.provider === health.provider)
      ).length
    return {
      providers: collectorHealth.length,
      activeCollectors: collectorHealth.filter(
        (item) => item.watcher_status === 'watching' || item.watcher_status === 'polling'
      ).length,
      sessions: collectorHealth.reduce((total, item) => total + item.sessions_seen, 0),
      liveQuotas: providerQuotas.filter(
        (item) => item.confidence === 'live' && !item.stale
      ).length,
      quotaNotices,
      issues:
        collectorHealth.filter(
          (item) => item.watcher_status === 'error' || item.watcher_status === 'missing' || item.last_error
        ).length + quotaIssues
    }
  }, [collectorHealth, quotas])

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
    () =>
      projections.filter(
        (p) =>
          providerMeta(p.provider).reportsQuota &&
          (provider === 'all' || p.provider === provider)
      ),
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
      const exportRange = 'start_day' in activePeriod
        ? `${activePeriod.start_day}-to-${activePeriod.end_day}`
        : rangeFileLabel(activePeriod.range_days)
      a.download = `ai-usage-${provider}-${exportRange}.${format}`
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

  const finishOnboarding = async (
    enabledProviders: Record<ProviderId, boolean>,
    scan: boolean
  ) => {
    setRefreshing(scan)
    try {
      const next = await window.api.setSettings({
        ...(scan ? { enabled_providers: enabledProviders } : {}),
        ...(scan ? {} : { onboarding_completed: true })
      })
      if (scan) {
        // Keep onboarding open and retryable until the initial scan has
        // completed. Provider selections are durable even if a refresh fails.
        await window.api.refreshQuotas()
        const completed = await window.api.setSettings({ onboarding_completed: true })
        setSettings(completed)
      } else {
        setSettings(next)
      }
      await load()
      pushToast(scan ? 'Setup complete — usage is updating' : 'Setup skipped — change it any time in Settings')
    } finally {
      setRefreshing(false)
    }
  }

  const rescanProvider = async (id: ProviderId) => {
    setRescanning(id)
    try {
      const result = await window.api.rescanProvider({ provider: id })
      pushToast(`${providerMeta(id).short}: ${result.upserted} sessions scanned`)
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

  const analyticsCurrent = analyticsSnapshot?.current
  const analyticsPrevious = analyticsSnapshot?.previous?.totals
  const apiCostHasPartialCoverage =
    (analyticsCurrent?.unpriced_sessions ?? 0) > 0 ||
    (analyticsPrevious?.unpriced_sessions ?? 0) > 0

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
          <span>Model prices</span>
          <strong title={pricingTitle(overview)}>{pricingLabel(overview)}</strong>
        </div>
        <div className="context-item" style={{ marginLeft: 'auto' }}>
          <span>Live quota</span>
          <div className="context-providers">
            {quotaProviders.map((id) => {
              const q = quotas.find((x) => x.provider === id)
              const live = q?.confidence === 'live' && !q.stale
              return (
                <span key={id} className={`context-provider${live ? '' : ' off'}`}>
                  <i className="swatch" style={{ background: providerMeta(id).color }} />
                  {providerMeta(id).short}
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
        {visibleQuotas.length === 0 ? (
          <div className="panel empty">
            <strong>No subscription quota for this filter</strong>
            <p>
              {provider !== 'all' && !providerMeta(provider).reportsQuota
                ? `${providerMeta(provider).name} contributes local usage and cost, but does not expose a quota window.`
                : 'Enable a quota-capable provider in Settings to show remaining limits.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-3">
            {visibleQuotas.map((q) => (
              <QuotaCard
                key={q.provider}
                quota={q}
                locale={locale}
                timezone={settings?.timezone ?? 'system'}
              />
            ))}
          </div>
        )}
      </section>

      {overview && overview.by_provider.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <div>
              <h2>Cost equivalent by provider</h2>
              <p>
                {pricingLabel(overview)} · {fxLabel(overview, currency)}
                {overview.unpriced_sessions > 0
                  ? ` · ${overview.unpriced_sessions} session${
                      overview.unpriced_sessions === 1 ? '' : 's'
                    } include an unpriced model, so this total is a floor`
                  : ''}
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
      {overview ? (
        <>
          {analyticsSnapshot ? (
            <p className="analytics-period-note">
              {analyticsSnapshot.window.label} · {analyticsSnapshot.window.timezone}
              {analyticsSnapshot.previous
                ? ` · compared with ${analyticsSnapshot.previous.window.label}`
                : ' · lifetime has no equivalent prior period'}
            </p>
          ) : null}
          <div className="analytics-kpis">
            <AnalyticsKpi label="Total tokens" value={formatTokens(analyticsCurrent?.tokens_total ?? overview.tokens_total)} current={analyticsCurrent?.tokens_total} previous={analyticsPrevious?.tokens_total} />
            <AnalyticsKpi label="Uncached input" value={formatTokens(analyticsCurrent?.token_breakdown.uncached_input ?? overview.token_breakdown.uncached_input)} current={analyticsCurrent?.token_breakdown.uncached_input} previous={analyticsPrevious?.token_breakdown.uncached_input} />
            <AnalyticsKpi label="Cache reads" value={formatTokens(analyticsCurrent?.token_breakdown.cached_input ?? overview.token_breakdown.cached_input)} current={analyticsCurrent?.token_breakdown.cached_input} previous={analyticsPrevious?.token_breakdown.cached_input} />
            <AnalyticsKpi label="Cache writes" value={formatTokens(analyticsCurrent?.token_breakdown.cache_creation ?? overview.token_breakdown.cache_creation)} current={analyticsCurrent?.token_breakdown.cache_creation} previous={analyticsPrevious?.token_breakdown.cache_creation} />
            <AnalyticsKpi label="Cache hit rate" value={formatCacheHitRate(analyticsCurrent?.token_breakdown ?? overview.token_breakdown)} current={cacheHitRate(analyticsCurrent?.token_breakdown ?? overview.token_breakdown)} previous={analyticsPrevious ? cacheHitRate(analyticsPrevious.token_breakdown) : undefined} note="reads / reusable input" />
            <AnalyticsKpi label="Output" value={formatTokens(analyticsCurrent?.token_breakdown.output ?? overview.token_breakdown.output)} current={analyticsCurrent?.token_breakdown.output} previous={analyticsPrevious?.token_breakdown.output} />
            <AnalyticsKpi label="Reasoning" value={formatTokens(analyticsCurrent?.token_breakdown.reasoning ?? overview.token_breakdown.reasoning)} current={analyticsCurrent?.token_breakdown.reasoning} previous={analyticsPrevious?.token_breakdown.reasoning} note="subset of output" />
            <AnalyticsKpi label="Model calls" value={(analyticsCurrent?.token_breakdown.model_calls ?? overview.token_breakdown.model_calls).toLocaleString(locale)} current={analyticsCurrent?.token_breakdown.model_calls} previous={analyticsPrevious?.token_breakdown.model_calls} />
            <AnalyticsKpi label="API-equivalent" value={formatCurrency(analyticsCurrent?.api_equiv_usd ?? overview.api_equiv_usd, currency, locale)} current={analyticsCurrent?.api_equiv_usd} previous={apiCostHasPartialCoverage ? undefined : analyticsPrevious?.api_equiv_usd} note={apiCostHasPartialCoverage ? 'Partial pricing coverage — comparison withheld' : undefined} />
            <AnalyticsKpi label="Cache savings" value={formatCurrency(analyticsCurrent?.cache_savings_usd ?? overview.cache_savings_usd, currency, locale)} current={analyticsCurrent?.cache_savings_usd} previous={analyticsPrevious?.cache_savings_usd} />
          </div>
        </>
      ) : null}

      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Usage over time by provider</h3>
            <p>
              {chartResolution === 'day'
                ? 'Event-grain, timezone-aware totals · click the chart to filter sessions to that day'
                : `Event-grain, timezone-aware ${chartResolution} buckets`}
            </p>
          </div>
          <div className="analytics-chart-controls">
            <select
              className="select analytics-metric-select"
              value={chartResolution}
              aria-label="Usage chart resolution"
              onChange={(e) => {
                setUsageResolution(e.target.value as UsageResolution)
                setSelectedDay(undefined)
              }}
            >
              <option value="hour" disabled={isLifetimeAnalytics}>Hourly</option>
              <option value="day">Daily</option>
              <option value="week" disabled={isLifetimeAnalytics}>Weekly (Mon start)</option>
              <option value="month" disabled={isLifetimeAnalytics}>Monthly</option>
            </select>
            <select
              className="select analytics-metric-select"
              value={dailyMetric}
              aria-label="Usage chart metric"
              onChange={(e) => setDailyMetric(e.target.value as DailyMetric)}
            >
              <option value="tokens">Total tokens</option>
              <option value="input">Uncached input</option>
              <option value="cache-read">Cache reads</option>
              <option value="cache-write">Cache writes</option>
              <option value="output">Output tokens</option>
              <option value="reasoning">Reasoning tokens</option>
              <option value="calls">Model calls</option>
              <option value="sessions">Sessions</option>
              <option value="cost">API-equivalent cost</option>
              <option value="provider-cost">Provider-reported cost</option>
              <option value="savings">Cache savings</option>
            </select>
          </div>
        </div>
        <DailyChart
          data={daily}
          metric={dailyMetric}
          resolution={chartResolution}
          currency={currency}
          locale={locale}
          selectedDay={chartResolution === 'day' ? selectedDay : undefined}
          onSelectDay={chartResolution === 'day'
            ? (day) => setSelectedDay(day === selectedDay ? undefined : day)
            : undefined}
        />
      </article>

      <section className="section analytics-breakdown-section">
        <div className="section-head">
          <div>
            <h2>Provider and model comparison</h2>
            <p>Switch the measure to compare every collected provider and model on the same basis.</p>
          </div>
          <select
            className="select analytics-metric-select"
            value={analyticsMetric}
            aria-label="Provider and model comparison metric"
            onChange={(e) => setAnalyticsMetric(e.target.value as AnalyticsMetric)}
          >
            {ANALYTICS_METRICS.map((metric) => (
              <option key={metric.value} value={metric.value}>{metric.label}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-charts">
          <article className="panel">
            <div className="card-head">
              <div>
                <h3>By provider</h3>
                <p>All enabled providers in the selected window</p>
              </div>
            </div>
            <div className="card-body">
              <AnalyticsRankChart
                rows={overview?.by_provider ?? []}
                kind="provider"
                metric={analyticsMetric}
                currency={currency}
                locale={locale}
              />
            </div>
          </article>

          <article className="panel">
            <div className="card-head">
              <div>
                <h3>By model</h3>
                <p>Every observed model for the selected measure</p>
              </div>
            </div>
            <div className="card-body">
              <AnalyticsRankChart
                rows={models}
                kind="model"
                metric={analyticsMetric}
                currency={currency}
                locale={locale}
                onSelectModel={(model) => setSelectedModel(model === selectedModel ? undefined : model)}
              />
            </div>
          </article>

          <article className="panel model-usage-panel">
            <div className="card-head">
              <div>
                <h3>Usage over time by model</h3>
                <p>Every observed model in the selected window · choose a model to focus the chart</p>
              </div>
            </div>
            <div className="card-body">
              <ModelUsageChart
                rows={modelUsage}
                metric={analyticsMetric}
                resolution={chartResolution}
                currency={currency}
                locale={locale}
                availableModels={models}
                modelFilter={modelChartFilter}
                onModelFilter={setModelChartFilter}
              />
            </div>
          </article>
        </div>
      </section>

      <div className="grid analytics-detail-grid">
        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Provider detail</h3>
              <p>Full token, call, cost, and cache accounting</p>
            </div>
          </div>
          <AnalyticsTable rows={overview?.by_provider ?? []} kind="provider" currency={currency} locale={locale} />
        </article>

        <article className="panel">
          <div className="card-head">
            <div>
              <h3>Model detail</h3>
              <p>Reasoning is a subset of output and is never double-counted in totals</p>
            </div>
          </div>
          <AnalyticsTable
            rows={models}
            kind="model"
            currency={currency}
            locale={locale}
            onSelectModel={(model) => setSelectedModel(model === selectedModel ? undefined : model)}
          />
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
            <p>
              {provider !== 'all' && !providerMeta(provider).reportsQuota
                ? `${providerMeta(provider).name} has local usage analytics, but no subscription-quota runway to forecast.`
                : 'Switch to all providers, or connect a CLI to start collecting burn history.'}
            </p>
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
            <h3>Weekly burn detail</h3>
            <p>All-model weekly allowance snapshots with a dashed forecast beyond the last measurement</p>
          </div>
          <select
            className="select"
            value={burnProvider}
            aria-label="Burn chart provider"
            onChange={(e) => setBurnProvider(e.target.value as ProviderId | 'all')}
          >
            {quotaProviders.length === 0 ? (
              <option value={burnProvider}>No providers enabled</option>
            ) : (
              <>
                <option value="all">All models</option>
                {quotaProviders.map((id) => (
                  <option key={id} value={id}>
                    {providerMeta(id).name}
                  </option>
                ))}
              </>
            )}
          </select>
        </div>
        <BurnChart
          series={burnSeries.filter(
            (entry) => burnProvider === 'all' || entry.provider === burnProvider
          )}
        />
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
        <div className="health-summary panel" aria-label="Diagnostics summary">
          <div>
            <span>Enabled sources</span>
            <strong>{diagnosticsSummary.providers}</strong>
            <small>providers in scope</small>
          </div>
          <div>
            <span>Active collectors</span>
            <strong>{diagnosticsSummary.activeCollectors}</strong>
            <small>watching or polling</small>
          </div>
          <div>
            <span>Sessions indexed</span>
            <strong>{diagnosticsSummary.sessions.toLocaleString()}</strong>
            <small>across enabled sources</small>
          </div>
          <div>
            <span>Live quota checks</span>
            <strong>{diagnosticsSummary.liveQuotas}</strong>
            <small>current provider figures</small>
          </div>
          <div>
            <span>Quota notices</span>
            <strong>{diagnosticsSummary.quotaNotices}</strong>
            <small>explicit status or no snapshot</small>
          </div>
          <div className={diagnosticsSummary.issues > 0 ? 'attention' : ''}>
            <span>Attention</span>
            <strong>{diagnosticsSummary.issues}</strong>
            <small>watcher or quota issues</small>
          </div>
        </div>
        <div className="grid grid-3">
          {collectorHealth.map((health) => (
            <HealthCard
              key={health.provider}
              health={health}
              quota={quotas.find((item) => item.provider === health.provider)}
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
    <>
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
            providers={enabledProviders}
            onProvider={setProvider}
            rangeDays={rangeDays}
            onRange={(days) => {
              setCustomAnalyticsRange(undefined)
              setSelectedDay(undefined)
              setRangeDays(days)
            }}
            customDateRange={view === 'analytics' ? customAnalyticsRange : undefined}
            onCustomDateRange={view === 'analytics'
              ? (range) => {
                  setSelectedDay(undefined)
                  setCustomAnalyticsRange(range)
                }
              : undefined}
            maxCustomEndDay={view === 'analytics' ? maxCustomEndDay : undefined}
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
      {settings && !settings.onboarding_completed ? (
        <Onboarding settings={settings} health={collectorHealth} onFinish={finishOnboarding} />
      ) : null}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function TokenSplit({ breakdown }: { breakdown: OverviewMetrics['token_breakdown'] }) {
  const parts = [
    { key: 'input', label: 'in', value: breakdown.uncached_input, color: 'var(--grok)' },
    { key: 'output', label: 'out', value: breakdown.output, color: 'var(--codex)' },
    { key: 'cache-read', label: 'cache read', value: breakdown.cached_input, color: 'var(--claude)' },
    { key: 'cache-write', label: 'cache write', value: breakdown.cache_creation, color: 'var(--cursor)' },
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

function AnalyticsKpi({
  label,
  value,
  current,
  previous,
  note
}: {
  label: string
  value: string
  current?: number
  previous?: number
  note?: string
}) {
  const trend = periodTrend(current, previous)
  return (
    <article className="analytics-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {trend ? <small className={`analytics-trend ${trend.tone}`}>{trend.text}</small> : null}
      {note ? <small>{note}</small> : null}
    </article>
  )
}

function formatCacheHitRate(breakdown: OverviewMetrics['token_breakdown']): string {
  const rate = cacheHitRate(breakdown)
  return rate == null ? '—' : `${rate.toFixed(1)}%`
}

function cacheHitRate(breakdown: OverviewMetrics['token_breakdown']): number | undefined {
  const reusableInput = breakdown.uncached_input + breakdown.cached_input
  return reusableInput > 0 ? (breakdown.cached_input / reusableInput) * 100 : undefined
}

function periodTrend(
  current: number | undefined,
  previous: number | undefined
): { text: string; tone: 'up' | 'down' | 'flat' } | undefined {
  if (current == null || previous == null) return undefined
  const delta = current - previous
  if (delta === 0) return { text: 'No change vs prior', tone: 'flat' }
  if (previous === 0) return { text: current > 0 ? 'New vs prior' : 'Lower vs prior', tone: current > 0 ? 'up' : 'down' }
  const pct = Math.abs((delta / previous) * 100)
  return {
    text: `${delta > 0 ? '↑' : '↓'}${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}% vs prior`,
    tone: delta > 0 ? 'up' : 'down'
  }
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
          style={{ ['--tone' as string]: providerMeta(q.provider).color, height: 14, gridTemplateColumns: '52px 1fr 34px' }}
        >
          <span className="label" style={{ fontSize: 10.5, color: 'var(--text-3)' }}>
            {providerMeta(q.provider).short}
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
                style={{ ['--tone' as string]: providerMeta(r.provider).color }}
              >
                <span className="label">
                  <i className="swatch" style={{ background: providerMeta(r.provider).color }} />
                  {providerMeta(r.provider).name}
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

/**
 * Says where the prices came from and how current they are, instead of the
 * static version string a hardcoded rate card used to show.
 */
function pricingLabel(overview: OverviewMetrics | null): string {
  if (!overview) return '—'
  const { status, known_models } = overview.pricing
  if (status === 'unavailable') return 'Prices unavailable'
  return `${known_models.toLocaleString()} models · ${
    status === 'fresh' ? 'current' : 'cached'
  }`
}

function pricingTitle(overview: OverviewMetrics | null): string {
  if (!overview) return ''
  const fetched = overview.pricing.fetched_at
  return `${overview.pricing.source}${fetched ? ` · fetched ${fetched}` : ''}`
}

function fxLabel(overview: OverviewMetrics, currency: string): string {
  if (currency.toUpperCase() === 'USD') return 'shown in USD'
  if (overview.fx.status === 'unavailable' || !overview.fx.rates[currency.toUpperCase()]) {
    return `no ${currency} rate available, shown in USD`
  }
  const asOf = overview.fx.rates_date ? ` as of ${overview.fx.rates_date}` : ''
  return `shown in ${currency} at ECB rates${asOf}`
}

function rangeLabel(days: RangeDays): string {
  if (days === 0) return 'Lifetime'
  if (days === 1) return 'Today'
  return `Last ${days} days`
}

function rangeFileLabel(days: RangeDays): string {
  return days === 0 ? 'lifetime' : `${days}d`
}
