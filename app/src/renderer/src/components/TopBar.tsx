import { useEffect, useRef, useState } from 'react'
import type { ProviderId, RangeDays } from '@shared/types'
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

interface Props {
  title: string
  provider: ProviderTab
  providers: ProviderId[]
  onProvider: (p: ProviderTab) => void
  rangeDays: RangeDays
  onRange: (d: RangeDays) => void
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
  refreshing,
  onRefresh,
  onExport,
  theme,
  onTheme
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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

  const options: SegmentedOption<ProviderTab>[] = [
    { value: 'all', label: 'All' },
    ...providers.map((p) => ({
      value: p as ProviderTab,
      label: providerMeta(p).short,
      color: providerMeta(p).color
    }))
  ]

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
          className="select"
          value={rangeDays}
          aria-label="Date range"
          onChange={(e) => onRange(Number(e.target.value) as RangeDays)}
        >
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>

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
