// All user-visible copy. Kept out of layout and solar so those stay pure logic.

import type { Relation } from './alarm'
import { formatDuration } from './format'
import type { Absence } from './layout'
import type { EventKind } from './solar'

/**
 * Plain term first, technical term second and quieter. The gradient explains what
 * a threshold means; the text exists so a reading can be cross-checked against a
 * published USNO table.
 */
export const LABEL: Record<EventKind, { plain: string; technical: string }> = {
  bmnt: { plain: 'shapes appear', technical: 'BMNT · nautical' },
  civilDawn: { plain: 'usable light', technical: 'BMCT · civil' },
  sunrise: { plain: 'sunrise', technical: '' },
  sunset: { plain: 'sunset', technical: '' },
  civilDusk: { plain: 'usable light ends', technical: 'EECT · civil' },
  eent: { plain: 'dark', technical: 'EENT · nautical' },
}

const ABSENCE: Record<EventKind, Record<Absence['absent'], string>> = {
  sunrise: { 'always-below': 'sun does not rise', 'always-above': 'sun does not set' },
  sunset: { 'always-below': 'sun does not rise', 'always-above': 'sun does not set' },
  civilDawn: { 'always-below': 'no usable light', 'always-above': 'usable light all night' },
  civilDusk: { 'always-below': 'no usable light', 'always-above': 'usable light all night' },
  bmnt: { 'always-below': 'no nautical twilight', 'always-above': 'never fully dark' },
  eent: { 'always-below': 'no nautical twilight', 'always-above': 'never fully dark' },
}

/**
 * One line per distinct condition. A polar day produces several absences that
 * describe the same fact from two ends, so they are deduplicated.
 */
export const absenceMessages = (absences: readonly Absence[]): string[] => [
  ...new Set(absences.map((a) => ABSENCE[a.kind][a.absent])),
]

/**
 * The drag readout's second half — `28m before sunrise`. Display only: the alarm
 * stores an absolute time, and this is what lets you set one *by eye against the
 * bands* and still confirm what you got.
 */
export const relationText = (relation: Relation): string => {
  const name = LABEL[relation.kind].plain
  // Under half a minute the duration would round to `0m`, which reads as broken.
  if (Math.abs(relation.deltaMs) < 30_000) return `at ${name}`
  return relation.deltaMs > 0
    ? `${formatDuration(relation.deltaMs)} before ${name}`
    : `${formatDuration(-relation.deltaMs)} after ${name}`
}
