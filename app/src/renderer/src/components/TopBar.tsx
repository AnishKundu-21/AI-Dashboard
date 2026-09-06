import { useEffect, useRef, useState } from 'react'
import { MAX_CUSTOM_ANALYTICS_DAYS, type ProviderId, type RangeDays } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { Segmented, type SegmentedOption } from './Segmented'
import {
  IconChevronDown,
  IconDownload,
  IconMoon,
  IconRefresh,
  IconSun
} from './Icons'
import type { ThemeMode } from '../lib/hooks'

export type ProviderTab = ProviderId | 'all'

const RANGES: Array<{ value: RangeDays; label: string }> = [
  { value: 1, label: 'Today' },
  { value: 3, label: 'Last 3 days' },
  { value: 5, label: 'Last 5 days' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 180, label: 'Last 180 days' },
  { value: 365, label: 'Last 365 days' },
  { value: 0, label: 'Lifetime' }
]

function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function earlierDay(...days: Array<string | undefined>): string | undefined {
  return days.filter((day): day is string => Boolean(day)).sort()[0]
}

function calendarDayCount(start: string, end: string): number {
  return Math.floor(
    (Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) /
      86_400_000
  ) + 1
}

interface Props {
  title: string
  provider: ProviderTab
  providers: ProviderId[]
  onProvider: (p: ProviderTab) => void
  rangeDays: RangeDays
  onRange: (d: RangeDays) => void
  customDateRange?: { start_day: string; end_day: string }
  onCustomDateRange?: (range: { start_day: string; end_day: string }) => void
  /** Today's date in the configured usage timezone. */
  maxCustomEndDay?: string
  refreshing: boolean
  onRefresh: () => void
  onExport: (format: 'csv' | 'json') => void
  theme: ThemeMode
  onTheme: (t: ThemeMode) => void
}

export function TopBar({
  title,
  provider,
  providers,
  onProvider,
  rangeDays,
  onRange,
  customDateRange,
  onCustomDateRange,
  maxCustomEndDay,
  refreshing,
  onRefresh,
  onExport,
  theme,
  onTheme
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customStart, setCustomStart] = useState(customDateRange?.start_day ?? '')
  const [customEnd, setCustomEnd] = useState(customDateRange?.end_day ?? '')
  const menuRef = useRef<HTMLDivElement>(null)
  const customPopoverRef = useRef<HTMLDivElement>(null)
  const rangeSelectRef = useRef<HTMLSelectElement>(null)
  const editDatesRef = useRef<HTMLButtonElement>(null)
  const customStartRef = useRef<HTMLInputElement>(null)

  const closeCustom = () => {
    setCustomOpen(false)
    window.setTimeout(() => {
      const focusTarget = editDatesRef.current ?? rangeSelectRef.current
      focusTarget?.focus()
    }, 0)
  }

  useEffect(() => {
    setCustomStart(customDateRange?.start_day ?? '')
    setCustomEnd(customDateRange?.end_day ?? '')
  }, [customDateRange?.start_day, customDateRange?.end_day])

  useEffect(() => {
    if (!onCustomDateRange) setCustomOpen(false)
  }, [onCustomDateRange])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!customOpen) return
    customStartRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !customPopoverRef.current?.contains(target) &&
        !rangeSelectRef.current?.contains(target) &&
        !editDatesRef.current?.contains(target)
      ) {
        closeCustom()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCustom()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [customOpen])

  const options: SegmentedOption<ProviderTab>[] = [
    { value: 'all', label: 'All' },
    ...providers.map((p) => ({
      value: p as ProviderTab,
      label: providerMeta(p).short,
      color: providerMeta(p).color
    }))
  ]
  const maximumEnd = maxCustomEndDay ?? new Date().toISOString().slice(0, 10)
  const maximumEndFromStart = customStart
    ? earlierDay(maximumEnd, addCalendarDays(customStart, MAX_CUSTOM_ANALYTICS_DAYS - 1))
    : maximumEnd
  const maximumStart = earlierDay(customEnd, maximumEnd)
  const span = customStart && customEnd ? calendarDayCount(customStart, customEnd) : 0
  const customRangeInvalid =
    !customStart ||
    !customEnd ||
    customStart > customEnd ||
    customEnd > maximumEnd ||
    span > MAX_CUSTOM_ANALYTICS_DAYS

  const rangeHelp = customEnd > maximumEnd
    ? `Choose a date no later than ${maximumEnd}.`
    : span > MAX_CUSTOM_ANALYTICS_DAYS
      ? `Custom analytics ranges are limited to ${MAX_CUSTOM_ANALYTICS_DAYS} days.`
      : `Up to ${MAX_CUSTOM_ANALYTICS_DAYS} days, ending ${maximumEnd} or earlier.`

  return (
    <header className="topbar">
      <h1>{title}</h1>

      <div className="topbar-actions">
        <Segmented
          options={options}
          value={provider}
          onChange={onProvider}
          ariaLabel="Filter by provider"
        />

        <select
          ref={rangeSelectRef}
          className="select"
          value={customDateRange ? 'custom' : rangeDays}
          aria-label="Date range"
          onChange={(e) => {
            if (e.target.value === 'custom') {
              setCustomOpen(true)
              return
            }
            setCustomOpen(false)
            onRange(Number(e.target.value) as RangeDays)
          }}
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
          {onCustomDateRange ? <option value="custom">Custom dates…</option> : null}
        </select>

        {customDateRange && onCustomDateRange ? (
          <button ref={editDatesRef} type="button" className="btn" onClick={() => setCustomOpen(true)}>
            Edit dates
          </button>
        ) : null}

        {customOpen && onCustomDateRange ? (
          <div
            ref={customPopoverRef}
            className="custom-range-popover"
            role="dialog"
            aria-modal="true"
            aria-label="Custom date range"
          >
            <label>
              From
              <input
                ref={customStartRef}
                type="date"
                value={customStart}
                max={maximumStart}
                onChange={(e) => setCustomStart(e.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={customEnd}
                min={customStart || undefined}
                max={maximumEndFromStart}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </label>
            <p className="custom-range-help" aria-live="polite">{rangeHelp}</p>
            <div className="custom-range-actions">
              <button type="button" className="btn ghost" onClick={closeCustom}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={customRangeInvalid}
                onClick={() => {
                  onCustomDateRange({ start_day: customStart, end_day: customEnd })
                  closeCustom()
                }}
              >
                Apply
              </button>
            </div>
          </div>
        ) : null}

        <div className="topbar-divider" />

        <div className="menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            Export
            <IconChevronDown size={13} />
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onExport('csv')
                }}
              >
                <IconDownload size={14} />
                Export CSV
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onExport('json')
                }}
              >
                <IconDownload size={14} />
                Export JSON
              </button>
              <p className="menu-note">Respects the current provider and range filters.</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn icon-only"
          onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          aria-label="Toggle colour theme"
        >
          {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>

        <button type="button" className="btn primary" disabled={refreshing} onClick={onRefresh}>
          <IconRefresh size={14} className={refreshing ? 'icon spin' : 'icon'} />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </header>
  )
}
