import type { CollectorHealth, ProviderId } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { relativeTime } from '../lib/format'
import { IconRefresh } from './Icons'

const STATUS_TONE: Record<CollectorHealth['watcher_status'], string> = {
  watching: 'good',
  polling: 'plain',
  missing: 'warn',
  error: 'error'
}

interface Props {
  health: CollectorHealth
  busy: boolean
  onRescan: (provider: ProviderId) => void
}

export function HealthCard({ health, busy, onRescan }: Props) {
  const meta = providerMeta(health.provider)

  return (
    <article className="panel health-card">
      <div className="card-head">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="swatch" style={{ background: meta.color }} />
          {meta.name}
        </h3>
        <span className={`status ${STATUS_TONE[health.watcher_status]}`}>
          {health.watcher_status}
        </span>
      </div>

      <div className="health-body">
        <div className="kv-row">
          <span>Source</span>
          <b title={health.source_label}>{health.source_label}</b>
        </div>
        <div className="kv-row">
          <span>Sessions seen</span>
          <b>{health.sessions_seen.toLocaleString()}</b>
        </div>
        <div className="kv-row">
          <span>Last scan</span>
          <b>{relativeTime(health.last_scan_at)}</b>
        </div>
        <div className="kv-row">
          <span>Last success</span>
          <b>{health.last_success_at ? relativeTime(health.last_success_at) : 'never'}</b>
        </div>
        {health.last_duration_ms != null ? (
          <div className="kv-row">
            <span>Scan time</span>
            <b>{health.last_duration_ms} ms</b>
          </div>
        ) : null}
      </div>

      {health.last_error ? <div className="health-error">{health.last_error}</div> : null}

      <div className="health-foot">
        <button className="btn" type="button" disabled={busy} onClick={() => onRescan(health.provider)}>
          <IconRefresh size={13} className={busy ? 'icon spin' : 'icon'} />
          {busy ? 'Scanning' : 'Rescan'}
        </button>
      </div>
    </article>
  )
}
