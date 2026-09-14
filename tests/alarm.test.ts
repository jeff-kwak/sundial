import { describe, expect, it } from 'vitest'
import {
  alarmTimeOn,
  firingState,
  fractionOf,
  nearestEvent,
  nextAlarm,
  slotAt,
  slots,
  STEP_MIN,
  type Alarm,
} from '../src/alarm'
import { solarDay } from '../src/solar'

const MINNEAPOLIS = { lat: 44.98, lon: -93.27 }

// The suite runs in America/Chicago (vitest.config.ts), where 2026 springs
// forward on 8 March and falls back on 1 November.
const ORDINARY = { y: 2026, m: 8, d: 17 }
const SPRING_FORWARD = { y: 2026, m: 3, d: 8 }
const FALL_BACK = { y: 2026, m: 11, d: 1 }

const day = (d: typeof ORDINARY) => solarDay(d, MINNEAPOLIS)
const at = (minuteOfDay: number): Alarm => ({ minuteOfDay, enabled: true })

describe('slots', () => {
  it('covers an ordinary day in 288 five-minute steps', () => {
    const grid = slots(day(ORDINARY))
    expect(grid).toHaveLength(288)
    expect(grid[0]).toEqual({ minuteOfDay: 0, fraction: 0 })
    expect(grid[287]!.minuteOfDay).toBe(23 * 60 + 55)
  })

  it('has 276 slots on a spring-forward day, none of them in the 02:00 hour', () => {
    const grid = slots(day(SPRING_FORWARD))
    expect(grid).toHaveLength(276)
    expect(grid.filter((s) => s.minuteOfDay >= 120 && s.minuteOfDay < 180)).toEqual([])
    // The clock jumps straight from 01:55 to 03:00.
    const index = grid.findIndex((s) => s.minuteOfDay === 115)
    expect(grid[index + 1]!.minuteOfDay).toBe(180)
  })

  it('has 300 slots on a fall-back day, with 01:30 appearing twice', () => {
    const grid = slots(day(FALL_BACK))
    expect(grid).toHaveLength(300)
    expect(grid.filter((s) => s.minuteOfDay === 90)).toHaveLength(2)
  })

  it('is evenly spaced in real time, not in wall-clock minutes', () => {
    // The spacing that matters is the pixel one: every slot is the same distance
    // down the column, on all three kinds of day.
    for (const date of [ORDINARY, SPRING_FORWARD, FALL_BACK]) {
      const grid = slots(day(date))
      const step = grid[1]!.fraction - grid[0]!.fraction
      for (let i = 1; i < grid.length; i++) {
        expect(grid[i]!.fraction - grid[i - 1]!.fraction).toBeCloseTo(step, 12)
      }
    }
  })

  it('honours a different step', () => {
    expect(slots(day(ORDINARY), 10)).toHaveLength(144)
  })
})

describe('slotAt', () => {
  it('snaps every slot back to itself', () => {
    for (const date of [ORDINARY, SPRING_FORWARD, FALL_BACK]) {
      const d = day(date)
      for (const slot of slots(d)) expect(slotAt(d, slot.fraction)).toEqual(slot)
    }
  })

  it('takes a position between two slots to the nearer one', () => {
    const d = day(ORDINARY)
    const grid = slots(d)
    const [a, b] = [grid[100]!, grid[101]!]
    expect(slotAt(d, a.fraction + (b.fraction - a.fraction) * 0.4)).toEqual(a)
    expect(slotAt(d, a.fraction + (b.fraction - a.fraction) * 0.6)).toEqual(b)
  })

  it('clamps beyond either end of the column', () => {
    const d = day(ORDINARY)
    const grid = slots(d)
    expect(slotAt(d, -3)).toEqual(grid[0])
    expect(slotAt(d, 4)).toEqual(grid[grid.length - 1])
  })
})

describe('fractionOf', () => {
  it('round-trips with slotAt on every kind of day', () => {
    for (const date of [ORDINARY, SPRING_FORWARD, FALL_BACK]) {
      const d = day(date)
      // On a fall-back day 01:30 has two slots and a stored alarm resolves to the
      // first, so the round-trip is asserted against the first slot of each minute.
      const first = new Map<number, number>()
      for (const slot of slots(d)) if (!first.has(slot.minuteOfDay)) first.set(slot.minuteOfDay, slot.fraction)
      for (const [minuteOfDay, fraction] of first) {
        expect(fractionOf(at(minuteOfDay), d)).toBeCloseTo(slotAt(d, fraction).fraction, 12)
      }
    }
  })

  it('takes the earlier of the two 01:30s on a fall-back day', () => {
    const d = day(FALL_BACK)
    const [early, late] = slots(d).filter((s) => s.minuteOfDay === 90)
    expect(fractionOf(at(90), d)).toBeCloseTo(early!.fraction, 12)
    expect(fractionOf(at(90), d)).not.toBeCloseTo(late!.fraction, 6)
  })

  it('puts midday near the middle of an ordinary column', () => {
    expect(fractionOf(at(12 * 60), day(ORDINARY))).toBeCloseTo(0.5, 6)
  })

  it('stays inside the column for an alarm in the spring-forward gap', () => {
    // 02:30 does not exist that day; it resolves to 03:30 and lands there.
    const d = day(SPRING_FORWARD)
    expect(fractionOf(at(150), d)).toBeCloseTo(fractionOf(at(210), d), 12)
  })
})

describe('alarmTimeOn', () => {
  it('resolves an ordinary wall-clock time', () => {
    const t = alarmTimeOn(at(6 * 60 + 30), ORDINARY)
    expect([t.getHours(), t.getMinutes()]).toEqual([6, 30])
  })

  it('rolls a spring-forward 02:30 alarm to 03:30 rather than dropping it', () => {
    const t = alarmTimeOn(at(2 * 60 + 30), SPRING_FORWARD)
    expect([t.getHours(), t.getMinutes()]).toEqual([3, 30])
    expect(t.getDate()).toBe(8)
  })

  it('takes the first of the two 01:30s on a fall-back day', () => {
    const t = alarmTimeOn(at(90), FALL_BACK)
    expect([t.getHours(), t.getMinutes()]).toEqual([1, 30])
    // The first 01:30 is 90 minutes after midnight; the second is 150.
    expect(t.getTime() - new Date(2026, 10, 1).getTime()).toBe(90 * 60_000)
  })
})

describe('nextAlarm', () => {
  it('returns today when the time is still ahead', () => {
    const now = new Date(2026, 7, 17, 5, 0)
    expect(nextAlarm(at(6 * 60 + 30), now)).toEqual(new Date(2026, 7, 17, 6, 30))
  })

  it('rolls to tomorrow when the time has passed', () => {
    const now = new Date(2026, 7, 17, 23, 30)
    expect(nextAlarm(at(6 * 60 + 30), now)).toEqual(new Date(2026, 7, 18, 6, 30))
  })

  it('rolls across a month and a year boundary', () => {
    expect(nextAlarm(at(7 * 60), new Date(2026, 11, 31, 8, 0))).toEqual(new Date(2027, 0, 1, 7, 0))
  })

  it('is strictly after now, so an exact match rolls to tomorrow', () => {
    const now = new Date(2026, 7, 17, 6, 30, 0, 0)
    expect(nextAlarm(at(6 * 60 + 30), now)).toEqual(new Date(2026, 7, 18, 6, 30))
  })

  it('treats a second before the alarm as today', () => {
    const now = new Date(2026, 7, 17, 6, 29, 59, 0)
    expect(nextAlarm(at(6 * 60 + 30), now)).toEqual(new Date(2026, 7, 17, 6, 30))
  })
})

describe('firingState', () => {
  const target = new Date(2026, 7, 17, 6, 30)
  const grace = 5 * 60_000

  it('is pending before the target', () => {
    expect(firingState(target, new Date(target.getTime() - 1), grace)).toBe('pending')
  })

  it('is due at the target and through the grace window', () => {
    expect(firingState(target, target, grace)).toBe('due')
    expect(firingState(target, new Date(target.getTime() + grace - 1), grace)).toBe('due')
  })

  it('is missed once the grace window closes', () => {
    expect(firingState(target, new Date(target.getTime() + grace), grace)).toBe('missed')
    expect(firingState(target, new Date(target.getTime() + 4 * 3_600_000), grace)).toBe('missed')
  })
})

describe('nearestEvent', () => {
  it('reports the gap to the nearest event, signed towards the future', () => {
    const d = day(ORDINARY)
    const sunrise = d.events.find((e) => e.kind === 'sunrise')
    if (sunrise === undefined || !('at' in sunrise)) throw new Error('fixture has no sunrise')

    // Five minutes: civil dawn is ~30 minutes earlier, so sunrise is unambiguously
    // the nearest event on both sides.
    const before = nearestEvent(d, new Date(sunrise.at.getTime() - 5 * 60_000))
    expect(before?.kind).toBe('sunrise')
    expect(before?.deltaMs).toBe(5 * 60_000)

    const after = nearestEvent(d, new Date(sunrise.at.getTime() + 5 * 60_000))
    expect(after?.kind).toBe('sunrise')
    expect(after?.deltaMs).toBe(-5 * 60_000)
  })

  it('is null when a day has no events at all', () => {
    // Midnight sun over Tromso: six absences, nothing to relate to.
    const polar = solarDay({ y: 2026, m: 6, d: 21 }, { lat: 69.65, lon: 18.96 })
    expect(polar.events.every((e) => !('at' in e))).toBe(true)
    expect(nearestEvent(polar, new Date(2026, 5, 21, 6, 0))).toBeNull()
  })
})

describe('STEP_MIN', () => {
  it('divides the day evenly, which every slot count above depends on', () => {
    expect(1440 % STEP_MIN).toBe(0)
  })
})
