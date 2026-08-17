import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { isPresent, solarWindow, type EventKind, type SolarEvent } from '../src/solar'

// Fetched once by `npm run fixtures` and committed. CI never touches the network.
type Fixture = {
  place: string
  lat: number
  lon: number
  date: string
  usno: {
    events: Partial<Record<'civilDawn' | 'sunrise' | 'sunset' | 'civilDusk', string>>
    continuous: ('above-horizon' | 'below-horizon' | 'above-twilight' | 'below-twilight')[]
  }
  crosscheck: { status: string; nauticalDawn?: string; nauticalDusk?: string }
}

const reference: Fixture[] = JSON.parse(
  readFileSync(new URL('./fixtures/reference.json', import.meta.url), 'utf8'),
)

/** UTC days are always 24h, which keeps the fixtures free of any zone. */
const utcWindow = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const start = new Date(Date.UTC(y, m - 1, d))
  return { start, end: new Date(start.getTime() + 86_400_000) }
}

const minutesOf = (d: Date): number =>
  Math.round((d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()) / 60) % 1440

const parseHhmm = (s: string): number => {
  const [h, m] = s.split(':').map(Number) as [number, number]
  return h * 60 + m
}

/** Circular difference, so 23:59 against 00:00 is one minute, not 1439. */
const apart = (a: number, b: number): number => {
  const raw = Math.abs(a - b)
  return Math.min(raw, 1440 - raw)
}

const eventOf = (events: readonly SolarEvent[], kind: EventKind): SolarEvent => {
  const found = events.find((e) => e.kind === kind)
  if (found === undefined) throw new Error(`no event of kind ${kind}`)
  return found
}

const label = (f: Fixture) => `${f.place} ${f.date}`

describe('sunrise, sunset and civil twilight against USNO', () => {
  // USNO's public one-day API is the authority, and it publishes these four to
  // the minute. It does not publish nautical twilight at all.
  for (const f of reference) {
    const entries = Object.entries(f.usno.events) as [EventKind, string][]
    if (entries.length === 0) continue

    it(`${label(f)} matches USNO within a minute`, () => {
      const { start, end } = utcWindow(f.date)
      const day = solarWindow(start, end, { lat: f.lat, lon: f.lon })

      for (const [kind, expected] of entries) {
        const event = eventOf(day.events, kind)
        expect(isPresent(event), `${kind} should have a time`).toBe(true)
        if (!isPresent(event)) continue
        expect(apart(minutesOf(event.at), parseHhmm(expected)), `${kind}`).toBeLessThanOrEqual(1)
      }
    })
  }
})

describe('nautical twilight against an independent implementation', () => {
  // sunrise-sunset.org is a cross-check, not an authority: it is a separate
  // implementation that does publish the -12 threshold. Its own sunrise differs
  // from USNO's by up to a minute, so the tolerance here is looser by design.
  //
  // Above 60 degrees it is looser still, for a measured reason. At McMurdo
  // (-77.85) on 2026-09-22 the sun crosses -12 at 0.0125 deg/minute, so a
  // 12-minute disagreement is 0.15 deg of altitude — at mid-latitude the same
  // error would be seconds. USNO settles who is wrong: for that day USNO gives
  // sunset 06:57 and civil dusk 08:40, the cross-check gives 07:00:05 and
  // 08:37:19 — already 3 minutes adrift from the authority, while this code
  // matches USNO inside a minute. Agreement to the minute is simply not
  // meaningful against this source at high latitude.
  const toleranceFor = (lat: number): number => (Math.abs(lat) > 60 ? 20 : 3)

  for (const f of reference) {
    const pairs: [EventKind, string | undefined][] = [
      ['bmnt', f.crosscheck.nauticalDawn],
      ['eent', f.crosscheck.nauticalDusk],
    ]
    if (f.crosscheck.status !== 'OK') continue

    it(`${label(f)} agrees on nautical twilight`, () => {
      const { start, end } = utcWindow(f.date)
      const day = solarWindow(start, end, { lat: f.lat, lon: f.lon })

      for (const [kind, iso] of pairs) {
        if (iso === undefined) continue
        const expected = new Date(iso)
        // The reference reports the twilight bracketing *its* solar day, which can
        // fall outside this UTC window. Only compare when it is in scope.
        if (expected < start || expected >= end) continue

        const event = eventOf(day.events, kind)
        expect(isPresent(event), `${kind} should have a time`).toBe(true)
        if (!isPresent(event)) continue
        expect(apart(minutesOf(event.at), minutesOf(expected)), `${kind}`).toBeLessThanOrEqual(
          toleranceFor(f.lat),
        )
      }
    })
  }
})

describe('absences match what USNO reports', () => {
  // USNO answers polar days with "Object continuously above the Horizon" rather
  // than a time, which is the same model the app uses. These are the cases that
  // silently produce NaN in naive implementations.
  const EXPECTED: Record<Fixture['usno']['continuous'][number], { kinds: EventKind[]; absent: string }> = {
    'above-horizon': { kinds: ['sunrise', 'sunset'], absent: 'always-above' },
    'below-horizon': { kinds: ['sunrise', 'sunset'], absent: 'always-below' },
    'above-twilight': { kinds: ['civilDawn', 'civilDusk'], absent: 'always-above' },
    'below-twilight': { kinds: ['civilDawn', 'civilDusk'], absent: 'always-below' },
  }

  for (const f of reference) {
    if (f.usno.continuous.length === 0) continue

    it(`${label(f)}: ${f.usno.continuous.join(', ')}`, () => {
      const { start, end } = utcWindow(f.date)
      const day = solarWindow(start, end, { lat: f.lat, lon: f.lon })

      for (const condition of f.usno.continuous) {
        const { kinds, absent } = EXPECTED[condition]
        for (const kind of kinds) {
          const event = eventOf(day.events, kind)
          expect(isPresent(event), `${kind} should be absent`).toBe(false)
          if (isPresent(event)) continue
          expect(event.absent, `${kind}`).toBe(absent)
        }
      }
    })
  }
})

describe('who to trust at high latitude', () => {
  it('matches USNO at McMurdo where the cross-check source does not', () => {
    // Documents the adjudication above rather than leaving it in a comment: at
    // -77.85 the authority and this code agree, and the other implementation is
    // the one that drifts. This is why the nautical tolerance is widened there
    // instead of the algorithm being changed.
    const { start, end } = utcWindow('2026-09-22')
    const day = solarWindow(start, end, { lat: -77.85, lon: 166.67 })

    const sunset = eventOf(day.events, 'sunset')
    expect(isPresent(sunset)).toBe(true)
    if (!isPresent(sunset)) return

    expect(apart(minutesOf(sunset.at), parseHhmm('06:57'))).toBeLessThanOrEqual(1) // USNO
    expect(apart(minutesOf(sunset.at), parseHhmm('07:00'))).toBeGreaterThan(1) // cross-check
  })
})

describe('invariants across every fixture', () => {
  it('never produces an invalid time or an unexplained absence', () => {
    for (const f of reference) {
      const { start, end } = utcWindow(f.date)
      const day = solarWindow(start, end, { lat: f.lat, lon: f.lon })

      expect(day.events).toHaveLength(6)
      for (const e of day.events) {
        if (isPresent(e)) {
          expect(Number.isFinite(e.at.getTime()), `${label(f)} ${e.kind}`).toBe(true)
          expect(e.at.getTime()).toBeGreaterThanOrEqual(start.getTime())
          expect(e.at.getTime()).toBeLessThan(end.getTime())
          expect(e.fraction).toBeGreaterThanOrEqual(0)
          expect(e.fraction).toBeLessThan(1)
        } else {
          expect(['always-above', 'always-below']).toContain(e.absent)
        }
      }

      // Durations stay inside the window even when both ends are absent.
      for (const ms of [day.usableLightMs, day.someLightMs]) {
        expect(ms).toBeGreaterThanOrEqual(0)
        expect(ms).toBeLessThanOrEqual(day.lengthMs)
      }
      // You cannot have more usable light than you have any light at all.
      expect(day.usableLightMs).toBeLessThanOrEqual(day.someLightMs)
    }
  })

  it('saturates durations at the poles', () => {
    const midnightSun = utcWindow('2026-06-21')
    const tromso = solarWindow(midnightSun.start, midnightSun.end, { lat: 69.65, lon: 18.96 })
    expect(tromso.usableLightMs).toBe(tromso.lengthMs)
    expect(tromso.someLightMs).toBe(tromso.lengthMs)

    const polarNight = utcWindow('2026-06-21')
    const mcmurdo = solarWindow(polarNight.start, polarNight.end, { lat: -77.85, lon: 166.67 })
    expect(mcmurdo.usableLightMs).toBe(0)
  })
})
