import { useLayoutEffect, useRef, useState } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** Optional accent shown as a small diamond before the label. */
  color?: string
}

interface Props<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (next: T) => void
  ariaLabel: string
}

/** Segmented control whose indicator slides between options. */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: Props<T>) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [thumb, setThumb] = useState({ left: 3, width: 0 })

  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current
      const btn = btnRefs.current[value]
      if (!wrap || !btn) return
      const wrapRect = wrap.getBoundingClientRect()
      const btnRect = btn.getBoundingClientRect()
      // `left: 0` on the thumb sits at the padding edge, so drop the border width.
      const left = btnRect.left - wrapRect.left - wrap.clientLeft
      const width = btnRect.width
      // Bail on an unchanged measurement: `options` is rebuilt by the parent on
      // every render, so an unconditional set could feed back into this effect.
      setThumb((prev) =>
        Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
          ? prev
          : { left, width }
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (wrapRef.current) ro.observe(wrapRef.current)
    return () => ro.disconnect()
    // Options are compared by length; their labels drive width via `value`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options.length])

  return (
    <div className="segmented" role="tablist" aria-label={ariaLabel} ref={wrapRef}>
      <span
        className="segmented-thumb"
        style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }}
        aria-hidden="true"
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? 'active' : ''}
          ref={(el) => {
            btnRefs.current[o.value] = el
          }}
          onClick={() => onChange(o.value)}
        >
          {o.color ? <i style={{ background: o.color, color: o.color }} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  )
}
