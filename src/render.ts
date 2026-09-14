// The only module that touches the document. No logic beyond turning a Painting
// into elements — every rule worth testing lives in solar.ts and layout.ts.

import { alarmTimeOn, fractionOf, nearestEvent, type Alarm } from './alarm'
import {
  formatCoords,
  formatDateLabel,
  formatDuration,
  formatMinuteOfDay,
  formatTime,
  toDateInputValue,
  type Clock,
} from './format'
import { bandsOf, layoutDay, levelAt, type Painting } from './layout'
import { absenceMessages, LABEL, relationText } from './messages'
import { toLocalDate, type Coords, type Level, type LocalDate, type SolarDay } from './solar'
import type { SavedLocation, Selection } from './state'

export type View = {
  readonly date: LocalDate
  readonly isToday: boolean
  readonly coords: Coords | null
  readonly locationName: string
  readonly day: SolarDay | null
  readonly clock: Clock
  readonly alarm: Alarm
  /** Shown in place of coordinates while locating, or when there is no fix. */
  readonly status: string | null
}

export type Elements = ReturnType<typeof elements>

const must = <T extends Element>(selector: string): T => {
  const el = document.querySelector<T>(selector)
  if (el === null) throw new Error(`missing element: ${selector}`)
  return el
}

export const elements = () => ({
  prev: must<HTMLButtonElement>('#prev'),
  next: must<HTMLButtonElement>('#next'),
  today: must<HTMLButtonElement>('#today'),
  dateBtn: must<HTMLButtonElement>('#datebtn'),
  dateLabel: must<HTMLElement>('#datelabel'),
  datePicker: must<HTMLInputElement>('#datepicker'),
  locBtn: must<HTMLButtonElement>('#locbtn'),
  alarmBtn: must<HTMLButtonElement>('#alarmbtn'),
  alarmBtnLabel: must<HTMLElement>('#alarmbtnlabel'),
  nightBtn: must<HTMLButtonElement>('#nightbtn'),
  locName: must<HTMLElement>('#locname'),
  locCoords: must<HTMLElement>('#loccoords'),
  day: must<HTMLElement>('#day'),
  hours: must<HTMLElement>('#hours'),
  ticks: must<HTMLElement>('#ticks'),
  labels: must<HTMLElement>('#labels'),
  alarm: must<HTMLElement>('#alarm'),
  alarmGrip: must<HTMLElement>('#alarmgrip'),
  alarmTime: must<HTMLElement>('#alarmtime'),
  alarmRel: must<HTMLElement>('#alarmrel'),
  notes: must<HTMLElement>('#notes'),
  footer: must<HTMLElement>('#footer'),
  sheet: must<HTMLDialogElement>('#locsheet'),
  locOptions: must<HTMLUListElement>('#locoptions'),
  addForm: must<HTMLFormElement>('#addloc'),
  addName: must<HTMLInputElement>('#addname'),
  addLat: must<HTMLInputElement>('#addlat'),
  addLon: must<HTMLInputElement>('#addlon'),
  addError: must<HTMLElement>('#adderror'),
  clock24: must<HTMLButtonElement>('#clock24'),
  clock12: must<HTMLButtonElement>('#clock12'),
  night: must<HTMLElement>('#night'),
  nightClock: must<HTMLElement>('#nightclock'),
  nightTime: must<HTMLElement>('#nighttime'),
  nightSub: must<HTMLElement>('#nightsub'),
  nightExit: must<HTMLButtonElement>('#nightexit'),
  nightHint: must<HTMLElement>('#nighthint'),
})

export const BAND_VAR: Record<Level, string> = {
  night: '--night',
  nautical: '--nautical',
  civil: '--civil',
  day: '--day',
}

/**
 * Whether a band is dark or pale, which decides the ink of anything drawn on it.
 * This holds in both themes — night is dark and day is pale in each — so it is a
 * property of the level, not of the colour scheme.
 */
export const SURFACE: Record<Level, 'dark' | 'light'> = {
  night: 'dark',
  nautical: 'dark',
  civil: 'light',
  day: 'light',
}

const gradient = (painting: Painting): string => {
  const stops = painting.stops.map((s) => `var(${BAND_VAR[s.level]}) ${(s.at * 100).toFixed(3)}%`)
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}

const slotPx = (day: HTMLElement): number => {
  const raw = Number.parseFloat(getComputedStyle(day).getPropertyValue('--slot'))
  return Number.isFinite(raw) && raw > 0 ? raw : 46
}

const replace = (parent: HTMLElement, children: readonly Node[]): void => {
  parent.replaceChildren(...children)
}

/**
 * The alarm marker, drawn on its own so a drag can move it without a full repaint
 * — rebuilding every label node between 5-minute detents would fight the label
 * transitions and make the detents feel mushy.
 */
export const renderAlarm = (v: View, el: Elements, dragging: boolean): void => {
  const { alarm, day } = v

  el.alarmBtnLabel.textContent = alarm.enabled ? formatMinuteOfDay(alarm.minuteOfDay, v.clock) : 'Set alarm'
  el.alarmBtn.setAttribute('aria-pressed', String(alarm.enabled))
  el.alarmBtn.setAttribute(
    'aria-label',
    alarm.enabled ? `Alarm ${formatMinuteOfDay(alarm.minuteOfDay, v.clock)}, on — tap to switch off` : 'Set alarm',
  )

  if (!alarm.enabled || day === null) {
    el.alarm.hidden = true
    return
  }
  el.alarm.hidden = false

  const fraction = fractionOf(alarm, day)
  el.alarm.style.top = `${fraction * el.day.clientHeight}px`
  el.alarm.dataset.surface = SURFACE[levelAt(bandsOf(day), fraction)]

  // The relation to the nearest event is derived here and never stored. It is what
  // turns "half an hour before sunrise" from a guess into a confirmable reading.
  const at = alarmTimeOn(alarm, toLocalDate(day.start))
  const time = formatTime(at, v.clock)
  const relation = nearestEvent(day, at)
  const related = relation === null ? '' : relationText(relation)

  // At rest the marker shows only the time; the relation appears under the thumb,
  // where it is what you are steering by.
  el.alarmTime.textContent = time
  el.alarmRel.textContent = dragging ? related : ''
  el.alarmGrip.setAttribute('aria-valuenow', String(alarm.minuteOfDay))
  el.alarmGrip.setAttribute('aria-valuetext', related === '' ? time : `${time} · ${related}`)
}

export const render = (v: View, el: Elements): void => {
  el.dateLabel.textContent = formatDateLabel(v.date)
  el.datePicker.value = toDateInputValue(v.date)
  el.today.hidden = v.isToday

  el.locName.textContent = v.locationName
  el.locCoords.textContent = v.status ?? (v.coords === null ? '' : formatCoords(v.coords))

  // Before the early return below: renderAlarm handles the dayless case itself.
  renderAlarm(v, el, false)

  if (v.day === null) {
    el.day.style.backgroundImage = 'linear-gradient(to bottom, var(--night), var(--night))'
    replace(el.hours, [])
    replace(el.ticks, [])
    replace(el.labels, [])
    replace(el.notes, [note(v.status ?? 'No location yet')])
    replace(el.footer, [])
    return
  }

  const height = el.day.clientHeight
  const painting = layoutDay(v.day, height, slotPx(el.day))

  el.day.style.backgroundImage = gradient(painting)

  const ticks: Node[] = []
  const labels: Node[] = []
  const hours: Node[] = []

  for (const mark of painting.hours) {
    const row = document.createElement('div')
    row.className = 'hour'
    row.style.top = `${mark.at * height}px`
    row.dataset.surface = SURFACE[levelAt(painting.bands, mark.at)]
    const numeral = document.createElement('span')
    numeral.textContent = String(mark.hour).padStart(2, '0')
    row.append(numeral)
    hours.push(row)
  }

  for (const label of painting.labels) {
    const tick = document.createElement('div')
    tick.className = 'tick'
    tick.style.top = `${label.truePx}px`
    tick.dataset.surface = SURFACE[label.levelAtTrue]
    ticks.push(tick)

    // A displaced label keeps a hairline back to where the event actually is.
    const offset = label.labelPx - label.truePx
    if (Math.abs(offset) > 2) {
      const leader = document.createElement('div')
      leader.className = 'leader'
      leader.style.top = `${Math.min(label.truePx, label.labelPx)}px`
      leader.style.height = `${Math.abs(offset)}px`
      leader.dataset.surface = SURFACE[label.levelAtTrue]
      ticks.push(leader)
    }

    const row = document.createElement('div')
    row.className = 'ev'
    row.style.top = `${label.labelPx}px`
    row.dataset.surface = SURFACE[label.levelUnder]

    const time = document.createElement('span')
    time.className = 't'
    time.textContent = formatTime(label.at, v.clock)

    const copy = document.createElement('span')
    copy.className = 'l'
    const { plain, technical } = LABEL[label.kind]
    copy.append(document.createTextNode(plain))
    if (technical !== '') {
      const tech = document.createElement('span')
      tech.className = 'tech'
      tech.textContent = ` · ${technical}`
      copy.append(tech)
    }

    row.append(time, copy)
    labels.push(row)
  }

  replace(el.hours, hours)
  replace(el.ticks, ticks)
  replace(el.labels, labels)
  replace(el.notes, absenceMessages(painting.absences).map(note))
  replace(el.footer, footer(v.day, painting))
}

const note = (text: string): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'note'
  el.textContent = text
  return el
}

const footer = (day: SolarDay, painting: Painting): Node[] => {
  // With no events at all the durations still hold (a polar day is 24h of light,
  // a polar night is none), so the footer stays useful rather than blank.
  const parts: Array<[string, number]> = [
    ['usable', day.usableLightMs],
    ['light', day.someLightMs],
  ]
  return parts.flatMap(([label, ms], i) => {
    const span = document.createElement('span')
    span.append(document.createTextNode(`${label} `))
    const b = document.createElement('b')
    b.textContent = formatDuration(ms)
    span.append(b)
    return i === 0 ? [span] : [document.createTextNode('·'), span]
  })
}

export const renderSheet = (
  el: Elements,
  args: {
    readonly selection: Selection
    readonly locations: readonly SavedLocation[]
    readonly gps: Coords | null
    readonly clock: Clock
    readonly onPick: (selection: Selection) => void
    readonly onRemove: (id: string) => void
  },
): void => {
  const items: Node[] = []

  const option = (
    label: string,
    sub: string,
    current: boolean,
    onPick: () => void,
    onRemove?: () => void,
  ): HTMLLIElement => {
    const li = document.createElement('li')
    const pick = document.createElement('button')
    pick.type = 'button'
    pick.className = 'pick'
    pick.setAttribute('aria-current', String(current))
    const name = document.createElement('span')
    name.textContent = label
    const detail = document.createElement('span')
    detail.className = 'sub'
    detail.textContent = sub
    pick.append(name, detail)
    pick.addEventListener('click', onPick)
    li.append(pick)

    if (onRemove !== undefined) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'remove'
      remove.setAttribute('aria-label', `Remove ${label}`)
      remove.textContent = '✕'
      remove.addEventListener('click', onRemove)
      li.append(remove)
    }
    return li
  }

  items.push(
    option(
      'Current location',
      args.gps === null ? 'no fix yet' : formatCoords(args.gps),
      args.selection.kind === 'gps',
      () => args.onPick({ kind: 'gps' }),
    ),
  )

  for (const loc of args.locations) {
    items.push(
      option(
        loc.name,
        formatCoords({ lat: loc.lat, lon: loc.lon }),
        args.selection.kind === 'saved' && args.selection.id === loc.id,
        () => args.onPick({ kind: 'saved', id: loc.id }),
        () => args.onRemove(loc.id),
      ),
    )
  }

  replace(el.locOptions, items)
  el.clock24.setAttribute('aria-pressed', String(args.clock === 24))
  el.clock12.setAttribute('aria-pressed', String(args.clock === 12))
}
