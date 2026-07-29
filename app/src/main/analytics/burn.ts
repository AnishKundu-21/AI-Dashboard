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
  rangeDays: number
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
    (latest && estimateDailyBurnPct(latest, rangeDays)) ??
    currentUsed / Math.max(rangeDays, 1)

  for (let i = 1; i <= 3; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() + i)
    points.push({
      day: d.toISOString().slice(0, 10),
      used_pct: Math.min(100, +(currentUsed + daily * i).toFixed(1)),
      projected: true
    })
  }

  return points
}
