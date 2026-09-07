import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './Icons'

/** Native modal semantics provide focus containment, Escape and focus return. */
export function Modal({ title, onClose, children, drawer = false }: {
  title: string
  onClose: () => void
  children: ReactNode
  drawer?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => {
      dialog?.close()
      previous?.focus()
    }
  }, [])
  return createPortal(
    <dialog ref={ref} className={`workspace-dialog${drawer ? ' drawer' : ''}`}
      aria-label={title} onCancel={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog-inner">
        <header className="dialog-head"><h2>{title}</h2>
          <button className="btn icon-only" aria-label="Close dialog" onClick={onClose}><IconClose size={16} /></button>
        </header>
        {children}
      </div>
    </dialog>, document.body)
}
