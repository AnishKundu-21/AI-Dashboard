import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, CollectorHealth } from '@shared/types'
import {
  isProviderEnabled,
  providerIds,
  providerMeta,
  type ProviderId
} from '@shared/providers'
import { IconCheck, IconShield, IconSpark } from './Icons'

interface Props {
  settings: AppSettings
  health: CollectorHealth[]
  onFinish: (enabledProviders: Record<ProviderId, boolean>, scan: boolean) => Promise<void>
}

type Step = 0 | 1 | 2

const STEP_LABELS = ['Welcome', 'Providers', 'Ready'] as const

/**
 * A first-run tour that stays in the renderer: provider choices are staged
 * locally and committed once, through the same validated settings IPC as the
 * Settings page. No credentials or prompt content ever cross this boundary.
 */
export function Onboarding({ settings, health, onFinish }: Props) {
  const dialogRef = useRef<HTMLElement>(null)
  const busyRef = useRef(false)
  const [step, setStep] = useState<Step>(0)
  const [enabled, setEnabled] = useState<Record<ProviderId, boolean>>(() =>
    providerIds().reduce<Record<ProviderId, boolean>>((result, id) => {
      result[id] = isProviderEnabled(settings, id)
      return result
    }, {})
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  busyRef.current = busy

  const enabledIds = useMemo(
    () => providerIds().filter((id) => enabled[id]),
    [enabled]
  )

  const finish = async (scan: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await onFinish(enabled, scan)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save onboarding settings')
      setBusy(false)
    }
  }

  // Keep keyboard focus inside the setup dialog and return it to the shell
  // when setup closes. The backdrop is visual; this makes it modal to keyboard
  // and assistive-technology users as well.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = dialogRef.current
    const focusable = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          )
        : []

    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busyRef.current) void finish(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [])

  const toggle = (id: ProviderId) => {
    setEnabled((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <div className="onboarding-backdrop">
      <section ref={dialogRef} className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-accent" aria-hidden="true" />
        <div className="onboarding-head">
          <div className="onboarding-mark"><IconSpark size={18} /></div>
          <div>
            <span className="eyebrow">AI USAGE DASHBOARD</span>
            <p className="onboarding-step">Step {step + 1} of {STEP_LABELS.length}</p>
          </div>
        </div>

        <ol className="onboarding-progress" aria-label="Setup progress">
          {STEP_LABELS.map((label, index) => (
            <li key={label} className={index <= step ? 'active' : ''}>
              <span>{index < step ? <IconCheck size={12} /> : index + 1}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>

        {step === 0 ? (
          <div className="onboarding-content">
            <span className="eyebrow">PRIVATE BY DEFAULT</span>
            <h1 id="onboarding-title">Your AI usage, finally in one place.</h1>
            <p className="onboarding-lead">
              Track tokens, cache efficiency, cost-equivalent spend, sessions, and subscription
              limits from the tools already on this computer.
            </p>

            <div className="onboarding-trust-grid">
              <div className="onboarding-trust-card">
                <IconShield size={17} />
                <div><strong>Metadata only</strong><span>Prompts and responses are never saved.</span></div>
              </div>
              <div className="onboarding-trust-card">
                <IconCheck size={17} />
                <div><strong>Local first</strong><span>Your history stays in your local database.</span></div>
              </div>
              <div className="onboarding-trust-card">
                <IconSpark size={17} />
                <div><strong>Honest numbers</strong><span>Unknown prices and quotas stay clearly marked.</span></div>
              </div>
            </div>

            <p className="onboarding-note">
              The dashboard reads local usage metadata and never stores prompts or responses.
              When enabled, network access is also used to refresh provider quotas and download
              model-price and exchange-rate tables for cost estimates.
            </p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="onboarding-content">
            <span className="eyebrow">CHOOSE YOUR SOURCES</span>
            <h1 id="onboarding-title">What should we keep an eye on?</h1>
            <p className="onboarding-lead">
              We’ll watch the local folders for new sessions. You can change this any time in
              Settings. Status below reflects local folder access; credentials and quota access
              are checked during refresh.
            </p>

            <div className="onboarding-provider-grid">
              {providerIds().map((id) => {
                const meta = providerMeta(id)
                const selected = Boolean(enabled[id])
                const source = health.find((item) => item.provider === id)
                const status = providerStatus(source, selected)
                return (
                  <button
                    key={id}
                    className={`onboarding-provider${selected ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(id)}
                  >
                    <span className="onboarding-provider-top">
                      <i className="swatch" style={{ background: meta.color }} />
                      <strong>{meta.name}</strong>
                      <span className="onboarding-check"><IconCheck size={13} /></span>
                    </span>
                    <span className="onboarding-provider-home">{meta.homeLabel}</span>
                    <span className={`onboarding-provider-status ${status.tone}`}>
                      <i />{status.label}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="onboarding-selection">
              {enabledIds.length === 0
                ? 'Select at least one provider to continue.'
                : `${enabledIds.length} provider${enabledIds.length === 1 ? '' : 's'} selected`}
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="onboarding-content">
            <span className="eyebrow">READY WHEN YOU ARE</span>
            <h1 id="onboarding-title">Your dashboard is ready to learn.</h1>
            <p className="onboarding-lead">
              We’ll scan metadata from the providers below, then keep the dashboard current as you
              work. The first scan can take a moment on a large history.
            </p>

            <div className="onboarding-summary">
              <div className="onboarding-summary-count"><strong>{enabledIds.length}</strong><span>providers enabled</span></div>
              <div className="onboarding-summary-list">
                {enabledIds.map((id) => (
                  <span key={id}><i className="swatch" style={{ background: providerMeta(id).color }} />{providerMeta(id).short}</span>
                ))}
              </div>
            </div>

            <div className="onboarding-callout">
              <IconShield size={16} />
              <span>We retain usage metadata such as token classes, model names, timestamps, durations, project basenames, statuses, and cost estimates. Prompt and response content is never persisted or sent by the dashboard.</span>
            </div>
          </div>
        ) : null}

        {error ? <p className="onboarding-error" role="alert">{error}</p> : null}

        <footer className="onboarding-actions">
          {step === 0 ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => void finish(false)}>
              Skip for now
            </button>
          ) : (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => setStep((value) => (value - 1) as Step)}>
              Back
            </button>
          )}
          {step < 2 ? (
            <button
              className="btn primary"
              type="button"
              disabled={busy || (step === 1 && enabledIds.length === 0)}
              onClick={() => setStep((value) => (value + 1) as Step)}
            >
              Continue
            </button>
          ) : (
            <button className="btn primary" type="button" disabled={busy} onClick={() => void finish(true)}>
              {busy ? 'Scanning…' : 'Scan and open dashboard'}
            </button>
          )}
        </footer>
      </section>
    </div>
  )
}

function providerStatus(
  health: CollectorHealth | undefined,
  enabled: boolean
): { tone: 'good' | 'warn' | 'plain'; label: string } {
  if (!enabled) return { tone: 'plain', label: 'Disabled until enabled' }
  if (!health) return { tone: 'plain', label: 'Checking local files' }
  if (health.watcher_status === 'error') return { tone: 'warn', label: 'Needs attention' }
  if (health.watcher_status === 'missing') return { tone: 'warn', label: 'Local folder not found' }
  return { tone: 'good', label: health.sessions_seen > 0 ? `${health.sessions_seen} sessions found` : 'Local folder found' }
}
