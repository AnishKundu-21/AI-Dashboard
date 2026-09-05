import { describe, expect, it } from 'vitest'
import {
  dayInZone,
  enumerateDays,
  makeDayFormatter,
  rangeStartMs,
  resolveTimeZone,
  startOfDayMs
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
})

describe('resolveTimeZone', () => {
  it('resolves the system sentinel to a real zone', () => {
    expect(resolveTimeZone('system')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    )
    expect(resolveTimeZone(null)).toBeTruthy()
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
