import type { SessionRow } from '@shared/types'
import { PROVIDER_META } from '@shared/providers'
import { formatCurrency, formatDuration, formatTokens, relativeTime } from '../lib/format'

export type SessionSort = 'started_at' | 'tokens_total' | 'api_equiv_usd' | 'duration_ms'

interface Props {
  sessions: SessionRow[]
  currency: string
  locale: string
  sort: SessionSort
  onSort: (next: SessionSort) => void
}

const COLUMNS: Array<{ key: string; label: string; num?: boolean; sort?: SessionSort }> = [
  { key: 'provider', label: 'Provider' },
  { key: 'project', label: 'Project' },
  { key: 'model', label: 'Model' },
  { key: 'started', label: 'Started', sort: 'started_at' },
  { key: 'in', label: 'In', num: true },
  { key: 'out', label: 'Out', num: true },
  { key: 'cached', label: 'Cached', num: true },
  { key: 'reasoning', label: 'Reasoning', num: true },
  { key: 'calls', label: 'Calls', num: true },
  { key: 'tokens', label: 'Tokens', num: true, sort: 'tokens_total' },
  { key: 'apiEquiv', label: 'API-equiv', num: true, sort: 'api_equiv_usd' },
  { key: 'cost', label: 'Provider cost', num: true },
  { key: 'duration', label: 'Duration', num: true, sort: 'duration_ms' }
]

export function SessionsTable({ sessions, currency, locale, sort, onSort }: Props) {
  if (sessions.length === 0) {
    return (
      <div className="empty">
        <strong>No sessions match this view</strong>
        <p>Clear the active filters, widen the range, or search for a different project.</p>
      </div>
    )
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`${c.num ? 'num' : ''}${c.sort ? ' sortable' : ''}`}
                onClick={c.sort ? () => onSort(c.sort!) : undefined}
                title={c.sort ? `Sort by ${c.label.toLowerCase()}` : undefined}
              >
                {c.label}
                {c.sort && sort === c.sort ? <span className="caret">↓</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>
                <span className="cell-provider">
                  <i className="swatch" style={{ background: PROVIDER_META[s.provider].color }} />
                  {PROVIDER_META[s.provider].short}
                </span>
              </td>
              <td>
                <span className="cell-project" title={s.project}>
                  {s.project}
                </span>
              </td>
              <td>
                <span className="cell-model" title={s.model}>
                  {s.model}
                </span>
              </td>
              <td className="dim" title={s.started_at ?? undefined}>
                {relativeTime(s.started_at)}
              </td>
              <td className="num">{tok(s.tokens_in)}</td>
              <td className="num">{tok(s.tokens_out)}</td>
              <td className="num dim">{tok(s.tokens_cached ?? null)}</td>
              <td className="num dim">{tok(s.tokens_reasoning ?? null)}</td>
              <td className="num dim">{s.model_calls ?? '—'}</td>
              <td className="num strong">{tok(s.tokens_total)}</td>
              <td className="num strong">
                {s.api_equiv_usd != null ? formatCurrency(s.api_equiv_usd, currency, locale) : '—'}
              </td>
              <td className="num dim">
                {s.provider_cost_usd != null
                  ? formatCurrency(s.provider_cost_usd, currency, locale)
                  : '—'}
              </td>
              <td className="num dim">{formatDuration(s.duration_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function tok(n: number | null): string {
  return n != null ? formatTokens(n) : '—'
}
