import type { BurnPoint, QuotaSnapshot } from '../../shared/types'
import { estimateDailyBurnPct } from './projections'

export interface SnapshotSample {
  day: string
  used_pct: number
  captured_at: string
}

/**
 * Build observed burn series from historical snapshots (one point per day),
 * then project 3 days forward using daily burn estimate.
 */
export function buildBurnSeries(
  latest: QuotaSnapshot | undefined,
  history: SnapshotSample[],
  rangeDays: number,
  windowDurationMins?: number | null
): BurnPoint[] {
  const now = new Date()
  const start = new Date(now)
  start.setDate(start.getDate() - Math.max(rangeDays - 1, 0))
  const startDay = start.toISOString().slice(0, 10)

  // Collapse to last sample per day
  const byDay = new Map<string, number>()
  for (const h of history) {
    if (h.day < startDay) continue
    byDay.set(h.day, h.used_pct)
  }

  // Include the latest value only on the day it was actually captured.
  const latestDay = latest?.captured_at.slice(0, 10)
  if (latest?.used_pct != null && latestDay && latestDay >= startDay) {
    byDay.set(latestDay, latest.used_pct)
  }

  // Solid chart points are returned provider observations only. Missing days
  // must remain missing instead of being filled or synthesized.
  const points: BurnPoint[] = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, used_pct]) => ({ day, used_pct, projected: false }))

  if (points.length === 0) return []

  const currentUsed =
    latest?.used_pct ??
    (points.length ? points[points.length - 1].used_pct : 0)
  const daily =
    (latest && estimateDailyBurnPct(latest, rangeDays, windowDurationMins)) ??
    currentUsed / Math.max(rangeDays, 1)
  const deltaSpread = observedDeltaSpread(points)

  for (let i = 1; i <= 3; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    const used_pct = Math.min(100, +(currentUsed + daily * i).toFixed(1))
    const spread = deltaSpread == null ? undefined : deltaSpread * Math.sqrt(i)
    points.push({
      day: d.toISOString().slice(0, 10),
      used_pct,
      projected: true,
      ...(spread == null
        ? {}
        : {
            lower_used_pct: Math.max(0, +(used_pct - spread).toFixed(1)),
            upper_used_pct: Math.min(100, +(used_pct + spread).toFixed(1))
          })
    })
  }

  return points
}

/** Sample standard deviation of observed non-reset daily increases. */
function observedDeltaSpread(points: BurnPoint[]): number | null {
  const values = points.filter((point) => !point.projected).map((point) => point.used_pct)
  const increases: number[] = []
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    // A drop is a quota reset, not negative burn.
    if (delta >= 0) increases.push(delta)
  }
  if (increases.length < 2) return null
  const mean = increases.reduce((sum, value) => sum + value, 0) / increases.length
  const variance = increases.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (increases.length - 1)
  const spread = Math.sqrt(variance)
  return spread > 0.05 ? spread : null
}
