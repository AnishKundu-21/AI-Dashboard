import { describe, expect, it } from 'vitest'
import {
  dayInZone,
  enumerateDays,
  enumerateUsageBucketPoints,
  enumerateUsageBuckets,
  makeDayFormatter,
  makeUsageBucketFormatter,
  rangeStartMs,
  resolveAnalyticsPeriod,
  resolveTimeZone,
  startOfDayMs,
  usageBucketStartMs
} from './time'

describe('dayInZone', () => {
  it('answers in the requested zone, not the host zone', () => {
    // 2026-03-01T02:30Z is still Feb 28 in New York.
    const instant = Date.parse('2026-03-01T02:30:00Z')
    expect(dayInZone(instant, 'UTC')).toBe('2026-03-01')
    expect(dayInZone(instant, 'America/New_York')).toBe('2026-02-28')
    expect(dayInZone(instant, 'Asia/Kolkata')).toBe('2026-03-01')
  })

  it('degrades an unknown zone to UTC instead of throwing', () => {
    expect(dayInZone(Date.parse('2026-03-01T02:30:00Z'), 'Mars/Olympus')).toBe(
      '2026-03-01'
    )
  })
})

describe('startOfDayMs', () => {
  it('resolves midnight in a half-hour offset zone', () => {
    // IST is UTC+5:30, so 2026-03-01 00:00 IST is 2026-02-28 18:30Z.
    expect(startOfDayMs('2026-03-01', 'Asia/Kolkata')).toBe(
      Date.parse('2026-02-28T18:30:00Z')
    )
  })

  it('resolves midnight either side of a DST boundary', () => {
    // US DST began 2026-03-08; the day before is still EST (UTC-5).
    expect(startOfDayMs('2026-03-07', 'America/New_York')).toBe(
      Date.parse('2026-03-07T05:00:00Z')
    )
    // The day after is EDT (UTC-4).
    expect(startOfDayMs('2026-03-09', 'America/New_York')).toBe(
      Date.parse('2026-03-09T04:00:00Z')
    )
  })

  it('round-trips with the day formatter', () => {
    const format = makeDayFormatter('Asia/Kolkata')
    expect(format(startOfDayMs('2026-07-04', 'Asia/Kolkata'))).toBe('2026-07-04')
  })
})

describe('rangeStartMs', () => {
  const now = Date.parse('2026-07-04T09:00:00Z')

  it('treats one day as today only', () => {
    expect(rangeStartMs(1, 'UTC', now)).toBe(Date.parse('2026-07-04T00:00:00Z'))
  })

  it('counts inclusively backwards', () => {
    expect(rangeStartMs(7, 'UTC', now)).toBe(Date.parse('2026-06-28T00:00:00Z'))
  })

  it('has no start for the full history', () => {
    expect(rangeStartMs(0, 'UTC', now)).toBeNull()
  })

  it('anchors on the local day, not the UTC day', () => {
    // 09:00Z Jul 4 is 14:30 IST the same day; today in IST began 18:30Z Jul 3.
    expect(rangeStartMs(1, 'Asia/Kolkata', now)).toBe(
      Date.parse('2026-07-03T18:30:00Z')
    )
  })

  it('uses calendar days rather than fixed 24-hour blocks across spring DST', () => {
    expect(
      rangeStartMs(3, 'America/New_York', Date.parse('2026-03-09T16:00:00.000Z'))
    ).toBe(Date.parse('2026-03-07T05:00:00.000Z'))
  })
})

describe('resolveTimeZone', () => {
  it('resolves the system sentinel to a real zone', () => {
    expect(resolveTimeZone('system')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    )
    expect(resolveTimeZone(null)).toBeTruthy()
  })
})

describe('makeUsageBucketFormatter', () => {
  it('groups hours, weeks, and months by local calendar time', () => {
    const instant = Date.parse('2026-03-01T02:30:00.000Z')
    expect(makeUsageBucketFormatter('America/New_York', 'hour')(instant)).toBe(
      '2026-02-28 21:00 -05:00'
    )
    expect(makeUsageBucketFormatter('America/New_York', 'week')(instant)).toBe('2026-02-23')
    expect(makeUsageBucketFormatter('America/New_York', 'month')(instant)).toBe('2026-02-01')
  })

  it('keeps both repeated fall-back hours distinct and enumerates 25 local hours', () => {
    const hourOf = makeUsageBucketFormatter('America/New_York', 'hour')
    expect(hourOf(Date.parse('2026-11-01T05:30:00.000Z'))).toBe('2026-11-01 01:00 -04:00')
    expect(hourOf(Date.parse('2026-11-01T06:30:00.000Z'))).toBe('2026-11-01 01:00 -05:00')
    expect(
      enumerateUsageBuckets('2026-11-01', '2026-11-01', 'America/New_York', 'hour')
    ).toHaveLength(25)
  })

  it('orders local-hour buckets by instant and respects a half-hour offset', () => {
    const buckets = enumerateUsageBucketPoints(
      '2026-11-01',
      '2026-11-01',
      'America/New_York',
      'hour'
    )
    expect(buckets.map((bucket) => bucket.startMs)).toEqual(
      [...buckets.map((bucket) => bucket.startMs)].sort((a, b) => a - b)
    )
    expect(usageBucketStartMs(Date.parse('2026-03-01T19:45:00.000Z'), 'Asia/Kathmandu', 'hour')).toBe(
      Date.parse('2026-03-01T19:15:00.000Z')
    )
  })

  it('uses the real bucket boundary through Lord Howe 30-minute DST changes', () => {
    const zone = 'Australia/Lord_Howe'
    const spring = Date.parse('2026-10-03T15:30:00.000Z')
    const springNextHour = Date.parse('2026-10-03T16:00:00.000Z')
    const fall = Date.parse('2026-04-04T15:00:00.000Z')
    const fallNextHour = Date.parse('2026-04-04T15:30:00.000Z')
    expect(usageBucketStartMs(spring, zone, 'hour')).toBe(spring)
    expect(usageBucketStartMs(springNextHour, zone, 'hour')).toBe(springNextHour)
    expect(usageBucketStartMs(fall, zone, 'hour')).toBe(fall)
    expect(usageBucketStartMs(fallNextHour, zone, 'hour')).toBe(fallNextHour)

    const buckets = enumerateUsageBucketPoints('2026-10-04', '2026-10-04', zone, 'hour')
    const springNextKey = makeUsageBucketFormatter(zone, 'hour')(springNextHour)
    expect(buckets.find((bucket) => bucket.key === springNextKey)?.startMs).toBe(springNextHour)
  })
})

describe('enumerateDays', () => {
  it('includes both endpoints', () => {
    expect(enumerateDays('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02'
    ])
  })

  it('returns a single day when the range is one day', () => {
    expect(enumerateDays('2026-03-01', '2026-03-01')).toEqual(['2026-03-01'])
  })
})

describe('resolveAnalyticsPeriod', () => {
  it('uses equal-length, adjacent calendar windows for a preset', () => {
    const period = resolveAnalyticsPeriod(
      { range_days: 3 },
      'UTC',
      Date.parse('2026-09-06T10:00:00.000Z')
    )
    expect(period.current).toMatchObject({
      startDay: '2026-09-04',
      endDay: '2026-09-06',
      startMs: Date.parse('2026-09-04T00:00:00.000Z'),
      endMs: Date.parse('2026-09-07T00:00:00.000Z'),
      days: 3
    })
    expect(period.previous).toMatchObject({
      startDay: '2026-09-01',
      endDay: '2026-09-03',
      startMs: Date.parse('2026-09-01T00:00:00.000Z'),
      endMs: Date.parse('2026-09-04T00:00:00.000Z'),
      days: 3
    })
  })

  it('keeps custom ranges inclusive across a daylight-saving transition', () => {
    const period = resolveAnalyticsPeriod(
      { start_day: '2026-03-07', end_day: '2026-03-09' },
      'America/New_York'
    )
    expect(period.current).toMatchObject({
      startDay: '2026-03-07',
      endDay: '2026-03-09',
      startMs: Date.parse('2026-03-07T05:00:00.000Z'),
      endMs: Date.parse('2026-03-10T04:00:00.000Z'),
      days: 3
    })
    expect(period.previous).toMatchObject({
      startDay: '2026-03-04',
      endDay: '2026-03-06',
      endMs: Date.parse('2026-03-07T05:00:00.000Z'),
      days: 3
    })
  })

  it('rejects custom windows that end after the current local day', () => {
    expect(() =>
      resolveAnalyticsPeriod(
        { start_day: '2026-09-05', end_day: '2026-09-07' },
        'UTC',
        Date.parse('2026-09-06T10:00:00.000Z')
      )
    ).toThrow('cannot end after today')
  })

  it('does not invent a comparison for lifetime history', () => {
    expect(resolveAnalyticsPeriod({ range_days: 0 }, 'UTC')).toEqual({
      current: { startDay: null, endDay: null, startMs: null, endMs: null, days: null },
      previous: null
    })
  })
})
