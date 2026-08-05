import type { AlertRow } from '@shared/types'
import { IconClose, IconInfo, IconWarning } from './Icons'

interface Props {
  alerts: AlertRow[]
  onDismiss: (id: string) => void
}

export function AlertStack({ alerts, onDismiss }: Props) {
  if (alerts.length === 0) return null
  return (
    <div className="alert-stack">
      {alerts.map((a) => (
        <div key={a.id} className={`alert ${a.level}`} role="status">
          {a.level === 'info' ? <IconInfo size={15} /> : <IconWarning size={15} />}
          <div>
            <strong>{a.title}</strong>
            <p>{a.body}</p>
          </div>
          <button
            className="alert-close"
            type="button"
            aria-label={`Dismiss ${a.title}`}
            onClick={() => onDismiss(a.id)}
          >
            <IconClose size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
