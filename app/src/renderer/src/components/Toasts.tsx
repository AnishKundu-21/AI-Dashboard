import { IconCheck, IconWarning } from './Icons'

export interface ToastItem {
  id: number
  message: string
  tone: 'ok' | 'err'
}

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast${t.tone === 'err' ? ' err' : ''}`}>
          {t.tone === 'err' ? <IconWarning size={15} /> : <IconCheck size={15} />}
          {t.message}
        </div>
      ))}
    </div>
  )
}
