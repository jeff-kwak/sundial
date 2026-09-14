import { isOnGrid, type Alarm } from './alarm'
import type { Clock } from './format'
import type { Coords } from './solar'

export type SavedLocation = { readonly id: string; readonly name: string; readonly lat: number; readonly lon: number }

export type Selection = { readonly kind: 'gps' } | { readonly kind: 'saved'; readonly id: string }

export type Prefs = { readonly clock: Clock }

// localStorage is keyed by origin, and path is not part of origin. This app shares
// jeff-kwak.github.io with the owner's bio site and any future project site, so
// every key is namespaced or it will eventually collide with something.
const NS = 'sundial:'

const read = <T>(key: string, fallback: T, guard: (v: unknown) => v is T): T => {
  try {
    const raw = localStorage.getItem(NS + key)
    if (raw === null) return fallback
    const parsed: unknown = JSON.parse(raw)
    return guard(parsed) ? parsed : fallback
  } catch {
    // Private-mode or quota-disabled storage must not take the app down.
    return fallback
  }
}

const write = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
  } catch {
    /* nothing to recover; the app works fine unpersisted */
  }
}

const isLocation = (v: unknown): v is SavedLocation =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as SavedLocation).id === 'string' &&
  typeof (v as SavedLocation).name === 'string' &&
  Number.isFinite((v as SavedLocation).lat) &&
  Number.isFinite((v as SavedLocation).lon)

export const loadLocations = (): SavedLocation[] =>
  read<SavedLocation[]>('locations', [], (v): v is SavedLocation[] => Array.isArray(v) && v.every(isLocation))

export const saveLocations = (locations: readonly SavedLocation[]): void => write('locations', locations)

export const loadPrefs = (): Prefs =>
  read<Prefs>('prefs', { clock: 24 }, (v): v is Prefs => {
    const clock = (v as Prefs | null)?.clock
    return clock === 12 || clock === 24
  })

export const savePrefs = (prefs: Prefs): void => write('prefs', prefs)

export const loadSelection = (): Selection =>
  read<Selection>('selection', { kind: 'gps' }, (v): v is Selection => {
    const s = v as Selection | null
    return s?.kind === 'gps' || (s?.kind === 'saved' && typeof s.id === 'string')
  })

export const saveSelection = (selection: Selection): void => write('selection', selection)

/**
 * The alarm can no longer be *absent* — an absolute wall-clock time always
 * exists — so "no alarm" is an alarm that is switched off, at a plausible hour
 * for the first tap to land on.
 */
const NO_ALARM: Alarm = { minuteOfDay: 7 * 60, enabled: false }

export const loadAlarm = (): Alarm =>
  read<Alarm>('alarm', NO_ALARM, (v): v is Alarm => {
    const a = v as Alarm | null
    // A minute off the grid or out of range would place the marker somewhere the
    // drag can never reach, so it is rejected rather than clamped.
    return typeof a?.enabled === 'boolean' && typeof a.minuteOfDay === 'number' && isOnGrid(a.minuteOfDay)
  })

export const saveAlarm = (alarm: Alarm): void => write('alarm', alarm)

/** Last known GPS fix, so a cold start with no signal still has somewhere to stand. */
export const loadLastFix = (): Coords | null =>
  read<Coords | null>('lastFix', null, (v): v is Coords | null => {
    const c = v as Coords | null
    return c === null || (Number.isFinite(c.lat) && Number.isFinite(c.lon))
  })

export const saveLastFix = (coords: Coords): void => write('lastFix', coords)

export const newId = (): string => `loc-${Math.random().toString(36).slice(2, 10)}`
