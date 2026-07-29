import type { AppSettings, ProviderId } from '@shared/types'
import { PROVIDER_META, PROVIDER_IDS } from '@shared/providers'
import { CURRENCY_OPTIONS, LOCALE_OPTIONS } from '../lib/format'

const PLAN_PRESETS: Record<ProviderId, string[]> = {
  grok: ['SuperGrok', 'X Premium+', 'Free', 'Custom'],
  claude: ['Free', 'Pro', 'Max', 'Team', 'Custom'],
  codex: ['plus', 'pro', 'team', 'free', 'Custom']
}

interface Props {
  settings: AppSettings
  onChange: (next: Partial<AppSettings>) => Promise<void>
}

export function SettingsPanel({ settings, onChange }: Props) {
  const setPlanMode = async (provider: ProviderId, mode: 'auto' | 'manual') => {
    const current = settings.plans[provider] ?? { mode: 'auto' as const }
    await onChange({
      plans: {
        ...settings.plans,
        [provider]: {
          ...current,
          mode,
          value: mode === 'manual' ? current.value ?? current.detected ?? '' : current.value
        }
      }
    })
  }

  const setPlanValue = async (provider: ProviderId, value: string) => {
    const current = settings.plans[provider] ?? { mode: 'manual' as const }
    await onChange({
      plans: {
        ...settings.plans,
        [provider]: {
          ...current,
          mode: 'manual',
          value: value === 'Custom' ? '' : value,
          source: 'user'
        }
      }
    })
  }

  return (
    <section className="section" id="settings">
      <div className="section-head">
        <div>
          <h3>Settings</h3>
          <p>Currency, notifications, plan labels, and network quota refresh</p>
        </div>
        <span className="badge info">Stored in %APPDATA%</span>
      </div>
      <div className="settings-grid">
        <article className="sync-card panel">
          <div className="chart-head">
            <div>
              <h4>Display &amp; currency</h4>
              <p>API-equivalent costs convert from USD with approximate FX</p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <select
              id="currency"
              value={settings.display_currency}
              onChange={(e) => void onChange({ display_currency: e.target.value })}
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="locale">Locale</label>
            <select
              id="locale"
              value={settings.locale}
              onChange={(e) => void onChange({ locale: e.target.value })}
            >
              {LOCALE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="retention">Local retention (days)</label>
            <select
              id="retention"
              value={settings.retention_days}
              onChange={(e) =>
                void onChange({ retention_days: Number(e.target.value) })
              }
            >
              {[30, 90, 180, 365].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </div>
        </article>

        <article className="privacy-card panel">
          <div className="chart-head">
            <div>
              <h4>Privacy &amp; network</h4>
              <p>Prompt content is never stored — hard-coded off</p>
            </div>
          </div>
          <div className="toggle-row">
            <div>
              <strong>Store prompts and responses</strong>
              <span>Always off in v1. Usage metrics do not need content.</span>
            </div>
            <button
              className="switch"
              type="button"
              disabled
              aria-label="Prompt storage always off"
              aria-pressed="false"
            />
          </div>
          <div className="toggle-row">
            <div>
              <strong>Windows notifications</strong>
              <span>Toast when a new burn rule fires</span>
            </div>
            <button
              className={`switch${settings.notify_enabled ? ' on' : ''}`}
              type="button"
              aria-pressed={settings.notify_enabled}
              onClick={() =>
                void onChange({ notify_enabled: !settings.notify_enabled })
              }
            />
          </div>
          <div className="toggle-row">
            <div>
              <strong>Network quota refresh</strong>
              <span>Call provider usage APIs with your CLI tokens</span>
            </div>
            <button
              className={`switch${settings.network_quota_refresh ? ' on' : ''}`}
              type="button"
              aria-pressed={settings.network_quota_refresh}
              onClick={() =>
                void onChange({
                  network_quota_refresh: !settings.network_quota_refresh
                })
              }
            />
          </div>
        </article>
      </div>

      <div className="plan-settings panel" style={{ marginTop: 14, padding: 18 }}>
        <div className="chart-head">
          <div>
            <h4>Provider plans</h4>
            <p>
              Auto-detect from API when possible; optional manual label. Never
              hard-coded globally.
            </p>
          </div>
        </div>
        <div className="plan-grid">
          {PROVIDER_IDS.map((id) => {
            const cfg = settings.plans[id] ?? { mode: 'auto' as const }
            const presets = PLAN_PRESETS[id]
            const presetValues = presets.filter((value) => value !== 'Custom')
            const selectedValue = presetValues.includes(cfg.value ?? '')
              ? cfg.value
              : 'Custom'
            return (
              <div key={id} className="plan-card">
                <div className="provider-name" style={{ marginBottom: 10 }}>
                  <i className={`provider-dot ${id}`} />
                  <div>
                    <h4 style={{ margin: 0, fontSize: 13 }}>{PROVIDER_META[id].name}</h4>
                    <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 11 }}>
                      {cfg.detected
                        ? `Detected: ${cfg.detected}`
                        : 'No detection yet'}
                      {cfg.mode === 'manual' && cfg.value
                        ? ` · showing: ${cfg.value}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor={`plan-mode-${id}`}>Mode</label>
                  <select
                    id={`plan-mode-${id}`}
                    value={cfg.mode}
                    onChange={(e) =>
                      void setPlanMode(id, e.target.value as 'auto' | 'manual')
                    }
                  >
                    <option value="auto">Auto-detect</option>
                    <option value="manual">Manual override</option>
                  </select>
                </div>
                {cfg.mode === 'manual' ? (
                  <div className="field">
                    <label htmlFor={`plan-value-${id}`}>Plan label</label>
                    <select
                      id={`plan-value-${id}`}
                      value={selectedValue}
                      onChange={(e) => void setPlanValue(id, e.target.value)}
                    >
                      {presets.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                    {selectedValue === 'Custom' && (
                      <input
                        style={{ marginTop: 8, width: '100%' }}
                        type="text"
                        placeholder="Custom plan name"
                        value={cfg.value ?? ''}
                        onChange={(e) => void setPlanValue(id, e.target.value)}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
