// Pure alarm domain: the five-minute slot grid, wall-clock resolution, firing
// state. No DOM and no `Date.now()` — `now` is always injected, which is what
// makes the midnight-rollover and DST rules testable rather than hopeful.
//
// A `SolarDay` is needed only to *position* the marker on the column. Deciding
// when the alarm fires needs no solar data at all.

import { addDays, isPresent, toLocalDate, type EventKind, type LocalDate, type SolarDay } from './solar'

export type Alarm = {
  /** Wall-clock minutes from local midnight. Always a multiple of STEP_MIN. */
  readonly minuteOfDay: number
  readonly enabled: boolean
}

/** One position on the drag grid. */
export type Slot = {
  readonly minuteOfDay: number
  /** Position in the column, 0..1. */
  readonly fraction: number
}

export type FiringState = 'pending' | 'due' | 'missed'

/** The relation of an instant to the solar event nearest it. Display only, never stored. */
export type Relation = { readonly kind: EventKind; readonly deltaMs: number }

/**
 * Five minutes is the granularity people think in for alarms. On a ~700px column
 * that is ~2.4px per slot, which only works because the line snaps as you drag and
 * the readout names the time — the gesture is hunt-and-settle, not a blind tap.
 * Ten minutes is a one-constant change if five proves fiddly in the hand.
 */
export const STEP_MIN = 5

const MS_PER_MIN = 60_000
const MINUTES_PER_DAY = 1440

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The validity rule for a stored alarm, shared with the persistence guard. */
export const isOnGrid = (minuteOfDay: number): boolean =>
  Number.isInteger(minuteOfDay) &&
  minuteOfDay >= 0 &&
  minuteOfDay < MINUTES_PER_DAY &&
  minuteOfDay % STEP_MIN === 0

/**
 * The grid for a day, built by stepping epoch time from `day.start` and reading
 * the local clock — exactly as `hourMarks` does (`src/layout.ts`). A 23h day
 * therefore has 276 slots and a 25h day 300, the marker stays glued to the hour
 * ticks on both, and the spring-forward gap simply has no slot. Computing
 * `height / 288` instead would walk the marker off the ticks twice a year.
 */
export const slots = (day: SolarDay, stepMin: number = STEP_MIN): readonly Slot[] => {
  const stepMs = stepMin * MS_PER_MIN
  const startMs = day.start.getTime()
  const endMs = day.end.getTime()
  const out: Slot[] = []
  for (let t = startMs; t < endMs; t += stepMs) {
    const local = new Date(t)
    out.push({
      minuteOfDay: local.getHours() * 60 + local.getMinutes(),
      fraction: (t - startMs) / day.lengthMs,
    })
  }
  return out
}

/** Column position -> the slot under it. The snap. Ties go to the earlier slot. */
export const slotAt = (day: SolarDay, fraction: number, stepMin: number = STEP_MIN): Slot => {
  const grid = slots(day, stepMin)
  let best = grid[0]
  if (best === undefined) throw new RangeError('slotAt: empty grid')
  let bestGap = Math.abs(best.fraction - fraction)
  for (const slot of grid) {
    const gap = Math.abs(slot.fraction - fraction)
    if (gap < bestGap) {
      bestGap = gap
      best = slot
    }
  }
  return best
}

/**
 * The alarm's instant on a calendar date, resolved as wall-clock time.
 *
 * On a spring-forward day 02:00-02:59 does not exist, and this constructor rolls
 * such a time forward to 03:30. **That is the decision:** a stored 02:30 alarm
 * fires an hour late rather than not at all. On a fall-back day 01:30 happens
 * twice and this picks the first occurrence. One day a year each; no mechanism.
 */
export const alarmTimeOn = (alarm: Alarm, date: LocalDate): Date =>
  new Date(date.y, date.m - 1, date.d, Math.floor(alarm.minuteOfDay / 60), alarm.minuteOfDay % 60, 0, 0)

/**
 * Where an alarm sits on a given day's column, 0..1. For drawing the marker at
 * rest. Resolving the instant rather than looking up a slot is what keeps this
 * correct inside the spring-forward gap, where the alarm has no slot of its own.
 */
export const fractionOf = (alarm: Alarm, day: SolarDay): number =>
  clamp01((alarmTimeOn(alarm, toLocalDate(day.start)).getTime() - day.start.getTime()) / day.lengthMs)

/** The next occurrence strictly after `now`: today's if still ahead, else tomorrow's. */
export const nextAlarm = (alarm: Alarm, now: Date): Date => {
  const today = toLocalDate(now)
  const candidate = alarmTimeOn(alarm, today)
  if (candidate.getTime() > now.getTime()) return candidate
  return alarmTimeOn(alarm, addDays(today, 1))
}

/**
 * 'due' inside the grace window, 'missed' past it. The grace window exists
 * because the page can freeze: a backgrounded tab that resumes ninety seconds
 * late should still ring, and one that resumes four hours late should say so.
 */
export const firingState = (target: Date, now: Date, graceMs: number): FiringState => {
  const delta = now.getTime() - target.getTime()
  return delta < 0 ? 'pending' : delta < graceMs ? 'due' : 'missed'
}

/**
 * How loud the alarm should be `elapsedS` into ringing, as a Web Audio gain.
 *
 * Two minutes from the edge of hearing to full scale. The interpolation is
 * geometric rather than linear because hearing is: equal *ratios* of amplitude
 * sound like equal steps, so a linear ramp would spend three quarters of its
 * perceived rise in the first ten seconds and then creep — the startle this is
 * built to avoid. Geometric spends the same number of decibels every second.
 *
 * The ceiling is 1 because 1 is full scale for the output. The web cannot reach
 * the device volume: there is no API for it, and the media slider, the ringer
 * switch and Do Not Disturb all sit above this code.
 */
export const SWELL_S = 120
const MIN_GAIN = 0.002
const MAX_GAIN = 1

export const swellGain = (elapsedS: number): number => {
  const t = clamp01(elapsedS / SWELL_S)
  return MIN_GAIN * (MAX_GAIN / MIN_GAIN) ** t
}

/**
 * The solar event nearest an instant. Positive `deltaMs` means the event is still
 * ahead, so the alarm is *before* it. This is what turns "eyeball it against the
 * bands" into a confirmable action while the thumb is down.
 */
export const nearestEvent = (day: SolarDay, at: Date): Relation | null => {
  let best: Relation | null = null
  for (const e of day.events) {
    if (!isPresent(e)) continue
    const deltaMs = e.at.getTime() - at.getTime()
    if (best === null || Math.abs(deltaMs) < Math.abs(best.deltaMs)) best = { kind: e.kind, deltaMs }
  }
  return best
}
