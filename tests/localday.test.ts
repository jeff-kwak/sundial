// Runs with TZ=America/Chicago (see vitest.config.ts) so local-day handling is
// actually exercised rather than passing by accident because everything was UTC.

import { describe, expect, it } from 'vitest'
import { addDays, localMidnight, sameLocalDate, solarDay, toLocalDate } from '../src/solar'

const MINNEAPOLIS = { lat: 44.98, lon: -93.27 }
const HOUR = 3_600_000

describe('the local day window', () => {
  it('starts at local midnight, not UTC midnight', () => {
    const start = localMidnight({ y: 2026, m: 8, d: 17 })
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
  })

  it('is 24 hours on an ordinary day', () => {
    expect(solarDay({ y: 2026, m: 8, d: 17 }, MINNEAPOLIS).lengthMs).toBe(24 * HOUR)
  })

  // The reason the column scales to the window rather than a hardcoded 1440
  // minutes: two days a year are not 24 hours long.
  it('is 23 hours when DST starts', () => {
    expect(solarDay({ y: 2026, m: 3, d: 8 }, MINNEAPOLIS).lengthMs).toBe(23 * HOUR)
  })

  it('is 25 hours when DST ends', () => {
    expect(solarDay({ y: 2026, m: 11, d: 1 }, MINNEAPOLIS).lengthMs).toBe(25 * HOUR)
  })

  it('places every event inside the window as a fraction', () => {
    for (const date of [
      { y: 2026, m: 3, d: 8 },
      { y: 2026, m: 11, d: 1 },
      { y: 2026, m: 8, d: 17 },
    ]) {
      const day = solarDay(date, MINNEAPOLIS)
      for (const e of day.events) {
        if ('at' in e) {
          const expected = (e.at.getTime() - day.start.getTime()) / day.lengthMs
          expect(e.fraction).toBeCloseTo(expected, 12)
        }
      }
    }
  })

  it('orders a mid-latitude local day canonically', () => {
    // Within a *local* day at mid-latitude the six events do fall in canonical
    // order. Within a UTC window they do not, which is why layout sorts by
    // fraction instead of trusting this.
    const day = solarDay({ y: 2026, m: 8, d: 17 }, MINNEAPOLIS)
    const fractions = day.events.flatMap((e) => ('at' in e ? [e.fraction] : []))
    expect(fractions).toHaveLength(6)
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions)
  })
})

describe('calendar arithmetic', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 })
    expect(addDays({ y: 2026, m: 3, d: 1 }, -1)).toEqual({ y: 2026, m: 2, d: 28 })
    expect(addDays({ y: 2028, m: 3, d: 1 }, -1)).toEqual({ y: 2028, m: 2, d: 29 })
  })

  it('steps across a DST boundary without drifting', () => {
    // Naive `+86400000` arithmetic lands at 23:00 the previous day here.
    expect(addDays({ y: 2026, m: 3, d: 7 }, 1)).toEqual({ y: 2026, m: 3, d: 8 })
    expect(addDays({ y: 2026, m: 11, d: 1 }, 1)).toEqual({ y: 2026, m: 11, d: 2 })
  })

  it('round-trips through Date', () => {
    const date = { y: 2026, m: 11, d: 1 }
    expect(sameLocalDate(toLocalDate(localMidnight(date)), date)).toBe(true)
  })
})
