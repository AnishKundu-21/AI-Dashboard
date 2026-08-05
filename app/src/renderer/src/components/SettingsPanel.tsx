import type { AppSettings, ProviderId } from '@shared/types'
import { PROVIDER_META, PROVIDER_IDS } from '@shared/providers'
import { CURRENCY_OPTIONS, LOCALE_OPTIONS } from '../lib/format'

const PLAN_PRESETS: Record<ProviderId, string[]> = {
  grok: ['SuperGrok', 'X Premium+', 'Free', 'Custom'],
  claude: ['Free', 'Pro', 'Max', 'Team', 'Custom'],
  codex: ['plus', 'pro', 'team', 'free', 'Custom']
}

const TIMEZONES = [
  { value: 'system', label: 'System timezone' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Asia/Calcutta', label: 'India (Asia/Calcutta)' },
  { value: 'America/New_York', label: 'New York' },
  { value: 'America/Los_Angeles', label: 'Los Angeles' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Berlin', label: 'Berlin' },
  { value: 'Asia/Tokyo', label: 'Tokyo' }
]

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
        [provider]: { ...current, mode: 'manual', value: value === 'Custom' ? '' : value, source: 'user' }
      }
    })
  }

  return (
    <>
      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Display</h3>
            <p>API-equivalent costs convert from USD using approximate FX rates</p>
          </div>
        </div>
        <div className="card-body">
          <div className="field-grid">
            <div className="field">
              <label htmlFor="currency">Currency</label>
              <select
                id="currency"
                className="select"
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
                className="select"
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
              <label htmlFor="timezone">Usage-day timezone</label>
              <select
                id="timezone"
                className="select"
                value={settings.timezone}
                onChange={(e) => void onChange({ timezone: e.target.value })}
              >
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="retention">Local retention</label>
              <select
                id="retention"
                className="select"
                value={settings.retention_days}
                onChange={(e) => void onChange({ retention_days: Number(e.target.value) })}
              >
                {[30, 90, 180, 365].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </article>

      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Privacy &amp; network</h3>
            <p>Prompt content is never stored — the setting is hard-coded off</p>
          </div>
          <span className="status plain">Stored in %APPDATA%</span>
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
            <span>Notify when a burn rule fires</span>
          </div>
          <button
            className={`switch${settings.notify_enabled ? ' on' : ''}`}
            type="button"
            aria-pressed={settings.notify_enabled}
            aria-label="Windows notifications"
            onClick={() => void onChange({ notify_enabled: !settings.notify_enabled })}
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
            aria-label="Network quota refresh"
            onClick={() =>
              void onChange({ network_quota_refresh: !settings.network_quota_refresh })
            }
          />
        </div>
      </article>

      <article className="panel">
        <div className="card-head">
          <div>
            <h3>Provider plans</h3>
            <p>Auto-detected from the API where possible; override the label if needed</p>
          </div>
        </div>
        <div className="card-body">
          <div className="grid grid-3">
            {PROVIDER_IDS.map((id) => {
              const cfg = settings.plans[id] ?? { mode: 'auto' as const }
              const presets = PLAN_PRESETS[id]
              const presetValues = presets.filter((v) => v !== 'Custom')
              const selected = presetValues.includes(cfg.value ?? '') ? cfg.value : 'Custom'
              return (
                <div key={id} className="plan-card">
                  <header>
                    <i className="swatch" style={{ background: PROVIDER_META[id].color }} />
                    <div>
                      <h4>{PROVIDER_META[id].name}</h4>
                      <p>
                        {cfg.detected ? `Detected: ${cfg.detected}` : 'No detection yet'}
                        {cfg.mode === 'manual' && cfg.value ? ` · showing ${cfg.value}` : ''}
                      </p>
                    </div>
                  </header>
                  <div className="field">
                    <label htmlFor={`plan-mode-${id}`}>Mode</label>
                    <select
                      id={`plan-mode-${id}`}
                      className="select"
                      value={cfg.mode}
                      onChange={(e) => void setPlanMode(id, e.target.value as 'auto' | 'manual')}
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
                        className="select"
                        value={selected}
                        onChange={(e) => void setPlanValue(id, e.target.value)}
                      >
                        {presets.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      {selected === 'Custom' ? (
                        <input
                          className="input"
                          type="text"
                          placeholder="Custom plan name"
                          value={cfg.value ?? ''}
                          onChange={(e) => void setPlanValue(id, e.target.value)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      </article>
    </>
  )
}
