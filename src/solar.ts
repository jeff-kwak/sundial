// Pure solar domain. No DOM, no `Date.now()`, no I/O.
//
// Sunrise/sunset use SearchRiseSet, which accounts for atmospheric refraction and
// the sun's semidiameter (upper limb at roughly -0.833 deg). The twilights use
// SearchAltitude at the geometric altitude of the sun's *centre* with no
// refraction, which is what the -6 and -12 definitions actually mean. Using one
// function for all six would be wrong by minutes.

import {
  Body,
  Equator,
  Horizon,
  Observer,
  SearchAltitude,
  SearchHourAngle,
  SearchRiseSet,
} from 'astronomy-engine'

export type Coords = { readonly lat: number; readonly lon: number }

/** A calendar date with no time and no zone. `m` is 1-12. */
export type LocalDate = { readonly y: number; readonly m: number; readonly d: number }

export type EventKind = 'bmnt' | 'civilDawn' | 'sunrise' | 'sunset' | 'civilDusk' | 'eent'

export type Level = 'night' | 'nautical' | 'civil' | 'day'

/**
 * Why an event has no time. An event that does not occur is a first-class value,
 * never `null` and never `NaN` — this is the most important type in the app,
 * because every polar and high-latitude case is an absence rather than a number.
 */
export type AbsentReason = 'always-above' | 'always-below'

export type SolarEvent =
  | { readonly kind: EventKind; readonly at: Date; readonly fraction: number }
  | { readonly kind: EventKind; readonly absent: AbsentReason }

export type SolarDay = {
  readonly coords: Coords
  /** Start of the window (local midnight for `solarDay`). */
  readonly start: Date
  /** End of the window (the next local midnight — 23h or 25h on DST days). */
  readonly end: Date
  readonly lengthMs: number
  readonly levelAtStart: Level
  /** Canonical order. Sort by `fraction` for chronological order. */
  readonly events: readonly SolarEvent[]
  /** civil dawn -> civil dusk, in ms. Saturates to 0 or the whole window. */
  readonly usableLightMs: number
  /** BMNT -> EENT, in ms. Saturates to 0 or the whole window. */
  readonly someLightMs: number
}

export const EVENT_ORDER = ['bmnt', 'civilDawn', 'sunrise', 'sunset', 'civilDusk', 'eent'] as const

/** Geometric altitude of the sun's centre, in degrees. -0.833 encodes refraction + semidiameter. */
const ALTITUDE: Record<EventKind, number> = {
  bmnt: -12,
  civilDawn: -6,
  sunrise: -0.833,
  sunset: -0.833,
  civilDusk: -6,
  eent: -12,
}

/** +1 = the sun is rising through the altitude, -1 = falling through it. */
const DIRECTION: Record<EventKind, 1 | -1> = {
  bmnt: +1,
  civilDawn: +1,
  sunrise: +1,
  sunset: -1,
  civilDusk: -1,
  eent: -1,
}

/** The light level that obtains immediately after each event. */
export const LEVEL_AFTER: Record<EventKind, Level> = {
  bmnt: 'nautical',
  civilDawn: 'civil',
  sunrise: 'day',
  sunset: 'civil',
  civilDusk: 'nautical',
  eent: 'night',
}

const MS_PER_DAY = 86_400_000

export const isPresent = (e: SolarEvent): e is Extract<SolarEvent, { at: Date }> => 'at' in e

export const levelOf = (altitudeDeg: number): Level =>
  altitudeDeg >= ALTITUDE.sunrise ? 'day'
  : altitudeDeg >= ALTITUDE.civilDawn ? 'civil'
  : altitudeDeg >= ALTITUDE.bmnt ? 'nautical'
  : 'night'

/**
 * Geometric altitude of the sun's centre at an instant, in degrees.
 * Refraction is deliberately omitted — the -6 and -12 twilight definitions are
 * geometric — and omitting the argument entirely is how this library asks for that.
 */
export const sunAltitude = (at: Date, coords: Coords): number => {
  const observer = new Observer(coords.lat, coords.lon, 0)
  const eq = Equator(Body.Sun, at, observer, true, true)
  return Horizon(at, observer, eq.ra, eq.dec).altitude
}

/**
 * The core. Finds the six events inside an explicit [start, end) window.
 * Timezone-free and fully deterministic, which is what makes it testable
 * against USNO fixtures without any zone plumbing.
 */
export const solarWindow = (start: Date, end: Date, coords: Coords): SolarDay => {
  const lengthMs = end.getTime() - start.getTime()
  if (!(lengthMs > 0)) throw new RangeError('solarWindow: end must be after start')

  const observer = new Observer(coords.lat, coords.lon, 0)
  const limitDays = lengthMs / MS_PER_DAY

  // Extremes of the sun's altitude across the window, used only to explain an
  // absence. Upper/lower transit bracket the day's altitude range.
  const upper = SearchHourAngle(Body.Sun, observer, 0, start, +1)
  const lower = SearchHourAngle(Body.Sun, observer, 12, start, +1)
  const maxAltitude = sunAltitude(upper.time.date, coords)
  const minAltitude = sunAltitude(lower.time.date, coords)

  const find = (kind: EventKind): SolarEvent => {
    const altitude = ALTITUDE[kind]
    const direction = DIRECTION[kind]
    const found =
      kind === 'sunrise' || kind === 'sunset'
        ? SearchRiseSet(Body.Sun, observer, direction, start, limitDays)
        : SearchAltitude(Body.Sun, observer, direction, start, limitDays, altitude)

    if (found !== null && found.date.getTime() < end.getTime()) {
      return { kind, at: found.date, fraction: (found.date.getTime() - start.getTime()) / lengthMs }
    }
    // No crossing in the window: the sun stayed on one side of the threshold.
    // Comparing against the day's maximum is the reliable discriminator.
    return { kind, absent: altitude > maxAltitude ? 'always-below' : 'always-above' }
  }

  const events = EVENT_ORDER.map(find)
  const by = (kind: EventKind): SolarEvent => events[EVENT_ORDER.indexOf(kind)]!

  return {
    coords,
    start,
    end,
    lengthMs,
    levelAtStart: levelOf(sunAltitude(start, coords)),
    events,
    usableLightMs: span(by('civilDawn'), by('civilDusk'), start, end),
    someLightMs: span(by('bmnt'), by('eent'), start, end),
  }
}

/**
 * Duration between a pair of thresholds, clamped to the window. Either end may
 * be absent — at high latitude a threshold is often crossed once in a local day,
 * or not at all, and the span still has a truthful answer.
 */
const span = (from: SolarEvent, to: SolarEvent, start: Date, end: Date): number => {
  const whole = end.getTime() - start.getTime()
  if (isPresent(from) && isPresent(to)) return Math.max(0, to.at.getTime() - from.at.getTime())
  if (isPresent(from)) return 'absent' in to && to.absent === 'always-above' ? end.getTime() - from.at.getTime() : 0
  if (isPresent(to)) return 'absent' in from && from.absent === 'always-above' ? to.at.getTime() - start.getTime() : 0
  return 'absent' in from && from.absent === 'always-above' ? whole : 0
}

/** Local midnight for a calendar date, in the host's current zone. */
export const localMidnight = (date: LocalDate): Date => new Date(date.y, date.m - 1, date.d, 0, 0, 0, 0)

/**
 * The six events for a calendar date at a location, in the host's current zone.
 * The window is midnight to the *next* midnight, so DST days are correctly 23 or
 * 25 hours long and need no special case anywhere downstream.
 */
export const solarDay = (date: LocalDate, coords: Coords): SolarDay =>
  solarWindow(localMidnight(date), localMidnight({ ...date, d: date.d + 1 }), coords)

export const toLocalDate = (d: Date): LocalDate => ({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })

export const addDays = (date: LocalDate, n: number): LocalDate =>
  toLocalDate(new Date(date.y, date.m - 1, date.d + n))

export const sameLocalDate = (a: LocalDate, b: LocalDate): boolean => a.y === b.y && a.m === b.m && a.d === b.d
