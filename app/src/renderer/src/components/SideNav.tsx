import type { ComponentType } from 'react'
import {
  IconAnalytics,
  IconChevronLeft,
  IconForecast,
  IconHealth,
  IconOverview,
  IconSessions,
  IconSettings,
  type IconProps
} from './Icons'

export type ViewId = 'overview' | 'analytics' | 'sessions' | 'forecast' | 'health' | 'settings'

export const VIEWS: Array<{
  id: ViewId
  label: string
  title: string
  icon: ComponentType<IconProps>
  group: 'monitor' | 'system'
}> = [
  { id: 'overview', label: 'Overview', title: 'Overview', icon: IconOverview, group: 'monitor' },
  { id: 'analytics', label: 'Analytics', title: 'Analytics', icon: IconAnalytics, group: 'monitor' },
  { id: 'sessions', label: 'Sessions', title: 'Sessions', icon: IconSessions, group: 'monitor' },
  { id: 'forecast', label: 'Forecast', title: 'Forecast', icon: IconForecast, group: 'monitor' },
  { id: 'health', label: 'Collectors', title: 'Collectors', icon: IconHealth, group: 'system' },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: IconSettings, group: 'system' }
]

interface Props {
  view: ViewId
  onView: (v: ViewId) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  counts: Partial<Record<ViewId, { value: number; hot?: boolean }>>
  liveCount: number
  lastSync: string
}

export function SideNav({
  view,
  onView,
  collapsed,
  onToggleCollapsed,
  counts,
  liveCount,
  lastSync
}: Props) {
  return (
    <nav className="sidenav" aria-label="Primary">
      <div className="brand">
        <span className="brand-mark">AI</span>
        <span className="brand-text">Usage Dashboard</span>
      </div>

      {(['monitor', 'system'] as const).map((group) => (
        <div className="nav-group" key={group}>
          <div className="nav-label">{group === 'monitor' ? 'Monitor' : 'System'}</div>
          {VIEWS.filter((v) => v.group === group).map((v) => {
            const Icon = v.icon
            const count = counts[v.id]
            return (
              <button
                key={v.id}
                type="button"
                className={`nav-item${view === v.id ? ' active' : ''}`}
                onClick={() => onView(v.id)}
                title={collapsed ? v.label : undefined}
                aria-current={view === v.id ? 'page' : undefined}
              >
                <Icon size={15} />
                <span>{v.label}</span>
                {count && count.value > 0 ? (
                  <span className={`nav-count${count.hot ? ' hot' : ''}`}>
                    {count.value > 999 ? '999+' : count.value}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ))}

      <div className="nav-spacer" />

      <div className="nav-foot">
        <div
          className={`nav-status${liveCount > 0 ? '' : ' idle'}`}
          title={`Last sync ${lastSync}`}
        >
          <span className="dot" />
          <span>{liveCount > 0 ? `${liveCount} live · ${lastSync}` : `Idle · ${lastSync}`}</span>
        </div>
        <button
          type="button"
          className="nav-toggle"
          onClick={onToggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <IconChevronLeft size={15} />
          <span>Collapse</span>
        </button>
      </div>
    </nav>
  )
}
