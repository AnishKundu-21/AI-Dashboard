/** Small chart math helpers so every SVG in the app shares one visual language. */

export interface Pt {
  x: number
  y: number
}

/** Rounds an axis maximum up to a friendly 1/2/2.5/5 x 10^n step. */
export function niceMax(raw: number, ticks = 4): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1
  const rough = raw / ticks
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return step * mag * ticks
}

export function tickValues(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i)
}

/** Compact axis / label number, e.g. 1.2M, 340K, 87. */
export function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${trim(n / 1_000_000_000)}B`
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`
  if (abs >= 1_000) return `${trim(n / 1_000)}K`
  return String(Math.round(n))
}

function trim(n: number): string {
  const s = n.toFixed(n < 10 ? 1 : 0)
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Straight polyline through the points. */
export function linePath(points: Pt[]): string {
  if (points.length === 0) return ''
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`)
    .join(' ')
}

/**
 * Monotone cubic interpolation — smooth without the overshoot that plain
 * Catmull-Rom introduces on spiky usage data.
 */
export function smoothPath(points: Pt[], tension = 0.32): string {
  if (points.length < 2) return linePath(points)
  let d = `M${round(points[0].x)},${round(points[0].y)}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + ((p2.x - p0.x) / 6) * tension * 2, y: p1.y + ((p2.y - p0.y) / 6) * tension * 2 }
    const c2 = { x: p2.x - ((p3.x - p1.x) / 6) * tension * 2, y: p2.y - ((p3.y - p1.y) / 6) * tension * 2 }
    d += ` C${round(c1.x)},${round(c1.y)} ${round(c2.x)},${round(c2.y)} ${round(p2.x)},${round(p2.y)}`
  }
  return d
}

/** Closes a line path down to `baseline` so it can be filled as an area. */
export function areaPath(points: Pt[], baseline: number, smooth = true): string {
  if (points.length === 0) return ''
  const top = smooth ? smoothPath(points) : linePath(points)
  const last = points[points.length - 1]
  const first = points[0]
  return `${top} L${round(last.x)},${round(baseline)} L${round(first.x)},${round(baseline)} Z`
}

/** Rounded-top bar, flat at the bottom. */
export function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h))
  const bottom = y + h
  return [
    `M${round(x)},${round(bottom)}`,
    `L${round(x)},${round(y + radius)}`,
    `Q${round(x)},${round(y)} ${round(x + radius)},${round(y)}`,
    `L${round(x + w - radius)},${round(y)}`,
    `Q${round(x + w)},${round(y)} ${round(x + w)},${round(y + radius)}`,
    `L${round(x + w)},${round(bottom)}`,
    'Z'
  ].join(' ')
}

/** Donut/gauge segment as an annulus wedge. Angles in degrees, 0 = 12 o'clock. */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startDeg: number,
  endDeg: number
): string {
  const sweep = endDeg - startDeg
  if (sweep <= 0) return ''
  // A full circle can't be drawn with a single arc; nudge it closed.
  const end = sweep >= 360 ? startDeg + 359.999 : endDeg
  const p0 = polar(cx, cy, rOuter, startDeg)
  const p1 = polar(cx, cy, rOuter, end)
  const p2 = polar(cx, cy, rInner, end)
  const p3 = polar(cx, cy, rInner, startDeg)
  const large = end - startDeg > 180 ? 1 : 0
  return [
    `M${round(p0.x)},${round(p0.y)}`,
    `A${round(rOuter)},${round(rOuter)} 0 ${large} 1 ${round(p1.x)},${round(p1.y)}`,
    `L${round(p2.x)},${round(p2.y)}`,
    `A${round(rInner)},${round(rInner)} 0 ${large} 0 ${round(p3.x)},${round(p3.y)}`,
    'Z'
  ].join(' ')
}

export function polar(cx: number, cy: number, r: number, deg: number): Pt {
  const rad = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

/** Total path length of a polyline, used to seed stroke draw-in animations. */
export function pathLength(points: Pt[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return Math.max(len * 1.15, 1)
}

/** MM-DD from an ISO day string, for dense axes. */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-')
  return m && d ? `${m}/${d}` : day
}

export function weekdayLabel(day: string): string {
  const dt = new Date(`${day}T00:00:00`)
  return Number.isNaN(dt.getTime())
    ? day
    : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
