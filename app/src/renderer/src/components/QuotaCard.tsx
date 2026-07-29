import type { QuotaSnapshot } from '@shared/types'
import { PROVIDER_META } from '@shared/providers'
import { confidenceBadge } from '../lib/format'

export function QuotaCard({ quota }: { quota: QuotaSnapshot }) {
  const meta = PROVIDER_META[quota.provider]
  const badge = confidenceBadge(quota.confidence, quota.auth_connected, quota.stale)
  const used = quota.used_pct
  const remaining = quota.remaining_pct

  const remainingLabel =
    remaining != null
      ? `${Math.round(remaining)}%`
      : quota.auth_connected
        ? '—'
        : '—'

  const planLabel =
    quota.plan_label ??
    (quota.plan_source === 'unknown' ? 'Unknown' : '—')

  const productBits =
    quota.products &&
    Object.entries(quota.products)
      .map(([k, v]) => `${k.replace('Grok', '')} ${v}%`)
      .join(' · ')

  return (
    <article className="quota-card panel" data-provider={quota.provider}>
      <div className="provider-head">
        <div className="provider-name">
          <i className={`provider-dot ${quota.provider}`} />
          <div>
            <h4>{meta.name}</h4>
            <p>
              Plan: {planLabel}
              {quota.plan_source === 'api' ? ' (detected)' : ''}
            </p>
          </div>
        </div>
        <span className={`badge ${badge.className}`}>{badge.label}</span>
      </div>

      {!quota.auth_connected ? (
        <>
          <div className="quota-number">
            <strong style={{ fontSize: 22 }}>Not connected</strong>
            <span>Install CLI + login, then refresh</span>
          </div>
          <div className="progress">
            <div style={{ width: '0%' }} />
          </div>
        </>
      ) : (
        <>
          <div className="quota-number">
            <strong>{remainingLabel}</strong>
            <span>
              remaining
              <br />
              {used != null ? `${Math.round(used)}% used` : 'no live figure'}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${used ?? 0}%` }} />
          </div>
        </>
      )}

      <div className="quota-mini">
        <div className="mini">
          <span>Window</span>
          <strong>{quota.window_label ?? '—'}</strong>
        </div>
        <div className="mini">
          <span>Reset</span>
          <strong>
            {quota.reset_at
              ? new Date(quota.reset_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })
              : '—'}
          </strong>
        </div>
        <div className="mini">
          <span>Confidence</span>
          <strong>{quota.stale ? 'stale live' : quota.confidence}</strong>
        </div>
      </div>

      {productBits ? (
        <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: 11 }}>
          {productBits}
        </p>
      ) : null}

      {quota.windows && quota.windows.length > 1 ? (
        <div className="quota-windows">
          {quota.windows.map((window, index) => (
            <div className="mini" key={`${window.label}-${index}`}>
              <span>{window.label}</span>
              <strong>
                {window.remaining_pct != null
                  ? `${Math.round(window.remaining_pct)}% left`
                  : '—'}
              </strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="source-row">
        source: {quota.source}
        {quota.stale && quota.live_captured_at
          ? ` · last live ${new Date(quota.live_captured_at).toLocaleString()}`
          : ''}
      </div>
    </article>
  )
}
