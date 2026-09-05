import type { CollectorHealth, ProviderId, QuotaSnapshot } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { confidenceBadge, relativeTime } from '../lib/format'
import { IconRefresh } from './Icons'

const STATUS_TONE: Record<CollectorHealth['watcher_status'], string> = {
  watching: 'good',
  polling: 'plain',
  missing: 'warn',
  error: 'error'
}

interface Props {
  health: CollectorHealth
  quota?: QuotaSnapshot
  busy: boolean
  onRescan: (provider: ProviderId) => void
}

export function HealthCard({ health, quota, busy, onRescan }: Props) {
  const meta = providerMeta(health.provider)
  const quotaBadge = quota
    ? confidenceBadge(quota.confidence, quota.auth_connected, quota.stale)
    : { label: 'No snapshot', className: 'plain' }
  const windows = quota?.quota_windows?.length
    ? quota.quota_windows.length
    : quota?.windows?.length ?? 0

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
        <div className="diagnostic-group">
          <div className="diagnostic-group-head">
            <strong>Local collector</strong>
            <span className={`status ${STATUS_TONE[health.watcher_status]}`}>
              {health.watcher_status}
            </span>
          </div>
          <div className="diagnostic-grid">
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
        </div>

        <div className="diagnostic-group">
          <div className="diagnostic-group-head">
            <strong>Quota connection</strong>
            <span className={`status ${quotaBadge.className}`}>{quotaBadge.label}</span>
          </div>
          <div className="diagnostic-grid">
            <div className="kv-row">
              <span>Credentials</span>
              <b>{quota ? credentialLabel(quota) : 'No snapshot'}</b>
            </div>
            <div className="kv-row">
              <span>Transport</span>
              <b>{quota ? transportLabel(quota.transport) : 'No snapshot'}</b>
            </div>
            <div className="kv-row">
              <span>Probe source</span>
              <b title={quota?.source}>{quota?.source ?? 'No snapshot'}</b>
            </div>
            <div className="kv-row">
              <span>Plan</span>
              <b>{quota ? planLabel(quota) : 'No snapshot'}</b>
            </div>
            <div className="kv-row">
              <span>Last check</span>
              <b>{quota ? relativeTime(quota.captured_at) : 'never'}</b>
            </div>
            <div className="kv-row">
              <span>Windows reported</span>
              <b>{quota ? (windows ? windows.toLocaleString() : 'none') : '—'}</b>
            </div>
            <div className="kv-row">
              <span>Reset credits</span>
              <b>{quota ? resetCreditsLabel(quota) : 'No snapshot'}</b>
            </div>
            <div className="kv-row">
              <span>Availability</span>
              <b>{quota ? availabilityLabel(quota) : 'No snapshot'}</b>
            </div>
          </div>
        </div>
      </div>

      {health.last_error ? <div className="health-error">{health.last_error}</div> : null}
      {quota?.unavailable?.message ? (
        <div className="health-info">
          <span>Quota note</span>
          <p>{quota.unavailable.message}</p>
        </div>
      ) : null}

      <div className="health-foot">
        <button className="btn" type="button" disabled={busy} onClick={() => onRescan(health.provider)}>
          <IconRefresh size={13} className={busy ? 'icon spin' : 'icon'} />
          {busy ? 'Scanning' : 'Rescan'}
        </button>
      </div>
    </article>
  )
}

function credentialLabel(quota: QuotaSnapshot): string {
  if (quota.auth_connected) return 'Credentials available'
  if (quota.unavailable?.reason === 'auth_unreadable') return 'Credentials unreadable'
  return 'Not connected'
}

function transportLabel(transport: QuotaSnapshot['transport']): string {
  switch (transport) {
    case 'app-server':
      return 'Codex app-server'
    case 'http':
      return 'Provider HTTP API'
    case 'local':
      return 'Local files'
    case 'none':
      return 'No transport'
    default:
      return 'Not reported'
  }
}

function availabilityLabel(quota: QuotaSnapshot): string {
  switch (quota.unavailable?.reason) {
    case 'not_connected':
      return 'Not connected'
    case 'auth_unreadable':
      return 'Credentials unreadable'
    case 'unsupported':
      return 'Quota not supported'
    case 'probe_failed':
      return 'Probe failed'
    case 'network_disabled':
      return 'Network disabled'
    default:
      return quota.confidence === 'live' ? 'Live figure' : quota.confidence === 'estimate' ? 'Estimate' : 'No figure'
  }
}

function planLabel(quota: QuotaSnapshot): string {
  if (!quota.plan_label) return 'Unknown'
  return quota.plan_source === 'api' || quota.plan_source === 'auth'
    ? `${quota.plan_label} · detected`
    : quota.plan_label
}

function resetCreditsLabel(quota: QuotaSnapshot): string {
  if (!quota.reset_credits) return 'Not reported'
  return quota.reset_credits.available_count > 0
    ? `${quota.reset_credits.available_count.toLocaleString()} available`
    : 'none available'
}
