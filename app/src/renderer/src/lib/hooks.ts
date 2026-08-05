/** Renderer-only UI hooks: motion preferences, theme, animated counters, timers. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export type ThemeMode = 'dark' | 'light'

const THEME_KEY = 'aiud.theme'
const NAV_KEY = 'aiud.nav.collapsed'

/** True when the OS asks for reduced motion; all entrance/draw animations opt out. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchReduced())
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function matchReduced(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Theme is applied to <html data-theme> so CSS tokens and charts stay in sync. */
export function useTheme(): [ThemeMode, (next: ThemeMode) => void] {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem(THEME_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'dark'
  })

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    window.localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return [theme, setTheme]
}

export function useCollapsedNav(): [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem(NAV_KEY) === '1'
  )
  useEffect(() => {
    window.localStorage.setItem(NAV_KEY, collapsed ? '1' : '0')
  }, [collapsed])
  return [collapsed, setCollapsed]
}

const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t))

/**
 * Eases a numeric readout toward `value`. Restarts from the previous displayed
 * number so repeated refreshes tick rather than snap.
 */
export function useCountUp(value: number, duration = 900): number {
  const reduced = usePrefersReducedMotion()
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const frameRef = useRef(0)

  useEffect(() => {
    if (reduced || duration <= 0) {
      fromRef.current = value
      setDisplay(value)
      return
    }
    const from = fromRef.current
    const delta = value - from
    if (delta === 0) return

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const next = from + delta * easeOutExpo(t)
      setDisplay(next)
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = value
      }
    }
    frameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, duration, reduced])

  return display
}

/** Flips to true one frame after mount so CSS entrance transitions have a start state. */
export function useMountedFlag(delay = 0): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), delay)
    return () => window.clearTimeout(id)
  }, [delay])
  return mounted
}

/** Ticking clock used for "updated 12s ago" style labels. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

/** Observes an element's width so SVG charts can lay out against real pixels. */
export function useElementWidth<T extends HTMLElement>(
  fallback = 640
): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // Sub-pixel churn would re-render the chart on every observation.
    const apply = (next: number) => {
      if (next > 0) setWidth((prev) => (Math.abs(next - prev) > 0.5 ? next : prev))
    }
    // Measure synchronously first: ResizeObserver's initial callback lands a
    // frame later, which would otherwise paint one chart at the fallback size.
    apply(el.clientWidth)
    const ro = new ResizeObserver((entries) => apply(entries[0]?.contentRect.width ?? 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

export interface HoverProbe {
  /** Index of the nearest data point, or null when the pointer left the plot. */
  index: number | null
  /** Pointer position in container pixels, for tooltip placement. */
  x: number
  y: number
}

/**
 * Maps pointer position over a chart to the nearest slot index.
 * `padLeft`/`padRight` are in viewBox units and scaled to the rendered size.
 */
export function useChartHover(count: number, viewW: number, padL: number, padR: number) {
  const [probe, setProbe] = useState<HoverProbe>({ index: null, x: 0, y: 0 })

  const onMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (count === 0) return
      const rect = e.currentTarget.getBoundingClientRect()
      if (rect.width === 0) return
      const scale = rect.width / viewW
      const px = e.clientX - rect.left
      const plotStart = padL * scale
      const plotEnd = rect.width - padR * scale
      const clamped = Math.min(Math.max(px, plotStart), plotEnd)
      const t = (clamped - plotStart) / Math.max(plotEnd - plotStart, 1)
      const index = Math.min(count - 1, Math.max(0, Math.round(t * (count - 1))))
      setProbe({ index, x: px, y: e.clientY - rect.top })
    },
    [count, viewW, padL, padR]
  )

  const onLeave = useCallback(() => setProbe({ index: null, x: 0, y: 0 }), [])

  return { probe, onMove, onLeave }
}
