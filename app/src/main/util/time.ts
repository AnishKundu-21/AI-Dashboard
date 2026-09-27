/**
 * Wall-clock day arithmetic in an arbitrary IANA zone.
 *
 * `Intl.DateTimeFormat` is the only dependable way to resolve what calendar
 * day an instant falls on somewhere else, and the `en-CA` locale is used
 * because it formats ISO-ordered parts. Assembling a day from `Date` getters
 * instead would silently answer in the host's zone.
 */
import type { UsageResolution } from '../../shared/types'

const DAY_MS = 86_400_000
const resolvedZoneCache = new Map<string, string>()
const dayFormatterCache = new Map<string, Intl.DateTimeFormat>()
const hourFormatterCache = new Map<string, Intl.DateTimeFormat>()
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>()
const usageBucketFormatterCache = new Map<string, (timestampMs: number) => string>()

export type AnalyticsPeriodSelection =
  | { range_days: number; start_day?: never; end_day?: never }
  | { start_day: string; end_day: string; range_days?: never }

export type ResolvedAnalyticsWindow = {
  startDay: string | null
  endDay: string | null
  startMs: number | null
  endMs: number | null
  days: number | null
}

export type ResolvedAnalyticsPeriod = {
  current: ResolvedAnalyticsWindow
  previous: ResolvedAnalyticsWindow | null
}

export type UsageBucketPoint = { key: string; startMs: number }

export function resolveTimeZone(timezone: string | null | undefined): string {
  const cacheKey = timezone || 'system'
  const cached = resolvedZoneCache.get(cacheKey)
  if (cached) return cached
  if (!timezone || timezone === 'system') {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    resolvedZoneCache.set(cacheKey, resolved)
    return resolved
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    resolvedZoneCache.set(cacheKey, timezone)
    return timezone
  } catch {
    resolvedZoneCache.set(cacheKey, 'UTC')
    return 'UTC'
  }
}

function makeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dayFormatterCache.get(timeZone)
  if (cached) return cached
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    dayFormatterCache.set(timeZone, formatter)
    return formatter
  } catch {
    // An unknown zone degrades to UTC rather than failing the whole scan.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    dayFormatterCache.set(timeZone, formatter)
    return formatter
  }
}

function makeHourFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = hourFormatterCache.get(timeZone)
  if (cached) return cached
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', options)
    hourFormatterCache.set(timeZone, formatter)
    return formatter
  } catch {
    const formatter = new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' })
    hourFormatterCache.set(timeZone, formatter)
    return formatter
  }
}

function offsetLabel(offsetMs: number): string {
  const sign = offsetMs >= 0 ? '+' : '-'
  const totalMinutes = Math.round(Math.abs(offsetMs) / 60_000)
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0')
  const minutes = (totalMinutes % 60).toString().padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

/**
 * Builds a reusable `ms -> YYYY-MM-DD` formatter. Constructing an
 * `Intl.DateTimeFormat` is expensive relative to formatting with one, and a
 * scan formats once per usage event, so callers hoist this out of the loop.
 */
export function makeDayFormatter(
  timezone: string | null | undefined
): (timestampMs: number) => string {
  const format = makeFormatter(resolveTimeZone(timezone))
  return (timestampMs) => format.format(new Date(timestampMs))
}

export function dayInZone(
  timestampMs: number,
  timezone: string | null | undefined
): string {
  return makeDayFormatter(timezone)(timestampMs)
}

/** A reusable calendar bucket formatter for usage charts. */
export function makeUsageBucketFormatter(
  timezone: string | null | undefined,
  resolution: UsageResolution
): (timestampMs: number) => string {
  const zone = resolveTimeZone(timezone)
  const cacheKey = `${zone}\u0000${resolution}`
  const cached = usageBucketFormatterCache.get(cacheKey)
  if (cached) return cached
  const dayOf = makeDayFormatter(zone)
  if (resolution === 'day') {
    usageBucketFormatterCache.set(cacheKey, dayOf)
    return dayOf
  }
  if (resolution === 'hour') {
    const format = makeHourFormatter(zone)
    const formatter = (timestampMs: number) => {
      const parts = format.formatToParts(new Date(timestampMs))
      const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
      return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:00 ${offsetLabel(zoneOffsetMs(timestampMs, zone))}`
    }
    usageBucketFormatterCache.set(cacheKey, formatter)
    return formatter
  }
  if (resolution === 'month') {
    const formatter = (timestampMs: number) => `${dayOf(timestampMs).slice(0, 7)}-01`
    usageBucketFormatterCache.set(cacheKey, formatter)
    return formatter
  }
  const formatter = (timestampMs: number) => {
    const day = dayOf(timestampMs)
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay()
    return addCalendarDays(day, -((weekday + 6) % 7))
  }
  usageBucketFormatterCache.set(cacheKey, formatter)
  return formatter
}

/**
 * First instant of `day` in `timezone`, as epoch ms.
 *
 * Resolving a wall-clock time back to an instant needs the zone's offset *at
 * that instant*, which depends on the answer. Two passes converge: the first
 * uses the offset at the UTC guess, the second the offset at the corrected
 * time. That settles every case except a timestamp inside a DST gap, where
 * either neighbouring offset is defensible.
 */
export function startOfDayMs(
  day: string,
  timezone: string | null | undefined
): number {
  const zone = resolveTimeZone(timezone)
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return Number.NaN
  const wallClock = Date.UTC(year, month - 1, date)
  let guess = wallClock - zoneOffsetMs(wallClock, zone)
  guess = wallClock - zoneOffsetMs(guess, zone)
  return guess
}

/** How far ahead of UTC `timeZone` runs at `timestampMs`, in ms. */
export function zoneOffsetMs(timestampMs: number, timeZone: string): number {
  let formatter = offsetFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    offsetFormatterCache.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(timestampMs))
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value)
  return (
    Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
      value('second')
    ) - timestampMs
  )
}

/**
 * Inclusive start of a range that ends today: `rangeDays === 1` is today only.
 * `0` means the whole retained history and has no start.
 */
export function rangeStartMs(
  rangeDays: number,
  timezone: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (rangeDays === 0) return null
  const zone = resolveTimeZone(timezone)
  const today = makeDayFormatter(zone)(nowMs)
  // Calendar arithmetic is essential here: subtracting fixed 24-hour blocks
  // crosses a 23- or 25-hour DST day and can select one extra calendar date.
  const target = addCalendarDays(today, -(rangeDays - 1))
  return startOfDayMs(target, zone)
}

/** Adds calendar dates without accidentally applying a machine timezone. */
export function addCalendarDays(day: string, amount: number): string {
  const base = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) return ''
  base.setUTCDate(base.getUTCDate() + amount)
  return base.toISOString().slice(0, 10)
}

function calendarDayCount(startDay: string, endDay: string): number {
  const start = Date.parse(`${startDay}T00:00:00.000Z`)
  const end = Date.parse(`${endDay}T00:00:00.000Z`)
  return Math.floor((end - start) / DAY_MS) + 1
}

/**
 * Resolves a preset or custom analytics selection exactly once, in the usage
 * timezone. The end instant is exclusive so event queries never double-count a
 * midnight boundary. Lifetime intentionally has no prior-period comparison.
 */
export function resolveAnalyticsPeriod(
  selection: AnalyticsPeriodSelection,
  timezone: string | null | undefined,
  nowMs: number = Date.now()
): ResolvedAnalyticsPeriod {
  const zone = resolveTimeZone(timezone)
  if (selection.start_day && selection.end_day) {
    if (selection.end_day > dayInZone(nowMs, zone)) {
      throw new RangeError('Custom analytics ranges cannot end after today.')
    }
    const days = calendarDayCount(selection.start_day, selection.end_day)
    const current: ResolvedAnalyticsWindow = {
      startDay: selection.start_day,
      endDay: selection.end_day,
      startMs: startOfDayMs(selection.start_day, zone),
      endMs: startOfDayMs(addCalendarDays(selection.end_day, 1), zone),
      days
    }
    const previousStartDay = addCalendarDays(selection.start_day, -days)
    return {
      current,
      previous: {
        startDay: previousStartDay,
        endDay: addCalendarDays(selection.start_day, -1),
        startMs: startOfDayMs(previousStartDay, zone),
        endMs: current.startMs,
        days
      }
    }
  }

  const rangeDays = selection.range_days ?? 7
  if (rangeDays === 0) {
    return {
      current: { startDay: null, endDay: null, startMs: null, endMs: null, days: null },
      previous: null
    }
  }

  const endDay = dayInZone(nowMs, zone)
  const startDay = addCalendarDays(endDay, -(rangeDays - 1))
  const startMs = startOfDayMs(startDay, zone)
  const days = rangeDays
  const previousStartDay = addCalendarDays(startDay, -days)
  return {
    current: {
      startDay,
      endDay,
      startMs,
      endMs: startOfDayMs(addCalendarDays(endDay, 1), zone),
      days
    },
    previous: {
      startDay: previousStartDay,
      endDay: addCalendarDays(startDay, -1),
      startMs: startOfDayMs(previousStartDay, zone),
      endMs: startMs,
      days
    }
  }
}

/** Every day from `fromDay` to `toDay` inclusive, so charts can show gaps as zero. */
export function enumerateDays(fromDay: string, toDay: string): string[] {
  const days: string[] = []
  const end = Date.parse(`${toDay}T00:00:00Z`)
  let cursor = Date.parse(`${fromDay}T00:00:00Z`)
  if (Number.isNaN(cursor) || Number.isNaN(end)) return days
  while (cursor <= end) {
    days.push(new Date(cursor).toISOString().slice(0, 10))
    cursor += DAY_MS
  }
  return days
}

/**
 * Every bucket intersecting an inclusive local-date window. Filling these
 * explicitly prevents charts from rendering a two-day quiet gap as adjacent
 * points, and the elapsed-hour loop preserves both fall-back 01:00 hours.
 */
export function usageBucketStartMs(
  timestampMs: number,
  timezone: string | null | undefined,
  resolution: UsageResolution
): number {
  if (resolution === 'hour') {
    const zone = resolveTimeZone(timezone)
    const bucketOf = makeUsageBucketFormatter(zone, 'hour')
    const key = bucketOf(timestampMs)
    const parts = makeHourFormatter(zone).formatToParts(new Date(timestampMs))
    const value = (type: string): number =>
      Number(parts.find((part) => part.type === type)?.value)
    // Rebuild the usual wall-clock boundary first. When a zone changes its
    // offset by 30 minutes (Lord Howe), that wall-clock time can be skipped or
    // belong to the earlier offset. Walk forward to the first actual instant
    // carrying this exact local-hour-and-offset key.
    const candidate =
      Date.UTC(value('year'), value('month') - 1, value('day'), value('hour')) -
      zoneOffsetMs(timestampMs, zone)
    for (let step = 0; step <= 60; step += 1) {
      const cursor = candidate + step * 60_000
      if (bucketOf(cursor) === key) return cursor
    }

    // Defensive fallback for an unexpected Intl implementation. Normal
    // IANA zones always return inside the loop above.
    return Math.floor(timestampMs / 3_600_000) * 3_600_000
  }
  const key = makeUsageBucketFormatter(timezone, resolution)(timestampMs)
  return startOfDayMs(key.slice(0, 10), timezone)
}

export function enumerateUsageBucketPoints(
  fromDay: string,
  toDay: string,
  timezone: string | null | undefined,
  resolution: UsageResolution,
  /**
   * Do not create zero-valued buckets beyond this instant. Existing events
   * remain visible in their in-progress bucket; this only prevents a chart
   * from implying that future hours have already recorded zero usage.
   */
  fillUntilMs?: number
): UsageBucketPoint[] {
  const bucketOf = makeUsageBucketFormatter(timezone, resolution)
  if (resolution === 'day') {
    return enumerateDays(fromDay, toDay).map((key) => ({
      key,
      startMs: startOfDayMs(key, timezone)
    }))
  }
  if (resolution === 'hour') {
    const buckets = new Map<string, UsageBucketPoint>()
    const endMs = Math.min(
      startOfDayMs(addCalendarDays(toDay, 1), timezone),
      fillUntilMs ?? Number.POSITIVE_INFINITY
    )
    // Sampling actual instants lets us enumerate the variable-width hour
    // buckets made by 30-minute DST changes without inventing a wall-clock
    // time that never occurred. Fifteen minutes safely observes every modern
    // IANA offset transition. Because the loop is chronological and starts at
    // local midnight, the first sample for a key is also that bucket's real
    // boundary. Re-resolving the same boundary through Intl for every sample
    // made a seven-day hourly chart spend hundreds of milliseconds here.
    for (let cursor = startOfDayMs(fromDay, timezone); cursor < endMs; cursor += 15 * 60_000) {
      const key = bucketOf(cursor)
      const existing = buckets.get(key)
      if (!existing || cursor < existing.startMs) buckets.set(key, { key, startMs: cursor })
    }
    return Array.from(buckets.values()).sort((a, b) => a.startMs - b.startMs)
  }
  if (resolution === 'week') {
    const buckets: UsageBucketPoint[] = []
    const last = bucketOf(startOfDayMs(toDay, timezone))
    for (let cursor = bucketOf(startOfDayMs(fromDay, timezone)); cursor <= last; cursor = addCalendarDays(cursor, 7)) {
      buckets.push({ key: cursor, startMs: startOfDayMs(cursor, timezone) })
    }
    return buckets
  }

  const buckets: UsageBucketPoint[] = []
  const [fromYear, fromMonth] = fromDay.split('-').map(Number)
  const [toYear, toMonth] = toDay.split('-').map(Number)
  let year = fromYear
  let month = fromMonth
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const key = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-01`
    buckets.push({ key, startMs: startOfDayMs(key, timezone) })
    month += 1
    if (month === 13) {
      year += 1
      month = 1
    }
  }
  return buckets
}

export function enumerateUsageBuckets(
  fromDay: string,
  toDay: string,
  timezone: string | null | undefined,
  resolution: UsageResolution
): string[] {
  return enumerateUsageBucketPoints(fromDay, toDay, timezone, resolution).map((bucket) => bucket.key)
}
