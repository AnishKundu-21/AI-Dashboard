import type { QuotaSnapshot } from '@shared/types'
import { PROVIDER_META } from '@shared/providers'
import { confidenceBadge, relativeTime } from '../lib/format'
import { Gauge } from './Gauge'

export function QuotaCard({ quota }: { quota: QuotaSnapshot }) {
  const meta = PROVIDER_META[quota.provider]
  const badge = confidenceBadge(quota.confidence, quota.auth_connected, quota.stale)
  const used = quota.used_pct
  const connected = quota.auth_connected

  const products =
    quota.products &&
    Object.entries(quota.products)
      .map(([k, v]) => `${k.replace('Grok', '')} ${v}%`)
      .join(' · ')

  return (
    <article className="panel quota-card" style={{ ['--tone' as string]: meta.color }}>
      <div className="quota-head">
        <div className="provider-name">
          <i className="swatch" style={{ background: meta.color }} />
          <div>
            <h3>{meta.name}</h3>
            <div className="plan">
              {quota.plan_label ?? 'Plan unknown'}
              {quota.plan_source === 'api' ? ' · detected' : ''}
            </div>
          </div>
        </div>
        <span className={`status ${badge.className}`}>{badge.label}</span>
      </div>

      <div className="quota-body">
        <Gauge value={connected ? quota.remaining_pct : null} label={connected ? 'remaining' : 'no auth'} />
        <div className="quota-meta">
          {connected ? (
            <>
              <div className="meter">
                <i style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} />
              </div>
              <div className="kv-row">
                <span>Used</span>
                <b>{used != null ? `${Math.round(used)}%` : 'no live figure'}</b>
              </div>
              <div className="kv-row">
                <span>Window</span>
                <b title={quota.window_label ?? undefined}>{quota.window_label ?? '—'}</b>
              </div>
              <div className="kv-row">
                <span>Resets</span>
                <b>
                  {quota.reset_at
                    ? new Date(quota.reset_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric'
                      })
                    : '—'}
                </b>
              </div>
              {products ? (
                <div className="kv-row">
                  <span>Products</span>
                  <b>{products}</b>
                </div>
              ) : null}
            </>
          ) : (
            <p style={{ color: 'var(--text-3)', fontSize: 11.5, lineHeight: 1.55 }}>
              Install the CLI and sign in, then refresh. Auth tokens are read in the main
              process and never reach this window.
            </p>
          )}
        </div>
      </div>

      {quota.windows && quota.windows.length > 1 ? (
        <div className="quota-windows">
          {quota.windows.map((w, i) => (
            <div key={`${w.label}-${i}`}>
              <span title={w.label}>{w.label}</span>
              <strong>{w.remaining_pct != null ? `${Math.round(w.remaining_pct)}%` : '—'}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="quota-foot">
        <span title={quota.source}>{quota.source}</span>
        <span>
          {quota.stale && quota.live_captured_at
            ? `live ${relativeTime(quota.live_captured_at)}`
            : relativeTime(quota.captured_at)}
        </span>
      </div>
    </article>
  )
}
