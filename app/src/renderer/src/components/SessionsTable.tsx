import type { SessionRow } from '@shared/types'
import { useState } from 'react'
import { Modal } from './Modal'
import { providerMeta } from '@shared/providers'
import { formatCurrency, formatDuration, formatResetAt, formatTokens, relativeTime } from '../lib/format'

export type SessionSort = 'started_at' | 'tokens_total' | 'api_equiv_usd' | 'duration_ms'

interface Props {
  sessions: SessionRow[]
  currency: string
  locale: string
  timezone?: string
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

export function SessionsTable({ sessions, currency, locale, timezone = 'system', sort, onSort }: Props) {
  const [selected, setSelected] = useState<SessionRow | null>(null)
  if (sessions.length === 0) {
    return (
      <div className="empty">
        <strong>No sessions match this view</strong>
        <p>Clear the active filters, widen the range, or search for a different project.</p>
      </div>
    )
  }

  return (
    <><div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`${c.num ? 'num' : ''}${c.sort ? ' sortable' : ''}`}
                aria-sort={c.sort && sort === c.sort ? 'descending' : undefined}
                title={c.sort ? `Sort by ${c.label.toLowerCase()}` : undefined}
              >
                {c.sort ? <button className="sort-button" onClick={() => onSort(c.sort!)}>{c.label}</button> : c.label}
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
                  <i className="swatch" style={{ background: providerMeta(s.provider).color }} />
                  {providerMeta(s.provider).short}
                </span>
              </td>
              <td>
                <button className="cell-project session-open" title={`Inspect ${s.project}`} onClick={() => setSelected(s)}>
                  {s.project}
                </button>
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
    {selected && <Modal title="Session details" onClose={() => setSelected(null)} drawer>
      <div className="session-detail">
        <span className="eyebrow">{providerMeta(selected.provider).name} · {selected.status.replace('_', ' ')}</span>
        <h3>{selected.project}</h3><p>{selected.model}</p>
        <div className="session-total">{tok(selected.tokens_total)}<span>total tokens</span></div>
        <dl>{[
          ['Uncached input', tok(selected.tokens?.uncached_input ?? selected.tokens_in)],
          ['Cache reads', tok(selected.tokens?.cached_input ?? selected.tokens_cached ?? null)],
          ['Cache writes', tok(selected.tokens?.cache_creation ?? null)],
          ['Output', tok(selected.tokens?.output ?? selected.tokens_out)],
          ['Reasoning (included in output)', tok(selected.tokens?.reasoning ?? selected.tokens_reasoning ?? null)],
          ['Model calls', selected.model_calls?.toLocaleString() ?? '—'],
          ['Duration', formatDuration(selected.duration_ms)],
          ['Started', formatResetAt(selected.started_at, locale, timezone)],
          ['API-equivalent cost', selected.api_equiv_usd == null ? 'Unpriced / unavailable' : formatCurrency(selected.api_equiv_usd, currency, locale)],
          ['Provider-reported cost', selected.provider_cost_usd == null ? 'Unavailable' : formatCurrency(selected.provider_cost_usd, currency, locale)],
          ['Cache savings', selected.cache_savings_usd == null ? 'Unavailable' : formatCurrency(selected.cache_savings_usd, currency, locale)]
        ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <p className="dialog-note">API-equivalent cost is a comparison estimate, not your subscription invoice. Only session metadata is shown.</p>
      </div>
    </Modal>}</>
  )
}

function tok(n: number | null): string {
  return n != null ? formatTokens(n) : '—'
}
