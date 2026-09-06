import type { ProjectionCard as ProjectionCardData, QuotaSnapshot } from '@shared/types'
import { providerMeta } from '@shared/providers'
import { confidenceBadge } from '../lib/format'
import { IconSpark } from './Icons'

interface Props {
  projection: ProjectionCardData
  quota?: QuotaSnapshot
}

export function ProjectionCard({ projection: p, quota }: Props) {
  const meta = providerMeta(p.provider)
  const badge = quota
    ? confidenceBadge(quota.confidence, quota.auth_connected, quota.stale)
    : { label: 'No snapshot', className: 'plain' }
  const hasStats = p.daily_burn_pct != null || p.days_to_empty != null

  return (
    <article className="panel projection">
      <div className="card-head">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="swatch" style={{ background: meta.color }} />
          {meta.name}
        </h3>
        <div className="projection-badges">
          <span className="status plain">{p.window_label}</span>
          <span className={`status ${badge.className}`}>{badge.label}</span>
        </div>
      </div>

      <div className="projection-body">
        <div className="headline">{p.headline}</div>
        <p className="detail">{p.detail}</p>
      </div>

      {hasStats ? (
        <div className="projection-stats">
          <div>
            <span>Burn rate</span>
            <strong>{p.daily_burn_pct != null ? `${p.daily_burn_pct.toFixed(1)}%/day` : '—'}</strong>
          </div>
          <div>
            <span>Runway</span>
            <strong>{p.days_to_empty != null ? `${p.days_to_empty} days` : '—'}</strong>
          </div>
        </div>
      ) : null}

      <div className="projection-confidence">
        Forecast confidence: <strong>{p.forecast_confidence}</strong>
      </div>

      {p.recommendation ? (
        <div className="rec">
          <IconSpark size={14} />
          <span>{p.recommendation}</span>
        </div>
      ) : null}
    </article>
  )
}
