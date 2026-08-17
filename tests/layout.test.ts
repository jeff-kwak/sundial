import { describe, expect, it } from 'vitest'
import { bandsOf, gradientStops, resolveLabels } from '../src/layout'
import { solarDay, solarWindow, type SolarDay } from '../src/solar'

const MINNEAPOLIS = { lat: 44.98, lon: -93.27 }
const TROMSO = { lat: 69.65, lon: 18.96 }

const utcWindow = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const start = new Date(Date.UTC(y, m - 1, d))
  return solarWindow(start, new Date(start.getTime() + 86_400_000), TROMSO)
}

describe('bands', () => {
  const contiguous = (day: SolarDay) => {
    const bands = bandsOf(day)
    expect(bands[0]!.from).toBe(0)
    expect(bands[bands.length - 1]!.to).toBe(1)
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.from).toBe(bands[i - 1]!.to)
    for (const b of bands) expect(b.to).toBeGreaterThan(b.from)
    return bands
  }

  it('covers the whole column with no gaps or overlaps', () => {
    contiguous(solarDay({ y: 2026, m: 8, d: 17 }, MINNEAPOLIS))
  })

  it('is a single day band under the midnight sun', () => {
    const bands = contiguous(utcWindow('2026-06-21'))
    expect(bands).toEqual([{ from: 0, to: 1, level: 'day' }])
  })

  it('handles a polar night where only civil twilight occurs', () => {
    // Tromso in December: the sun never rises, but civil twilight does happen.
    const bands = contiguous(utcWindow('2026-12-21'))
    expect(bands.map((b) => b.level)).toContain('civil')
    expect(bands.map((b) => b.level)).not.toContain('day')
  })

  it('is correct when a window begins mid-day and sunset precedes sunrise', () => {
    // A UTC window over Minneapolis starts at 19:00 local: day, down through the
    // evening, then back up in the morning. Canonical order is not chronological.
    const start = new Date(Date.UTC(2026, 7, 17))
    const day = solarWindow(start, new Date(start.getTime() + 86_400_000), MINNEAPOLIS)
    const bands = contiguous(day)
    expect(bands[0]!.level).toBe('day')
    expect(bands[bands.length - 1]!.level).toBe('day')
    expect(bands.map((b) => b.level)).toContain('night')
  })
})

describe('gradient stops', () => {
  it('runs from 0 to 1 and never goes backwards', () => {
    const stops = gradientStops(bandsOf(solarDay({ y: 2026, m: 8, d: 17 }, MINNEAPOLIS)))
    expect(stops[0]!.at).toBe(0)
    expect(stops[stops.length - 1]!.at).toBe(1)
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.at).toBeGreaterThanOrEqual(stops[i - 1]!.at)
  })

  it('centres each transition on the true boundary', () => {
    const bands = [
      { from: 0, to: 0.5, level: 'night' as const },
      { from: 0.5, to: 1, level: 'day' as const },
    ]
    const stops = gradientStops(bands, 0.01)
    expect(stops.map((s) => s.at)).toEqual([0, 0.49, 0.51, 1])
    // Midpoint of the blend is the event time.
    expect((stops[1]!.at + stops[2]!.at) / 2).toBeCloseTo(0.5, 12)
  })

  it('narrows the blend rather than overlapping when boundaries are close', () => {
    const bands = [
      { from: 0, to: 0.2, level: 'night' as const },
      { from: 0.2, to: 0.202, level: 'nautical' as const },
      { from: 0.202, to: 1, level: 'civil' as const },
    ]
    const stops = gradientStops(bands, 0.01)
    for (let i = 1; i < stops.length; i++) expect(stops[i]!.at).toBeGreaterThanOrEqual(stops[i - 1]!.at)
  })
})

describe('label collision', () => {
  const SLOT = 46
  const HEIGHT = 600

  const noOverlap = (boxes: readonly { labelPx: number }[]) => {
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.labelPx - boxes[i - 1]!.labelPx).toBeGreaterThanOrEqual(SLOT - 1e-9)
    }
  }

  it('leaves well-separated labels exactly where they are', () => {
    const items = [{ truePx: 100 }, { truePx: 300 }, { truePx: 500 }]
    const boxes = resolveLabels(items, HEIGHT, SLOT)
    expect(boxes.map((b) => b.labelPx)).toEqual([100, 300, 500])
  })

  it('spreads a colliding pair symmetrically about its own midpoint', () => {
    // BMNT and civil dawn, ~40 minutes apart on a 24h column: the everyday case.
    const boxes = resolveLabels([{ truePx: 290 }, { truePx: 310 }], HEIGHT, SLOT)
    noOverlap(boxes)
    const midpoint = (boxes[0]!.labelPx + boxes[1]!.labelPx) / 2
    expect(midpoint).toBeCloseTo(300, 9)
  })

  it('never moves the tick, only the label', () => {
    const items = [{ truePx: 295 }, { truePx: 300 }, { truePx: 305 }]
    const boxes = resolveLabels(items, HEIGHT, SLOT)
    expect(boxes.map((b) => b.truePx)).toEqual([295, 300, 305])
    noOverlap(boxes)
  })

  it('keeps labels on screen when a cluster sits at the top edge', () => {
    const boxes = resolveLabels([{ truePx: 0 }, { truePx: 4 }, { truePx: 8 }], HEIGHT, SLOT)
    noOverlap(boxes)
    for (const b of boxes) {
      expect(b.labelPx).toBeGreaterThanOrEqual(SLOT / 2)
      expect(b.labelPx).toBeLessThanOrEqual(HEIGHT - SLOT / 2)
    }
  })

  it('keeps labels on screen when a cluster sits at the bottom edge', () => {
    const boxes = resolveLabels([{ truePx: 596 }, { truePx: 599 }], HEIGHT, SLOT)
    noOverlap(boxes)
    for (const b of boxes) expect(b.labelPx).toBeLessThanOrEqual(HEIGHT - SLOT / 2)
  })

  it('resolves all six on a short winter column', () => {
    // A cramped viewport with a late dawn and early dusk: two tight clusters.
    const items = [140, 160, 185, 420, 445, 465].map((truePx) => ({ truePx }))
    const boxes = resolveLabels(items, 520, SLOT)
    noOverlap(boxes)
    expect(boxes).toHaveLength(6)
  })

  it('resolves the real winter geometry that a naive spreader leaves overlapping', () => {
    // Measured from the running app: Minneapolis, 21 Dec 2026, 716px column.
    // The first implementation returned centre gaps of [17, 46, 219, 46, 46] —
    // it detected clusters from already-moved positions while re-centring on the
    // original means, so membership changed between passes and it oscillated
    // until the iteration cap bailed out mid-spread.
    const items = [227.2, 245.6, 262.5, 524.1, 541.0, 559.4].map((truePx) => ({ truePx }))
    const boxes = resolveLabels(items, 716, SLOT)
    noOverlap(boxes)
    expect(boxes.map((b) => Math.round(b.labelPx))).toEqual([199, 245, 291, 496, 542, 588])
  })

  it('converges rather than relying on an iteration cap', () => {
    // A pile-up big enough that groups must merge repeatedly. A capped fixed-point
    // loop returns overlapping labels here; a terminating one cannot.
    const items = Array.from({ length: 12 }, (_, i) => ({ truePx: 300 + i * 3 }))
    const boxes = resolveLabels(items, 900, SLOT)
    noOverlap(boxes)
    // Re-running on the resolved output must be a no-op.
    const again = resolveLabels(
      boxes.map((b) => ({ truePx: b.labelPx })),
      900,
      SLOT,
    )
    expect(again.map((b) => b.labelPx)).toEqual(boxes.map((b) => b.labelPx))
  })

  it('preserves chronological order no matter the input order', () => {
    const items = [{ truePx: 500 }, { truePx: 100 }, { truePx: 300 }]
    const boxes = resolveLabels(items, HEIGHT, SLOT)
    expect(boxes.map((b) => b.truePx)).toEqual([100, 300, 500])
  })
})
