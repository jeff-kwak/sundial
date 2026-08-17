// Pure layout. Turns a SolarDay plus a pixel height into everything the renderer
// needs. No DOM here either, so all the geometry rules are unit-testable.

import { isPresent, LEVEL_AFTER, type AbsentReason, type EventKind, type Level, type SolarDay } from './solar'

/** A stretch of the column at one light level. Fractions of the window, 0..1. */
export type Band = { readonly from: number; readonly to: number; readonly level: Level }

/** A CSS gradient colour stop. `at` is a fraction of the window, 0..1. */
export type GradientStop = { readonly level: Level; readonly at: number }

export type PlacedLabel = {
  readonly kind: EventKind
  readonly at: Date
  /** Where the event actually is. The tick goes here and never moves. */
  readonly truePx: number
  /** Centre of the label box, displaced only as far as collision requires. */
  readonly labelPx: number
  /**
   * The band the *label* landed on, which is what its text has to be legible
   * against. Not necessarily the band the event is in — a displaced label can sit
   * over a different level entirely.
   */
  readonly levelUnder: Level
  /** The band at the true position, for the tick. */
  readonly levelAtTrue: Level
}

/** A quiet 6-hourly scale mark, so the proportional column reads as 24 hours. */
export type HourMark = { readonly at: number; readonly hour: number }

export type Absence = { readonly kind: EventKind; readonly absent: AbsentReason }

export type Painting = {
  readonly bands: readonly Band[]
  readonly stops: readonly GradientStop[]
  readonly labels: readonly PlacedLabel[]
  readonly hours: readonly HourMark[]
  readonly absences: readonly Absence[]
}

/** Half-width of the colour blend either side of a boundary, as a fraction of the column. */
const DEFAULT_BLEND = 0.004

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/**
 * Contiguous light-level bands across the window. Derived from whichever events
 * are present plus the level at the window's start, so it is correct when events
 * are missing (midnight sun, polar night) and when they are out of canonical
 * order (a local day that begins mid-twilight).
 */
export const bandsOf = (day: SolarDay): Band[] => {
  const present = day.events.filter(isPresent).slice().sort((a, b) => a.fraction - b.fraction)
  const bands: Band[] = []
  let level = day.levelAtStart
  let from = 0

  for (const e of present) {
    const at = clamp(e.fraction, 0, 1)
    if (at > from) bands.push({ from, to: at, level })
    level = LEVEL_AFTER[e.kind]
    from = at
  }
  bands.push({ from, to: 1, level })
  return bands
}

/**
 * Colour stops for a single `linear-gradient`. Each boundary gets a narrow blend
 * centred exactly on the event time, so the transition looks continuous while the
 * midpoint of the transition remains the true time. The blend narrows rather than
 * overlapping when two boundaries are close, which is the normal case at dawn.
 */
export const gradientStops = (bands: readonly Band[], blend: number = DEFAULT_BLEND): GradientStop[] => {
  const first = bands[0]
  if (first === undefined) return []
  const stops: GradientStop[] = [{ level: first.level, at: 0 }]

  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]!
    const next = bands[i]!
    const b = Math.min(blend, (prev.to - prev.from) / 2, (next.to - next.from) / 2)
    stops.push({ level: prev.level, at: clamp(next.from - b, 0, 1) })
    stops.push({ level: next.level, at: clamp(next.from + b, 0, 1) })
  }

  stops.push({ level: bands[bands.length - 1]!.level, at: 1 })
  return stops
}

/**
 * Resolve label collisions.
 *
 * BMNT and civil dawn sit 30-45 minutes apart, which is about 2% of a 24 hour
 * column — they collide every single day at both ends. The rule: the gradient
 * stays proportional and only labels move. Colliding labels are spread to exactly
 * `slotPx` apart, centred on their own mean position, so the displacement is
 * symmetric and as small as the collision requires. Ticks stay at `truePx`.
 */
export const resolveLabels = <T extends { truePx: number }>(
  items: readonly T[],
  heightPx: number,
  slotPx: number,
): (T & { labelPx: number })[] => {
  const sorted = items.slice().sort((a, b) => a.truePx - b.truePx)
  const lo = slotPx / 2
  const hi = Math.max(lo, heightPx - slotPx / 2)

  // Labels are placed as groups of evenly-spaced members. A group sits centred on
  // the mean of its members' true positions, so displacement is symmetric and as
  // small as the collision requires.
  //
  // Sweep forward; whenever a new group overlaps the previous one, merge the two
  // and re-centre the result, repeating backwards until there is no overlap. Every
  // merge strictly reduces the number of groups, so this terminates — unlike a
  // fixed-point loop over mutated positions, which oscillates when group
  // membership changes between passes and needs an iteration cap to bail out.
  type Group = { count: number; sum: number; start: number }
  const groups: Group[] = []

  const centre = (g: Group): void => {
    const spread = (g.count - 1) * slotPx
    g.start = clamp(g.sum / g.count - spread / 2, lo, Math.max(lo, hi - spread))
  }

  for (const item of sorted) {
    const group: Group = { count: 1, sum: item.truePx, start: 0 }
    centre(group)

    for (;;) {
      const prev = groups[groups.length - 1]
      if (prev === undefined) break
      const prevEnd = prev.start + (prev.count - 1) * slotPx
      if (group.start - prevEnd >= slotPx) break
      groups.pop()
      group.count += prev.count
      group.sum += prev.sum
      centre(group)
    }
    groups.push(group)
  }

  const placed: (T & { labelPx: number })[] = []
  let index = 0
  for (const group of groups) {
    for (let k = 0; k < group.count; k++) {
      placed.push({ ...sorted[index]!, labelPx: group.start + k * slotPx })
      index++
    }
  }
  return placed
}

/** The light level at a point in the column. */
export const levelAt = (bands: readonly Band[], fraction: number): Level => {
  for (const band of bands) if (fraction >= band.from && fraction < band.to) return band.level
  return bands[bands.length - 1]?.level ?? 'night'
}

/**
 * The level covering most of a span.
 *
 * A point sample is not enough for a label. The civil band is often only ~30
 * minutes — around 2% of the column, well under one label's height — so a label
 * routinely straddles three bands, and sampling its centre can pick a level that
 * covers a sliver of the text while the rest sits on something else entirely.
 */
export const levelOver = (bands: readonly Band[], from: number, to: number): Level => {
  if (!(to > from)) return levelAt(bands, from)

  const coverage = new Map<Level, number>()
  for (const band of bands) {
    const overlap = Math.min(to, band.to) - Math.max(from, band.from)
    if (overlap > 0) coverage.set(band.level, (coverage.get(band.level) ?? 0) + overlap)
  }

  let best: Level = levelAt(bands, (from + to) / 2)
  let most = 0
  for (const [level, amount] of coverage) {
    if (amount > most) {
      most = amount
      best = level
    }
  }
  return best
}

/**
 * Local clock hours as fractions of the window. On a DST day these are not evenly
 * spaced, which is honest: the column really is 23 or 25 hours long. Stepping in
 * real time and reading the local hour also avoids the trap that 02:00 does not
 * exist on a spring-forward day.
 */
export const hourMarks = (day: SolarDay, every = 6): HourMark[] => {
  const marks: HourMark[] = []
  for (let t = day.start.getTime(); t < day.end.getTime(); t += 3_600_000) {
    const local = new Date(t)
    if (local.getHours() % every === 0) {
      marks.push({ at: (t - day.start.getTime()) / day.lengthMs, hour: local.getHours() })
    }
  }
  return marks
}

export const layoutDay = (day: SolarDay, heightPx: number, slotPx: number, blend?: number): Painting => {
  const bands = bandsOf(day)
  const present = day.events.filter(isPresent)

  const labels = resolveLabels(
    present.map((e) => ({ kind: e.kind, at: e.at, truePx: e.fraction * heightPx })),
    heightPx,
    slotPx,
  ).map((l) => ({
    ...l,
    // Sampled across the label's whole height, not at its centre.
    levelUnder:
      heightPx === 0
        ? 'night'
        : levelOver(bands, (l.labelPx - slotPx / 2) / heightPx, (l.labelPx + slotPx / 2) / heightPx),
    levelAtTrue: levelAt(bands, heightPx === 0 ? 0 : l.truePx / heightPx),
  }))

  // A scale mark crowding a time is noise, so drop it. The top-of-column mark is
  // dropped too: it sits under the chrome edge and says nothing.
  const crowded = (at: number): boolean =>
    at < 0.02 || labels.some((l) => Math.abs(at * heightPx - l.truePx) < slotPx * 0.7)

  return {
    bands,
    stops: gradientStops(bands, blend),
    labels,
    hours: hourMarks(day, 3).filter((m) => !crowded(m.at)),
    absences: day.events.flatMap((e) => (isPresent(e) ? [] : [{ kind: e.kind, absent: e.absent }])),
  }
}
