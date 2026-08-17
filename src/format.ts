import type { Coords, LocalDate } from './solar'

export type Clock = 12 | 24

/**
 * Times are rounded to the minute. The model's honest precision is about a
 * minute, so seconds would imply accuracy that is not there.
 */
export const formatTime = (d: Date, clock: Clock): string =>
  clock === 24
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(d)

export const formatDuration = (ms: number): string => {
  const total = Math.round(ms / 60_000)
  const h = Math.floor(total / 60)
  const m = total % 60
  return h === 0 ? `${m}m` : `${h}h ${String(m).padStart(2, '0')}m`
}

export const formatDateLabel = (date: LocalDate): string =>
  new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date.y, date.m - 1, date.d))

/** ISO `yyyy-mm-dd`, for `<input type="date">`. Never via toISOString — that shifts the zone. */
export const toDateInputValue = (date: LocalDate): string =>
  `${String(date.y).padStart(4, '0')}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`

export const fromDateInputValue = (value: string): LocalDate | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (m === null) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(y, mo - 1, d)
  // Rejects 31 February and friends, which the pattern alone would let through.
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null
  return { y, m: mo, d }
}

export const formatCoords = ({ lat, lon }: Coords): string =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`
